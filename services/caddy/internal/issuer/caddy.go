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
	Email        string
	Region       string
	HostedZoneID string
	Local        bool
}

// Configuration uses TLS automation without HTTP servers or an admin listener.
func (e Engine) Configuration(root string, domains []string) *caddy.Config {
	policy := &caddytls.AutomationPolicy{SubjectsRaw: domains}
	apps := caddy.ModuleMap{}

	if e.Local {
		policy.IssuersRaw = []json.RawMessage{caddyconfig.JSONModuleObject(
			caddytls.InternalIssuer{CA: "local", Lifetime: caddy.Duration(2500 * 24 * time.Hour)}, "module", "internal", nil,
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
		CertificatesRaw: caddy.ModuleMap{"automate": caddyconfig.JSON(domains, nil)},
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

// Maintain owns Caddy's process-global runtime for one invocation at a time.
// The caller reserves time after its deadline to persist state even on failure.
func (e Engine) Maintain(ctx context.Context, root string, domains []string, ready func() error) (result error) {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start certificate maintenance: %w", err)
	}

	if err := caddy.Run(e.Configuration(root, domains)); err != nil {
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
