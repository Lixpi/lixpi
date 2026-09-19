package issuer

import (
	"encoding/json"
	"errors"
	"io/fs"
	"testing"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddytls"
)

func TestDNSOnlyConfigurationAndIssuerFallback(t *testing.T) {
	engine := Engine{Email: "ops@example.test", Region: "us-east-1", HostedZoneID: "ZTEST"}

	config := engine.Configuration(t.TempDir(), []string{"nats.example.test"})
	if !config.Admin.Disabled || *config.Admin.Config.Persist || config.AppsRaw["http"] != nil {
		t.Fatal("certificate maintenance opened an unnecessary server or enabled config persistence")
	}

	var tlsApp caddytls.TLS
	if err := json.Unmarshal(config.AppsRaw["tls"], &tlsApp); err != nil {
		t.Fatal(err)
	}

	issuers := tlsApp.Automation.Policies[0].IssuersRaw
	if len(issuers) != 2 {
		t.Fatal("public issuer fallback was lost")
	}

	for _, raw := range issuers {
		var acme caddytls.ACMEIssuer
		if err := json.Unmarshal(raw, &acme); err != nil {
			t.Fatal(err)
		}

		if acme.Email != engine.Email || !acme.Challenges.HTTP.Disabled || !acme.Challenges.TLSALPN.Disabled {
			t.Fatal("ACME identity or challenge contract changed")
		}

		var dns struct {
			Name string `json:"name"`
			Zone string `json:"hosted_zone_id"`
		}
		if err := json.Unmarshal(acme.Challenges.DNS.ProviderRaw, &dns); err != nil || dns.Name != "route53" || dns.Zone != engine.HostedZoneID {
			t.Fatal("Route53 configuration missing")
		}
	}

	if _, err := caddy.GetModule("dns.providers.route53"); err != nil {
		t.Fatal("Route53 plugin was not compiled in")
	}
}

func TestStorageCleanupPreventsLateCertificateWrites(t *testing.T) {
	module := &fileStorage{Root: t.TempDir()}

	storage, err := module.CertMagicStorage()
	if err != nil {
		t.Fatal(err)
	}

	if err := storage.Store(t.Context(), "account.json", []byte("original")); err != nil {
		t.Fatal(err)
	}

	if err := module.Cleanup(); err != nil {
		t.Fatal(err)
	}

	if err := storage.Store(t.Context(), "account.json", []byte("late")); !errors.Is(err, fs.ErrClosed) {
		t.Fatal("late certificate job changed frozen state")
	}

	if err := storage.Delete(t.Context(), "account.json"); !errors.Is(err, fs.ErrClosed) {
		t.Fatal("late cleanup deleted frozen state")
	}

	data, err := storage.Load(t.Context(), "account.json")
	if err != nil || string(data) != "original" {
		t.Fatal("frozen state changed")
	}
}
