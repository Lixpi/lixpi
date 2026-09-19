package broker

import (
	"errors"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
)

// ConfigureCallout scopes bootstrap access to an in-process connection and prevents routed callout interest.
func ConfigureCallout(options *server.Options, p *policy.Policy, node, password, issuer, xkey string) error {
	var account *server.Account

	for _, candidate := range options.Accounts {
		if candidate.Name == "CALLOUT" {
			account = candidate
		}
	}

	if account == nil || password == "" {
		return errors.New("callout account and bootstrap password are required")
	}

	grants := p.BootstrapPermissions(node)
	permissions := &server.Permissions{
		Publish:   &server.SubjectPermission{Allow: grants.Pub.Allow},
		Subscribe: &server.SubjectPermission{Allow: grants.Sub.Allow},
		Response:  &server.ResponsePermission{MaxMsgs: grants.Resp.MaxMsgs, Expires: time.Duration(grants.Resp.Expires)},
	}
	user := &server.User{
		Username: "auth_callout", Password: password, Account: account, Permissions: permissions,
		AllowedConnectionTypes: map[string]struct{}{jwt.ConnectionTypeInProcess: {}},
	}
	users := make([]*server.User, 0, len(options.Users)+1)

	for _, existing := range options.Users {
		if existing.Username != user.Username {
			users = append(users, existing)
		}
	}

	users = append(users, user)
	options.Users = users
	options.AuthCallout = &server.AuthCallout{Issuer: issuer, Account: "CALLOUT", AuthUsers: []string{user.Username}, XKey: xkey}
	options.AlwaysEnableNonce = true
	options.Cluster.Permissions = &server.RoutePermissions{
		Import: &server.SubjectPermission{Deny: []string{p.Subjects.Protocol.Auth.Request}},
		Export: &server.SubjectPermission{Deny: []string{p.Subjects.Protocol.Auth.Request}},
	}

	return nil
}
