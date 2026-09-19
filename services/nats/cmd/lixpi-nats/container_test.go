package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

// The opt-in fixture exports synthetic keys for a disposable production-image smoke test.
// It never reads application credentials or changes a running application container.
func TestContainerFixture(t *testing.T) {
	directory := os.Getenv("NATS_TEST_FIXTURE_DIR")
	if directory == "" {
		t.Skip("fixture export requires an isolated output directory")
	}

	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}

	env := map[string]string{
		"ENVIRONMENT":              "local",
		"MOCK_AUTH0":               "true",
		"MOCK_AUTH0_DOMAIN":        "unavailable.test",
		"MOCK_AUTH0_JWKS_URI":      "http://unavailable.test/.well-known/jwks.json",
		"AUTH0_API_IDENTIFIER":     "test",
		"NATS_SERVER_NAME":         "container-proof",
		"NATS_SYS_USER_PASSWORD":   "synthetic-system",
		"NATS_CALLOUT_PASSWORD":    "synthetic-bootstrap",
		"NATS_CLUSTER_NAME":        "container-proof",
		"NATS_CERT_FILE":           "/fixture/localhost.crt",
		"NATS_KEY_FILE":            "/fixture/localhost.key",
		"NATS_PERSIST_SERVER_NAME": "true",
		"GOMEMLIMIT":               "768MiB",
	}

	for _, kind := range []string{"NKEY", "XKEY"} {
		var key nkeys.KeyPair
		var err error

		if kind == "NKEY" {
			key, err = nkeys.CreateAccount()
		} else {
			key, err = nkeys.CreateCurveKeys()
		}

		if err != nil {
			t.Fatal(err)
		}

		public, err := key.PublicKey()
		if err != nil {
			t.Fatal(err)
		}

		seed, err := key.Seed()
		if err != nil {
			t.Fatal(err)
		}

		env["NATS_AUTH_"+kind+"_ISSUER_PUBLIC"] = public
		env["NATS_AUTH_"+kind+"_ISSUER_SEED"] = string(seed)
	}

	authority, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	authorityPublic, err := authority.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	trust := []policy.Authority{{PublicKey: authorityPublic, Owner: "lixpi", Accounts: []string{"AUTH", "NEX"}}}

	authoritySeed, err := authority.Seed()
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(directory, "registration-authority.seed"), authoritySeed, 0o600); err != nil {
		t.Fatal(err)
	}

	encodedTrust, err := json.Marshal(trust)
	if err != nil {
		t.Fatal(err)
	}

	env["NATS_REGISTRATION_AUTHORITIES"] = string(encodedTrust)
	env["NATS_REGISTRATION_PASSWORD"] = "synthetic-registration"
	manifest := policy.Manifest{Schema: 1, Owner: "lixpi", Version: 1}

	for _, name := range []string{"API", "FILE_CONVERSION", "CHARACTER_FIDELITY", "BACKUP", "OPERATOR", "NEX_NODE"} {
		key, err := nkeys.CreateUser()
		if err != nil {
			t.Fatal(err)
		}

		public, err := key.PublicKey()
		if err != nil {
			t.Fatal(err)
		}

		seed, err := key.Seed()
		if err != nil {
			t.Fatal(err)
		}

		account := "AUTH"

		if name == "NEX_NODE" {
			account = "NEX"
		}

		manifest.Services = append(manifest.Services, policy.Service{
			UserID:    "svc:" + strings.ReplaceAll(strings.ToLower(name), "_", "-"),
			PublicKey: public,
			Account:   account,
			Permissions: jwt.Permissions{
				Pub: jwt.Permission{Allow: jwt.StringList{"$JS.>", "$O.>", "_INBOX.>"}},
				Sub: jwt.Permission{Allow: jwt.StringList{"$O.>", "_INBOX.>"}},
			},
		})

		if err := os.WriteFile(filepath.Join(directory, name+".seed"), seed, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}

	signature, err := authority.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}

	registration, err := json.Marshal(
		policy.ApplyRequest{Registration: policy.SignedRegistration{Issuer: authorityPublic, Payload: payload, Signature: signature}},
	)
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(directory, "registration.json"), registration, 0o600); err != nil {
		t.Fatal(err)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	leaf := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
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

	if err := os.WriteFile(
		filepath.Join(directory, "localhost.crt"),
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		0o600,
	); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(
		filepath.Join(directory, "localhost.key"),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}),
		0o600,
	); err != nil {
		t.Fatal(err)
	}

	var lines []string

	for name, value := range env {
		lines = append(lines, fmt.Sprintf("%s=%s", name, value))
	}

	slices.Sort(lines)

	if err := os.WriteFile(filepath.Join(directory, "environment"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Exercise the production configuration parser and all startup validation.
	for name, value := range env {
		t.Setenv(name, value)
	}

	t.Setenv("NATS_CERT_FILE", filepath.Join(directory, "localhost.crt"))
	t.Setenv("NATS_KEY_FILE", filepath.Join(directory, "localhost.key"))
	t.Setenv("NATS_STORE_DIR", t.TempDir())
	t.Setenv("NATS_TLS_ROOT", t.TempDir())

	if err := serve(t.Context(), "../../nats-server.conf", "", true); err != nil {
		t.Fatal(err)
	}
}
