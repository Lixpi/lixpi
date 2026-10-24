package issuer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "github.com/caddy-dns/route53"
	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig"
	"github.com/caddyserver/caddy/v2/modules/caddypki"
	"github.com/caddyserver/caddy/v2/modules/caddytls"
)

type Engine struct {
	Email              string
	Region             string
	HostedZoneID       string
	Local              bool
	LocalLifetime      time.Duration
	CertificateStorage string
}

// Configuration uses TLS automation without HTTP servers or an admin listener.
func (e Engine) Configuration(root string, domains []string) *caddy.Config {
	policy := &caddytls.AutomationPolicy{SubjectsRaw: domains}

	if e.CertificateStorage != "" {
		policy.StorageRaw = caddyconfig.JSONModuleObject(fileStorage{Root: e.CertificateStorage}, "module", "lixpi_file_system", nil)
	}

	apps := caddy.ModuleMap{}

	if e.Local {
		lifetime := e.LocalLifetime
		if lifetime == 0 {
			lifetime = 2500 * 24 * time.Hour
		}

		policy.IssuersRaw = []json.RawMessage{caddyconfig.JSONModuleObject(
			caddytls.InternalIssuer{CA: "local", Lifetime: caddy.Duration(lifetime)}, "module", "internal", nil,
		)}
		installTrust := false
		apps["pki"] = caddyconfig.JSON(&caddypki.PKI{CAs: map[string]*caddypki.CA{
			"local": {InstallTrust: &installTrust, IntermediateLifetime: caddy.Duration(3000 * 24 * time.Hour)},
		}}, nil)
	} else {
		provider := caddyconfig.JSON(map[string]any{
			"name": "route53", "region": e.Region, "hosted_zone_id": e.HostedZoneID,
			"route53_max_wait":      int64(120 * time.Second),
			"wait_for_route53_sync": false, "skip_route53_sync_on_delete": true,
		}, nil)
		for _, defaultIssuer := range caddytls.DefaultIssuers(e.Email) {
			acme, ok := defaultIssuer.(*caddytls.ACMEIssuer)
			if !ok {
				continue
			}

			acme.Email = e.Email
			acme.Challenges = &caddytls.ChallengesConfig{
				HTTP:    &caddytls.HTTPChallengeConfig{Disabled: true},
				TLSALPN: &caddytls.TLSALPNChallengeConfig{Disabled: true},
				DNS:     &caddytls.DNSChallengeConfig{ProviderRaw: provider},
			}
			policy.IssuersRaw = append(policy.IssuersRaw, caddyconfig.JSONModuleObject(acme, "module", "acme", nil))
		}
	}

	apps["tls"] = caddyconfig.JSON(&caddytls.TLS{
		Automation: &caddytls.AutomationConfig{
			Policies: []*caddytls.AutomationPolicy{policy}, RenewCheckInterval: caddy.Duration(time.Minute),
		},
	}, nil)
	persist := false

	return &caddy.Config{
		Admin:      &caddy.AdminConfig{Disabled: true, Config: &caddy.ConfigSettings{Persist: &persist}},
		StorageRaw: caddyconfig.JSONModuleObject(fileStorage{Root: root}, "module", "lixpi_file_system", nil),
		AppsRaw:    apps,
	}
}

// Start certificate jobs after TLS.Start initializes the storage cleaner.
// Caddy's automate loader starts asynchronous events before that initialization;
// its value-receiver CaddyModule method then races while copying the TLS fields.
func start(configuration *caddy.Config, domains []string) (result error) {
	if err := caddy.Run(configuration); err != nil {
		return fmt.Errorf("start embedded Caddy: %w", err)
	}

	defer func() {
		if result != nil {
			if err := caddy.Stop(); err != nil {
				result = errors.Join(result, fmt.Errorf("stop incomplete Caddy startup: %w", err))
			}
		}
	}()

	app, err := caddy.ActiveContext().AppIfConfigured("tls")
	if err != nil {
		return fmt.Errorf("load running Caddy TLS app: %w", err)
	}

	tlsApp, ok := app.(*caddytls.TLS)
	if !ok {
		return errors.New("running Caddy TLS app is unavailable")
	}

	subjects := make(map[string]struct{}, len(domains))
	for _, domain := range domains {
		subjects[domain] = struct{}{}
	}

	if err := tlsApp.Manage(subjects); err != nil {
		return fmt.Errorf("start certificate management: %w", err)
	}

	return nil
}

// Maintain owns Caddy's process-global runtime for one invocation at a time.
// The caller reserves time after its deadline to persist state even on failure.
func (e Engine) Maintain(ctx context.Context, root string, domains []string, ready func() error) (result error) {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start certificate maintenance: %w", err)
	}

	if err := start(e.Configuration(root, domains), domains); err != nil {
		return fmt.Errorf("start embedded Caddy: %w", err)
	}

	defer func() {
		if err := caddy.Stop(); err != nil {
			result = errors.Join(result, fmt.Errorf("stop embedded Caddy: %w", err))
		}
	}()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		if err := ready(); err == nil {
			return nil
		} else if ctx.Err() != nil {
			return fmt.Errorf("certificate maintenance did not finish: %w", errors.Join(ctx.Err(), err))
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("certificate maintenance timed out: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}
