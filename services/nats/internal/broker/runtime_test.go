package broker

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
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

func runtimeProtocol(t *testing.T) *auth.Protocol {
	t.Helper()

	signer, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	curve, err := nkeys.CreateCurveKeys()
	if err != nil {
		t.Fatal(err)
	}

	signerSeed, err := signer.Seed()
	if err != nil {
		t.Fatal(err)
	}

	curveSeed, err := curve.Seed()
	if err != nil {
		t.Fatal(err)
	}

	protocol, err := auth.NewProtocol(string(signerSeed), string(curveSeed))
	if err != nil {
		t.Fatal(err)
	}

	return protocol
}

func browserFixture(p *policy.Policy) {
	p.Browser = []jwt.Permissions{{
		Pub: jwt.Permission{Allow: jwt.StringList{"_INBOX.{subjectToken}.>", "user.get"}},
		Sub: jwt.Permission{Allow: jwt.StringList{"_INBOX.{subjectToken}.>"}},
	}}
}

func signedToken(t *testing.T, algorithm string, claims map[string]any, sign func([]byte) ([]byte, error)) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": algorithm, "typ": "JWT", "kid": "browser-key"})
	body, _ := json.Marshal(claims)
	encoded := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)

	signature, err := sign([]byte(encoded))
	if err != nil {
		t.Fatal(err)
	}

	return encoded + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func runtimeFixture(t *testing.T, evaluator auth.Evaluator, certificates *maintenance.Certificates, extraKeys []*server.NkeyUser) *Runtime {
	t.Helper()

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	worker, err := admission.NewWorker(evaluator, 4)
	if err != nil {
		t.Fatal(err)
	}

	account := server.NewAccount("AUTH")

	for _, key := range extraKeys {
		key.Account = account
	}

	options := &server.Options{
		Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, ServerName: "runtime", StoreDir: t.TempDir(),
		Accounts: []*server.Account{account, server.NewAccount("CALLOUT")}, Nkeys: extraKeys,
	}

	if certificates != nil {
		pair, err := tls.LoadX509KeyPair(
			filepath.Join(certificates.Root, "current", "server.crt"),
			filepath.Join(certificates.Root, "current", "server.key"),
		)
		if err != nil {
			t.Fatal(err)
		}

		options.Websocket = server.WebsocketOpts{
			Host:      "127.0.0.1",
			Port:      -1,
			TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}},
		}
	}

	r, err := StartRuntime(t.Context(), RuntimeConfig{
		Options:      options,
		Password:     "bootstrap",
		Identity:     maintenance.NodeIdentity{Name: "runtime", Zone: "zone-a"},
		Certificates: certificates,
		Admission: admission.Settings{
			Node:             "runtime",
			Digest:           p.Digest,
			Policy:           p,
			Protocol:         runtimeProtocol(t),
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

func TestRealBrowserServiceAndNKeyAdmissions(t *testing.T) {
	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	key, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	var requests atomic.Int64
	var unavailable atomic.Bool
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)

		if unavailable.Load() {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)

			return
		}

		_ = json.NewEncoder(w).
			Encode(map[string]any{"keys": []any{map[string]string{"kty": "RSA", "kid": "browser-key", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(rsaKey.N.Bytes()), "e": "AQAB"}}})
	}))
	t.Cleanup(jwks.Close)

	browserFixture(p)

	grants, err := p.BrowserPermissions("service")
	if err != nil {
		t.Fatal(err)
	}

	verifier := &auth.Verifier{
		Policy:        p,
		Registrations: []auth.Registration{{UserID: "svc:test", PublicKey: public, Account: "AUTH", Permissions: grants}},
		Issuer:        "https://issuer.test/",
		Audience:      "test",
		Account:       "AUTH",
		Keys:          &auth.JWKS{URL: jwks.URL},
	}
	r := runtimeFixture(t, verifier, nil, []*server.NkeyUser{{Nkey: public}})
	connect := func(options ...nats.Option) *nats.Conn {
		options = append(options, nats.NoReconnect(), nats.IgnoreDiscoveredServers(), nats.Timeout(2*time.Second))

		connection, err := nats.Connect(r.Server.ClientURL(), options...)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(connection.Close)

		return connection
	}
	connect(nats.Nkey(public, key.Sign))
	serviceJWT := signedToken(t, "EdDSA", map[string]any{"iss": public, "sub": "svc:test", "exp": time.Now().Add(time.Minute).Unix()}, key.Sign)
	connect(nats.Token(serviceJWT))
	user := "auth0|é用户"
	browserJWT := signedToken(
		t,
		"RS256",
		map[string]any{"iss": verifier.Issuer, "sub": user, "aud": "test", "exp": time.Now().Add(time.Minute).Unix()},
		func(message []byte) ([]byte, error) {
			digest := sha256.Sum256(message)

			return rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, digest[:])
		},
	)
	errors := make(chan error, 4)
	connection := connect(nats.Token(browserJWT), nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { errors <- err }))
	inbox := "_INBOX." + policy.UserToken(user) + ".response"

	sub, err := connection.SubscribeSync(inbox)
	if err != nil {
		t.Fatal(err)
	}

	if err := connection.Publish(inbox, []byte("scoped")); err != nil {
		t.Fatal(err)
	}

	if err := connection.Flush(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()

	message, err := sub.NextMsgWithContext(ctx)
	if err != nil || string(message.Data) != "scoped" {
		t.Fatal("scoped browser inbox failed", err)
	}

	if _, err := connection.SubscribeSync("_INBOX.another-user.>"); err != nil {
		t.Fatal(err)
	}

	if err := connection.Flush(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-errors:
	case <-time.After(time.Second):
		t.Fatal("cross-user inbox was allowed")
	}

	unavailable.Store(true)
	connect(nats.Token(browserJWT))

	if requests.Load() != 1 {
		t.Fatal("cached browser key fetched during outage")
	}

	invalid := signedToken(t, "EdDSA", map[string]any{"iss": public, "sub": "svc:impostor"}, key.Sign)

	if connection, err := nats.Connect(r.Server.ClientURL(), nats.Token(invalid), nats.NoReconnect(), nats.IgnoreDiscoveredServers()); err == nil {
		connection.Close()
		t.Fatal("wrong service subject admitted")
	}
}

func TestDispatcherRecoveryAndReadiness(t *testing.T) {
	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	evaluator := &faultEvaluator{policy: p, release: make(chan struct{})}
	t.Cleanup(func() { close(evaluator.release) })
	r := runtimeFixture(t, evaluator, nil, nil)
	ctx, cancel := context.WithCancel(t.Context())
	finished := make(chan error, 1)
	go func() { finished <- r.Run(ctx) }()
	t.Cleanup(func() {
		r.Server.Shutdown()
		cancel()

		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("runtime did not stop")
		}
	})
	handler := r.HealthHandler()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatal("readiness endpoint exposed without token")
	}

	request.Header.Set("Authorization", "Bearer bootstrap")
	original := r.Dispatcher()
	stopCtx, stop := context.WithTimeout(t.Context(), time.Second)

	if err := original.Stop(stopCtx); err != nil {
		t.Fatal(err)
	}

	stop()
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatal("dead dispatcher remained ready")
	}

	waitFor(t, func() bool { return r.Dispatcher() != nil && r.Dispatcher() != original && r.Ready() })
	connectAdmission(t, r.Server, true)
	r.config.Admission.Worker.SetHealthy(false)
	waitFor(t, func() bool { return !r.Ready() })
	current := r.Dispatcher()
	time.Sleep(3100 * time.Millisecond)

	if current != r.Dispatcher() || !r.Server.Running() {
		t.Fatal("worker outage restarted dispatcher or broker")
	}
}

func websocketCertificate(t *testing.T) ([]byte, []byte) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatal(err)
	}

	leaf := &x509.Certificate{
		SerialNumber: serial,
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(48 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, leaf, leaf, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}

	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}

	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
}

func TestCertificateReloadKeepsWebsocketConnection(t *testing.T) {
	cert, key := websocketCertificate(t)
	certificates := &maintenance.Certificates{
		Root:        t.TempDir(),
		Domain:      "localhost",
		Local:       true,
		MinValidity: time.Hour,
		Source:      func(context.Context) ([]byte, []byte, error) { return cert, key, nil },
	}

	if err := certificates.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	evaluator := &faultEvaluator{policy: p, release: make(chan struct{})}
	t.Cleanup(func() { close(evaluator.release) })
	r := runtimeFixture(t, evaluator, certificates, nil)

	info, err := r.Server.Varz(nil)
	if err != nil {
		t.Fatal(err)
	}

	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(cert)

	connection, err := nats.Connect(
		fmt.Sprintf("wss://localhost:%d", info.Websocket.Port),
		nats.Token("credential"),
		nats.Secure(&tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}),
		nats.NoReconnect(),
	)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(connection.Close)
	cert, key = websocketCertificate(t)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()

	if err := certificates.Refresh(ctx); err != nil {
		t.Fatal(err)
	}

	if err := connection.FlushTimeout(time.Second); err != nil {
		t.Fatal("existing WebSocket connection broke during rotation", err)
	}

	if err := r.Fence(true); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(r.options.StoreDir, "scale-in-fenced")); err != nil {
		t.Fatal(err)
	}

	if err := r.Fence(false); err != nil {
		t.Fatal(err)
	}
}
