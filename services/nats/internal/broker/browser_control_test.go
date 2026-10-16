package broker

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

type browserControlFixture struct {
	runtime *Runtime
	service *nats.Conn
	js      nats.JetStreamContext
	key     *rsa.PrivateKey
	issuer  string
}

func startBrowserControlFixture(t *testing.T, beforeReply func(auth.PolicyRequest)) *browserControlFixture {
	t.Helper()

	authority, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	authorityPublic, err := authority.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	serviceKey, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	servicePublic, err := serviceKey.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).
			Encode(map[string]any{"keys": []any{map[string]string{"kty": "RSA", "kid": "browser-key", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
	}))
	t.Cleanup(jwks.Close)

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	application := &auth.ApplicationPolicy{}

	worker, err := admission.NewWorker(&auth.RuntimeVerifier{ApplicationPolicy: application}, 4)
	if err != nil {
		t.Fatal(err)
	}

	r, err := StartRuntime(t.Context(), RuntimeConfig{
		ApplicationPolicy: application,
		Deployment:        &maintenance.DeploymentIdentity{Kind: "compose", Container: "0123456789ab"},
		Options: &server.Options{
			Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, JetStream: true, StoreDir: t.TempDir(), SystemAccount: "SYS",
			Accounts: []*server.Account{server.NewAccount("SYS"), server.NewAccount("CALLOUT")},
		},
		Registration: &RegistrationConfig{
			Trust: policy.Trust{
				AllowHTTP:   true,
				Authorities: []policy.Authority{{PublicKey: authorityPublic, Owner: "application", Accounts: []string{"AUTH"}}},
			},
			Password: "registration",
			Replicas: 1,
		},
		Password: "private",
		Identity: maintenance.NodeIdentity{Name: "admission-test", Zone: "test"},
		Admission: admission.Settings{
			Node:             "admission-test",
			Digest:           "test",
			Policy:           p,
			Protocol:         runtimeProtocol(t),
			Worker:           worker,
			MaxConcurrent:    16,
			MaxAttempts:      1,
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
	manifest := policy.Manifest{
		Schema: 1, Owner: "application", Version: 1,
		Services: []policy.Service{{UserID: "svc:fixture", PublicKey: servicePublic, Account: "AUTH", Permissions: jwt.Permissions{
			Pub: jwt.Permission{
				Allow: jwt.StringList{"$JS.API.>", "$JS.ACK.>", browserChangedSubject, policy.BrowserAdmissionInbox + ".AUTH.>", "fixture.service"},
			},
			Sub: jwt.Permission{Allow: jwt.StringList{"_INBOX.>", policy.BrowserAdmissionSubject, "fixture.service"}},
		}}},
		Browsers: []policy.Browser{
			{
				Issuer:   jwks.URL + "/",
				Audience: "application",
				JWKSURL:  jwks.URL,
				Account:  "AUTH",
				Permissions: []jwt.Permissions{
					{Pub: jwt.Permission{Allow: jwt.StringList{"browser.message"}}, Sub: jwt.Permission{Allow: jwt.StringList{"browser.message"}}},
				},
				Admission: &policy.BrowserAdmission{Subject: policy.BrowserAdmissionSubject, Claim: "https://lixpi.ai/admission", Stream: "ACCOUNTS"},
			},
		},
	}

	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}

	signature, err := authority.Sign(data)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := r.Registry.Apply(
		t.Context(),
		policy.ApplyRequest{Registration: policy.SignedRegistration{Issuer: authorityPublic, Payload: data, Signature: signature}},
	); err != nil {
		t.Fatal(err)
	}

	waitFor(t, r.Ready)

	service, err := nats.Connect(r.Server.ClientURL(), nats.Nkey(servicePublic, serviceKey.Sign), nats.NoReconnect())
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(service.Close)

	js, err := service.JetStream(nats.MaxWait(time.Second))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddStream(
		&nats.StreamConfig{Name: "ACCOUNTS", Subjects: []string{browserChangedSubject}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy},
	); err != nil {
		t.Fatal(err)
	}

	_, err = service.Subscribe(policy.BrowserAdmissionSubject, func(message *nats.Msg) {
		var query auth.PolicyRequest
		if err := json.Unmarshal(message.Data, &query); err != nil {
			t.Error(err)

			return
		}

		if beforeReply != nil {
			beforeReply(query)
		}

		var claim struct {
			Epoch int64 `json:"epoch"`
		}
		if err := json.Unmarshal(query.Claim, &claim); err != nil {
			t.Error(err)

			return
		}

		decision := auth.PolicyDecision{
			Version: 1, Nonce: query.Nonce, Revision: query.Revision, ApplicationRevision: query.ApplicationRevision,
			UserNkey: query.UserNkey, Subject: query.Subject, Allowed: true, Epoch: claim.Epoch, ExpiresAt: query.GrantExpiresAt,
		}

		encoded, err := json.Marshal(decision)
		if err != nil {
			t.Error(err)

			return
		}

		if err := message.Respond(encoded); err != nil {
			t.Error(err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := service.Flush(); err != nil {
		t.Fatal(err)
	}

	return &browserControlFixture{runtime: r, service: service, js: js, key: key, issuer: jwks.URL + "/"}
}

func (f *browserControlFixture) connect(t *testing.T, subject string, epoch int64) (*nats.Conn, error) {
	t.Helper()
	token := signedToken(t, "RS256", map[string]any{
		"iss": f.issuer, "sub": subject, "aud": "application", "exp": time.Now().Add(time.Hour).Unix(),
		"https://lixpi.ai/admission": map[string]any{"v": 1, "epoch": epoch},
	}, func(data []byte) ([]byte, error) {
		digest := sha256.Sum256(data)

		signature, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
		if err != nil {
			return nil, fmt.Errorf("sign browser token: %w", err)
		}

		return signature, nil
	})

	connection, err := nats.Connect(f.runtime.Server.ClientURL(), nats.Token(token), nats.NoReconnect(), nats.Timeout(2*time.Second))
	if err != nil {
		return nil, fmt.Errorf("connect browser: %w", err)
	}

	t.Cleanup(connection.Close)

	return connection, nil
}

func (f *browserControlFixture) change(t *testing.T, subject string, epoch int64, state string) {
	t.Helper()
	identity := fmt.Sprintf("%d:%s%d:%s", len(f.issuer), f.issuer, len(subject), subject)

	data, err := json.Marshal(
		browserChange{Version: 1, EventID: "d11565ad-1e45-490c-aefe-29e566460f5a", IdentityKey: identity, Epoch: epoch, State: state},
	)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.js.Publish(browserChangedSubject, data); err != nil {
		t.Fatal(err)
	}

	waitFor(t, func() bool {
		f.runtime.browserControls.mu.Lock()
		feed := f.runtime.browserControls.feeds["AUTH/ACCOUNTS"]
		f.runtime.browserControls.mu.Unlock()

		if feed == nil {
			return false
		}

		feed.mu.Lock()
		defer feed.mu.Unlock()

		return feed.watermarks[identity].Epoch >= epoch && feed.available
	})
}

func TestBrowserControlIdleBrokerReplaysBeforeFirstLogin(t *testing.T) {
	f := startBrowserControlFixture(t, nil)
	f.change(t, "auth0|idle", 2, "blocked")

	if connection, err := f.connect(t, "auth0|idle", 1); err == nil {
		connection.Close()
		t.Fatal("idle broker accepted a stale grant after replay")
	}
}

func TestBrowserControlDisconnectsAndRejectsStaleGrants(t *testing.T) {
	f := startBrowserControlFixture(t, nil)

	browser, err := f.connect(t, "auth0|é用户", 1)
	if err != nil {
		t.Fatal(err)
	}

	other, err := f.connect(t, "auth0|other", 1)
	if err != nil {
		t.Fatal(err)
	}

	js, err := f.service.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	consumers := 0

	for info := range js.ConsumersInfo("ACCOUNTS") {
		if info.Config.Metadata["lixpi.enforcement.role"] != "broker" {
			continue
		}

		consumers++

		var deployment maintenance.DeploymentIdentity
		if json.Unmarshal([]byte(info.Config.Metadata["lixpi.enforcement.deployment"]), &deployment) != nil ||
			deployment.Kind != "compose" || deployment.Container != "0123456789ab" ||
			info.Config.Metadata["lixpi.enforcement.version"] != "1" || info.Config.InactiveThreshold != 0 {
			t.Fatal("missing retained broker deployment identity")
		}
	}

	if consumers != 1 {
		t.Fatalf("expected one broker consumer, got %d", consumers)
	}

	f.change(t, "auth0|é用户", 2, "blocked")
	waitFor(t, browser.IsClosed)

	if other.IsClosed() || f.service.IsClosed() {
		t.Fatal("unrelated browser or service disconnected")
	}

	if connection, err := f.connect(t, "auth0|é用户", 1); err == nil {
		connection.Close()
		t.Fatal("stale policy result admitted after disable")
	}

	fresh, err := f.connect(t, "auth0|é用户", 3)
	if err != nil {
		t.Fatal(err)
	}

	// The authoritative API can see re-enable before its outbox event arrives.
	f.change(t, "auth0|é用户", 3, "active")
	f.change(t, "auth0|é用户", 2, "blocked")

	if fresh.IsClosed() {
		t.Fatal("older event revoked newer active epoch")
	}

	f.runtime.policyConnections[0].Close()
	waitFor(t, fresh.IsClosed)
	waitFor(t, other.IsClosed)

	if f.service.IsClosed() {
		t.Fatal("control failure disconnected native service identity")
	}
}

func TestBrowserControlRejectsPendingLoginAfterDisable(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})

	f := startBrowserControlFixture(t, func(query auth.PolicyRequest) {
		if query.Subject == "auth0|pending" {
			close(entered)

			select {
			case <-release:
			case <-t.Context().Done():
			}
		}
	})
	if _, err := f.connect(t, "auth0|warmup", 1); err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	go func() {
		connection, err := f.connect(t, "auth0|pending", 1)
		if connection != nil {
			connection.Close()
		}

		result <- err
	}()

	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("policy check did not start")
	}

	f.change(t, "auth0|pending", 2, "blocked")
	close(release)

	select {
	case err := <-result:
		if err == nil {
			t.Fatal("late policy approval admitted disabled identity")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("pending login did not finish")
	}
}

func TestBrowserControlPoisonEventClosesExistingConnections(t *testing.T) {
	f := startBrowserControlFixture(t, nil)

	browser, err := f.connect(t, "auth0|one", 1)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.js.Publish(browserChangedSubject, []byte(`{"version":1,"epoch":0}`)); err != nil {
		t.Fatal(err)
	}

	waitFor(t, browser.IsClosed)

	if connection, err := f.connect(t, "auth0|one", 1); err == nil {
		connection.Close()
		t.Fatal("poisoned control log admitted browser")
	}

	if f.service.IsClosed() {
		t.Fatal("poisoned browser feed affected service identity")
	}
}
