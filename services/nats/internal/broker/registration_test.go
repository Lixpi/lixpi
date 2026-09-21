package broker

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/admission"
	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func TestRuntimeRegistersUnfamiliarApplicationWithoutBrokerPolicy(t *testing.T) {
	authority, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	authorityPublic, err := authority.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	clientKey, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	public, err := clientKey.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	trust := policy.Trust{Authorities: []policy.Authority{{PublicKey: authorityPublic, Owner: "unfamiliar", Accounts: []string{"UNFAMILIAR"}}}}
	protocol := runtimeProtocol(t)

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	directory := t.TempDir()
	start := func() *Runtime {
		t.Helper()

		worker, err := admission.NewWorker(&auth.RuntimeVerifier{}, 4)
		if err != nil {
			t.Fatal(err)
		}

		r, err := StartRuntime(t.Context(), RuntimeConfig{
			Options: &server.Options{
				Host:          "127.0.0.1",
				Port:          -1,
				NoSigs:        true,
				NoLog:         true,
				JetStream:     true,
				StoreDir:      directory,
				SystemAccount: "SYS",
				Accounts:      []*server.Account{server.NewAccount("SYS"), server.NewAccount("CALLOUT")},
			},
			Registration: &RegistrationConfig{Trust: trust, Password: "registration-secret", Replicas: 1},
			Password:     "internal-secret",
			Identity:     maintenance.NodeIdentity{Name: "runtime", Zone: "test"},
			Admission: admission.Settings{
				Node:             "runtime",
				Digest:           "test-trust",
				Policy:           p,
				Protocol:         protocol,
				Worker:           worker,
				MaxConcurrent:    16,
				MaxAttempts:      4,
				AttemptTimeout:   300 * time.Millisecond,
				AdmissionTimeout: 1500 * time.Millisecond,
				ResponseReserve:  50 * time.Millisecond,
			},
		})
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() {
			r.Server.Shutdown()

			if err := r.close(t.Context()); err != nil {
				t.Error(err)
			}
		})
		waitFor(t, r.Ready)

		return r
	}
	r := start()

	connect := func() (*nats.Conn, error) {
		return nats.Connect(r.Server.ClientURL(), nats.Nkey(public, clientKey.Sign), nats.NoReconnect(), nats.Timeout(2*time.Second))
	}
	if connection, err := connect(); err == nil {
		connection.Close()
		t.Fatal("unregistered identity admitted")
	}

	violations := make(chan error, 4)

	bootstrap, err := nats.Connect(
		r.Server.ClientURL(),
		nats.UserInfo("registration", "registration-secret"),
		nats.CustomInboxPrefix(policy.RegistrationInbox),
		nats.NoReconnect(),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { violations <- err }),
	)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(bootstrap.Close)

	if err := bootstrap.Publish("$JS.API.STREAM.LIST", []byte("{}")); err != nil {
		t.Fatal(err)
	}

	if err := bootstrap.Flush(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-violations:
	case <-time.After(time.Second):
		t.Fatal("bootstrap accessed storage API")
	}

	manifest := policy.Manifest{
		Schema:  1,
		Owner:   "unfamiliar",
		Version: 1,
		Services: []policy.Service{
			{
				UserID:    "arbitrary-service",
				PublicKey: public,
				Account:   "UNFAMILIAR",
				Permissions: jwt.Permissions{
					Pub: jwt.Permission{Allow: jwt.StringList{"never.seen.before"}},
					Sub: jwt.Permission{Allow: jwt.StringList{"never.seen.before"}},
				},
			},
		},
	}

	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}

	signature, err := authority.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}

	request, err := json.Marshal(
		policy.ApplyRequest{Registration: policy.SignedRegistration{Issuer: authorityPublic, Payload: payload, Signature: signature}},
	)
	if err != nil {
		t.Fatal(err)
	}

	response, err := bootstrap.Request(policy.RegistrationSubject, request, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	var result policy.ApplyResponse
	if err := json.Unmarshal(response.Data, &result); err != nil || result.Error != "" {
		t.Fatal("registration rejected", result.Error, err)
	}

	connection, err := connect()
	if err != nil {
		t.Fatal("registered NKey failed", err)
	}

	sub, err := connection.SubscribeSync("never.seen.before")
	if err != nil {
		t.Fatal(err)
	}

	if err := connection.Publish("never.seen.before", []byte("delivered")); err != nil {
		t.Fatal(err)
	}

	if _, err := sub.NextMsg(time.Second); err != nil {
		t.Fatal(err)
	}

	connection.Close()
	token := signedToken(t, "EdDSA", map[string]any{"iss": public, "sub": "arbitrary-service"}, clientKey.Sign)

	connection, err = nats.Connect(r.Server.ClientURL(), nats.Token(token), nats.NoReconnect())
	if err != nil {
		t.Fatal("registered application JWT failed", err)
	}

	connection.Close()
	bootstrap.Close()
	r.Server.Shutdown()

	if err := r.close(t.Context()); err != nil {
		t.Fatal(err)
	}

	r = start()

	connection, err = connect()
	if err != nil {
		t.Fatal("registration lost across broker restart", err)
	}

	t.Cleanup(connection.Close)

	sub, err = connection.SubscribeSync("never.seen.before")
	if err != nil {
		t.Fatal(err)
	}

	manifest.Version++
	manifest.Services = nil

	payload, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}

	signature, err = authority.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := r.Registry.Apply(
		t.Context(),
		policy.ApplyRequest{
			ExpectedRevision: result.Revision,
			Registration:     policy.SignedRegistration{Issuer: authorityPublic, Payload: payload, Signature: signature},
		},
	); err != nil {
		t.Fatal(err)
	}

	if unexpected, err := connect(); err == nil {
		unexpected.Close()
		t.Fatal("removed identity admitted on new connection")
	}

	if err := connection.Publish("never.seen.before", []byte("existing session")); err != nil {
		t.Fatal(err)
	}

	if _, err := sub.NextMsg(time.Second); err != nil {
		t.Fatal("registration update interrupted established session", err)
	}

	connection.Close()
}
