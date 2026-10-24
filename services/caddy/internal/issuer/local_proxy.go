package issuer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy"
	"github.com/caddyserver/caddy/v2/modules/caddytls"
)

type LocalRoute struct {
	Host     string
	Port     string
	Upstream string
}

// LocalProxyConfiguration shares the persisted CA but isolates browser leaf
// storage from the long-lived certificates exported to NATS.
func LocalProxyConfiguration(root string, routes []LocalRoute) *caddy.Config {
	domains := localDomains(routes)
	servers := make(map[string]*caddyhttp.Server)
	strictHost := true

	for _, route := range routes {
		server := servers[route.Port]
		if server == nil {
			server = &caddyhttp.Server{
				Listen:          []string{net.JoinHostPort("", route.Port)},
				TLSConnPolicies: caddytls.ConnectionPolicies{{}},
				AutoHTTPS:       &caddyhttp.AutoHTTPSConfig{DisableRedir: true, DisableCerts: true},
				StrictSNIHost:   &strictHost,
			}
			servers[route.Port] = server
		}

		server.Routes = append(server.Routes, caddyhttp.Route{
			MatcherSetsRaw: []caddy.ModuleMap{{"host": caddyconfig.JSON(caddyhttp.MatchHost{route.Host}, nil)}},
			HandlersRaw: []json.RawMessage{caddyconfig.JSONModuleObject(reverseproxy.Handler{
				Upstreams: reverseproxy.UpstreamPool{{Dial: route.Upstream}},
			}, "handler", "reverse_proxy", nil)},
			Terminal: true,
		})
	}

	for _, server := range servers {
		server.Routes = append(server.Routes, caddyhttp.Route{
			HandlersRaw: []json.RawMessage{caddyconfig.JSONModuleObject(caddyhttp.StaticResponse{
				StatusCode: caddyhttp.WeakString("404"),
			}, "handler", "static_response", nil)},
		})
	}

	configuration := (Engine{
		Local:              true,
		LocalLifetime:      12 * time.Hour,
		CertificateStorage: filepath.Join(root, "https"),
	}).Configuration(root, domains)
	configuration.AppsRaw["http"] = caddyconfig.JSON(&caddyhttp.App{
		GracePeriod: caddy.Duration(5 * time.Second),
		Servers:     servers,
	}, nil)

	return configuration
}

func ServeLocal(ctx context.Context, root string, routes []LocalRoute) (result error) {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start local HTTPS proxy: %w", err)
	}

	if err := start(LocalProxyConfiguration(root, routes), localDomains(routes)); err != nil {
		return fmt.Errorf("start local HTTPS proxy: %w", err)
	}

	defer func() {
		if err := caddy.Stop(); err != nil {
			result = errors.Join(result, fmt.Errorf("stop local HTTPS proxy: %w", err))
		}
	}()
	<-ctx.Done()

	return nil
}

func localDomains(routes []LocalRoute) []string {
	seen := make(map[string]bool)

	domains := make([]string, 0, len(routes))
	for _, route := range routes {
		if !seen[route.Host] {
			seen[route.Host] = true
			domains = append(domains, route.Host)
		}
	}

	return domains
}
