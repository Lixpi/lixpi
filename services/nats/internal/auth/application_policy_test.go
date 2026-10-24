package auth

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func TestApplicationPolicyBindsDecisionAndCannotExpandGrant(t *testing.T) {
	s, err := server.NewServer(&server.Options{Host: "127.0.0.1", Port: -1, NoSigs: true, NoLog: true})
	if err != nil {
		t.Fatal(err)
	}

	s.Start()
	t.Cleanup(func() { s.Shutdown(); s.WaitForShutdown() })

	if !s.ReadyForConnections(time.Second) {
		t.Fatal("broker did not start")
	}

	c, err := nats.Connect(s.ClientURL(), nats.NoReconnect())
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(c.Close)

	key, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	client := &ApplicationPolicy{}
	client.Register("APP", c)
	browser := policy.Browser{
		RegistrationDigest: strings.Repeat("c", 64),
		Issuer:             "https://auth.example.com/",
		Audience:           "audience",
		Account:            "APP",
		Admission:          &policy.BrowserAdmission{Subject: policy.BrowserAdmissionSubject, Claim: "https://example.com/admission"},
	}
	request := &jwt.AuthorizationRequestClaims{UserNkey: public}
	claims := map[string]json.RawMessage{"https://example.com/admission": json.RawMessage(`{"v":1,"epoch":7}`)}

	claims["exp"], err = json.Marshal(time.Now().Add(time.Hour).Unix())
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name    string
		change  func(*PolicyDecision)
		allowed bool
	}{
		{"matching", func(*PolicyDecision) {}, true},
		{"narrower lease", func(d *PolicyDecision) { d.ExpiresAt -= 10 }, true},
		{"deny", func(d *PolicyDecision) { d.Allowed = false }, false},
		{"wrong nonce", func(d *PolicyDecision) { d.Nonce = "wrong" }, false},
		{"wrong revision", func(d *PolicyDecision) { d.Revision = strings.Repeat("b", 64) }, false},
		{"wrong application", func(d *PolicyDecision) { d.ApplicationRevision = strings.Repeat("d", 64) }, false},
		{"wrong connection", func(d *PolicyDecision) { d.UserNkey = "wrong" }, false},
		{"wrong subject", func(d *PolicyDecision) { d.Subject = "other" }, false},
		{"wrong epoch", func(d *PolicyDecision) { d.Epoch++ }, false},
		{"expired", func(d *PolicyDecision) { d.ExpiresAt = time.Now().Unix() }, false},
		{"extended lease", func(d *PolicyDecision) { d.ExpiresAt++ }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			identity := &Identity{
				Name:        "auth0|one",
				Account:     "APP",
				Expires:     time.Now().Add(55 * time.Second).Unix(),
				Permissions: jwt.Permissions{Pub: jwt.Permission{Allow: jwt.StringList{"one.subject"}}},
			}

			sub, err := c.Subscribe(policy.BrowserAdmissionSubject, func(msg *nats.Msg) {
				var query PolicyRequest
				if err := json.Unmarshal(msg.Data, &query); err != nil {
					t.Error(err)

					return
				}

				if query.Version != 1 || len(query.Nonce) != 64 || query.Issuer != browser.Issuer || query.Audience != browser.Audience ||
					query.Subject != identity.Name {
					t.Error("incorrect validated identity forwarded")
				}

				decision := PolicyDecision{
					ApplicationRevision: query.ApplicationRevision,
					Version:             1,
					Nonce:               query.Nonce,
					Revision:            query.Revision,
					UserNkey:            query.UserNkey,
					Subject:             query.Subject,
					Allowed:             true,
					Epoch:               7,
					ExpiresAt:           query.GrantExpiresAt,
				}
				test.change(&decision)

				encoded, err := json.Marshal(decision)
				if err != nil {
					t.Error(err)

					return
				}

				if err := msg.Respond(encoded); err != nil {
					t.Error(err)
				}
			})
			if err != nil {
				t.Fatal(err)
			}

			defer func() {
				if err := sub.Unsubscribe(); err != nil {
					t.Error(err)
				}
			}()

			if err := c.FlushTimeout(time.Second); err != nil {
				t.Fatal(err)
			}

			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()

			err = client.Check(ctx, browser, strings.Repeat("a", 64), request, claims, identity)
			if test.allowed {
				if err != nil || identity.Admission == nil || identity.Admission.Epoch != 7 {
					t.Fatalf("valid decision rejected: %v", err)
				}

				if len(identity.Permissions.Pub.Allow) != 1 || identity.Permissions.Pub.Allow[0] != "one.subject" {
					t.Fatal("decision changed permission grants")
				}
			} else if !errors.Is(err, ErrDenied) || identity.Admission != nil {
				t.Fatalf("invalid decision accepted: %v", err)
			}
		})
	}

	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()

	identity := &Identity{Name: "auth0|one", Account: "APP", Expires: time.Now().Add(time.Minute).Unix()}
	if err := client.Check(ctx, browser, strings.Repeat("a", 64), request, claims, identity); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing policy responder accepted: %v", err)
	}

	delete(claims, "https://example.com/admission")

	if err := client.Check(t.Context(), browser, strings.Repeat("a", 64), request, claims, identity); !errors.Is(err, ErrDenied) {
		t.Fatalf("missing admission claim accepted: %v", err)
	}
}
