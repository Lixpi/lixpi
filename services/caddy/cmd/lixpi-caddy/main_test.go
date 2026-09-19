package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lixpi/caddy/internal/certificates"
)

func TestLocalEmbeddedCaddyPreservesCAAndCertificate(t *testing.T) {
	root := t.TempDir()
	configuration := settings{local: true, directory: root, domains: []string{"localhost"}, timeout: 20 * time.Second}
	var initial certificates.Pair
	var initialCA string

	for iteration := range 2 {
		if err := execute(t.Context(), configuration); err != nil {
			t.Fatal(err)
		}

		roots, ca, err := certificates.LocalRoots(root)
		if err != nil {
			t.Fatal(err)
		}

		certificate, err := os.ReadFile(filepath.Join(root, "localhost.crt"))
		if err != nil {
			t.Fatal(err)
		}

		key, err := os.ReadFile(filepath.Join(root, "localhost.key"))
		if err != nil {
			t.Fatal(err)
		}

		pair := certificates.Pair{Certificate: string(certificate), PrivateKey: string(key)}

		leaf, err := certificates.Validate(pair, "localhost", roots, time.Now())
		if err != nil {
			t.Fatal(err)
		}

		if time.Until(leaf.NotAfter) < 2499*24*time.Hour {
			t.Fatal("local development lifetime changed")
		}

		for _, file := range []struct {
			name string
			mode os.FileMode
		}{
			{"ca.crt", 0o644}, {"localhost.crt", 0o644}, {"localhost.key", 0o600},
		} {
			info, err := os.Stat(filepath.Join(root, file.name))
			if err != nil || info.Mode().Perm() != file.mode {
				t.Fatalf("incorrect exported permissions for %s: %v", file.name, err)
			}
		}

		if iteration == 0 {
			initial, initialCA = pair, string(ca)
		} else if initial != pair || initialCA != string(ca) {
			t.Fatal("second invocation replaced fresh certificates or CA")
		}
	}
}

func TestConfigurationFailsBeforeIssuance(t *testing.T) {
	base := map[string]string{
		"DOMAINS": "nats.example.test", "CADDY_EMAIL": "ops@example.test", "CADDY_STATE_BUCKET": "state",
		"SECRETS_PREFIX": "certs", "CERT_MANAGER_NAME": "test", "STORAGE_TYPE": "secrets-manager",
	}

	for _, test := range []struct{ name, value string }{
		{"DOMAINS", ""},
		{"DOMAINS", "example.test,../../outside"},
		{"DOMAINS", "https://example.test"},
		{"DOMAINS", "example.test,"},
		{"CADDY_STATE_BUCKET", ""},
		{"CADDY_EMAIL", ""},
		{"CERT_TIMEOUT_SECONDS", "-1"},
		{"CERT_TIMEOUT_SECONDS", "oops"},
		{"STORAGE_TYPE", "s3"},
	} {
		t.Run(test.name+"="+test.value, func(t *testing.T) {
			_, err := readSettings(func(key string) string {
				if key == test.name {
					return test.value
				}

				return base[key]
			}, "maintain")
			if err == nil {
				t.Fatal("invalid environment accepted")
			}
		})
	}

	if _, err := readSettings(func(string) string { return "" }, "local"); err != nil {
		t.Fatalf("local mode requires cloud configuration: %v", err)
	}
}

func TestCancelledLocalCommand(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	if err := execute(ctx, settings{local: true, directory: t.TempDir(), domains: []string{"localhost"}, timeout: time.Second}); err == nil {
		t.Fatal("cancelled local issuance accepted")
	}
}
