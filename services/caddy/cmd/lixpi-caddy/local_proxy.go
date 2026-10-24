package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/issuer"
)

func readLocalRoutes(value string) ([]issuer.LocalRoute, error) {
	var origins map[string]string
	if err := json.Unmarshal([]byte(value), &origins); err != nil {
		return nil, fmt.Errorf("decode CADDY_LOCAL_ROUTES: %w", err)
	}

	if len(origins) == 0 {
		return nil, errors.New("CADDY_LOCAL_ROUTES must contain HTTPS origins and fixed upstream addresses")
	}

	routes := make([]issuer.LocalRoute, 0, len(origins))

	seen := make(map[string]bool, len(origins))
	for origin, upstream := range origins {
		parsed, err := url.Parse(origin)
		if err != nil {
			return nil, fmt.Errorf("parse local HTTPS origin: %w", err)
		}

		domain := strings.ToLower(parsed.Hostname())
		if parsed.Scheme != "https" || parsed.User != nil ||
			(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" ||
			(domain != "localhost" && !validDomain(domain)) || strings.Contains(domain, "*") {
			return nil, fmt.Errorf("invalid local HTTPS origin %q", origin)
		}

		port := parsed.Port()
		if port == "" {
			port = "443"
		}

		if !validLocalPort(port) {
			return nil, fmt.Errorf("invalid local HTTPS port %q", port)
		}

		address := net.JoinHostPort(domain, port)
		if seen[address] {
			return nil, fmt.Errorf("duplicate local HTTPS origin %q", address)
		}

		seen[address] = true

		host, upstreamPort, err := net.SplitHostPort(upstream)
		if err != nil {
			return nil, fmt.Errorf("parse local upstream: %w", err)
		}

		if !validLocalPort(upstreamPort) ||
			(host != "host.docker.internal" && host != "localhost" && net.ParseIP(host) == nil &&
				(!strings.HasPrefix(host, "lixpi-") || strings.Contains(host, ".") || !validDomain(host+".internal"))) {
			return nil, fmt.Errorf("invalid local upstream %q", upstream)
		}

		routes = append(routes, issuer.LocalRoute{Host: domain, Port: port, Upstream: upstream})
	}

	slices.SortFunc(routes, func(a, b issuer.LocalRoute) int {
		return strings.Compare(net.JoinHostPort(a.Host, a.Port), net.JoinHostPort(b.Host, b.Port))
	})

	return routes, nil
}

func validLocalPort(value string) bool {
	number, err := strconv.Atoi(value)

	return err == nil && number >= 1 && number <= 65535 && strconv.Itoa(number) == value
}

func serveLocal(ctx context.Context, getenv func(string) string) error {
	routes, err := readLocalRoutes(getenv("CADDY_LOCAL_ROUTES"))
	if err != nil {
		return fmt.Errorf("read local HTTPS routes: %w", err)
	}

	configuration, err := readSettings(getenv, "local")
	if err != nil {
		return fmt.Errorf("read local HTTPS settings: %w", err)
	}

	// Never create a second development CA when the shared certificate volume is missing.
	if _, _, err := certificates.LocalRoots(configuration.directory); err != nil {
		return fmt.Errorf("load shared local CA; run the local certificate issuer first: %w", err)
	}

	if err := issuer.ServeLocal(ctx, configuration.directory, routes); err != nil {
		return fmt.Errorf("serve local HTTPS: %w", err)
	}

	return nil
}
