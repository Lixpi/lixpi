package broker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

type RegistrationConfig struct {
	Trust    policy.Trust
	Password string
	Replicas int
}

func ConfigureRegistration(options *server.Options, config RegistrationConfig, internalPassword string) error {
	if err := config.Trust.Validate(); err != nil {
		return fmt.Errorf("validate registration trust: %w", err)
	}

	if config.Password == "" || internalPassword == "" || config.Replicas < 1 || config.Replicas > 5 {
		return errors.New("invalid registration bootstrap configuration")
	}

	accounts := map[string]any{policy.RegistryAccount: map[string]any{"jetstream": "enabled"}}

	for _, authority := range config.Trust.Authorities {
		for _, account := range authority.Accounts {
			accounts[account] = map[string]any{"jetstream": "enabled"}
		}
	}

	encoded, err := json.Marshal(map[string]any{"accounts": accounts})
	if err != nil {
		return fmt.Errorf("encode registration accounts: %w", err)
	}

	generated := &server.Options{}
	if err := generated.ProcessConfigString(string(encoded)); err != nil {
		return fmt.Errorf("parse generated registration accounts: %w", err)
	}

	var registry *server.Account

	for _, account := range generated.Accounts {
		for _, existing := range options.Accounts {
			if existing.Name == account.Name {
				return errors.New("registration account duplicates broker configuration")
			}
		}

		options.Accounts = append(options.Accounts, account)
		if account.Name == policy.RegistryAccount {
			registry = account
		}
	}

	bootstrap := &server.User{
		Username: "registration", Password: config.Password, Account: registry,
		Permissions: &server.Permissions{
			Publish:   &server.SubjectPermission{Allow: []string{policy.RegistrationSubject}},
			Subscribe: &server.SubjectPermission{Allow: []string{policy.RegistrationInbox + ".>"}},
		},
	}
	internal := &server.User{
		Username: "registration_store", Password: internalPassword, Account: registry,
		AllowedConnectionTypes: map[string]struct{}{jwt.ConnectionTypeInProcess: {}},
		Permissions: &server.Permissions{
			Publish:   &server.SubjectPermission{Allow: []string{"$JS.API.>", policy.RegistrySubject, policy.RegistrationInbox + ".>", "_INBOX.>"}},
			Subscribe: &server.SubjectPermission{Allow: []string{policy.RegistrationSubject + " registration", "_INBOX.>"}},
		},
	}
	options.Users = append(options.Users, bootstrap, internal)
	options.AuthCallout.AuthUsers = append(options.AuthCallout.AuthUsers, bootstrap.Username, internal.Username)

	return nil
}

func (r *Runtime) startRegistry(ctx context.Context) error {
	if r.config.Registration == nil {
		return nil
	}

	connection, err := nats.Connect(
		"",
		nats.InProcessServer(r.Server),
		nats.UserInfo("registration_store", r.config.Password),
		nats.NoReconnect(),
		nats.Timeout(time.Second),
	)
	if err != nil {
		return fmt.Errorf("connect registration store: %w", err)
	}

	js, err := connection.JetStream(nats.MaxWait(2 * time.Second))
	if err != nil {
		connection.Close()

		return fmt.Errorf("open registration JetStream context: %w", err)
	}

	store := &policy.Store{JS: js, Trust: r.config.Registration.Trust, Replicas: r.config.Registration.Replicas}
	if _, err := store.Subscribe(ctx, connection); err != nil {
		connection.Close()

		return fmt.Errorf("subscribe registration store: %w", err)
	}

	if err := connection.FlushTimeout(time.Second); err != nil {
		connection.Close()

		return fmt.Errorf("flush registration subscriptions: %w", err)
	}

	if err := connection.LastError(); err != nil {
		connection.Close()

		return fmt.Errorf("check registration connection: %w", err)
	}

	r.registryConnection = connection
	r.Registry = store
	r.config.Admission.Resolve = store.Resolve

	return nil
}
