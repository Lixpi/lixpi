package main

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/admission"
	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/broker"
	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
)

func serve(ctx context.Context, config, routes string, check bool) error {
	p, err := policy.Transport()
	if err != nil {
		return fmt.Errorf("load broker transport policy: %w", err)
	}

	trust := policy.Trust{AllowHTTP: os.Getenv("ENVIRONMENT") == "local"}

	authorities := strings.TrimSpace(os.Getenv("NATS_REGISTRATION_AUTHORITIES"))
	if authorities == "" {
		return errors.New("NATS_REGISTRATION_AUTHORITIES is required; save the selected environment through init-config's partial-update flow")
	}

	if err := policy.Decode([]byte(authorities), &trust.Authorities); err != nil {
		return fmt.Errorf("NATS_REGISTRATION_AUTHORITIES must be a JSON array of registration authorities: %w", err)
	}

	if err := trust.Validate(); err != nil {
		return fmt.Errorf("invalid NATS_REGISTRATION_AUTHORITIES: %w", err)
	}

	password := os.Getenv("NATS_REGISTRATION_PASSWORD")
	if password == "" {
		return errors.New("NATS_REGISTRATION_PASSWORD is required; save the selected environment through init-config's partial-update flow")
	}

	encodedTrust, err := json.Marshal(trust)
	if err != nil {
		return fmt.Errorf("encode registration trust: %w", err)
	}

	trustDigest := sha256.Sum256(append([]byte(policy.ProtocolVersion), encodedTrust...))
	digest := hex.EncodeToString(trustDigest[:])

	replicas, err := strconv.Atoi(envDefault("NATS_REGISTRATION_REPLICAS", "3"))
	if err != nil {
		return fmt.Errorf("parse NATS_REGISTRATION_REPLICAS: %w", err)
	}

	registration := &broker.RegistrationConfig{Trust: trust, Password: password, Replicas: replicas}

	protocol, err := auth.NewProtocol(os.Getenv("NATS_AUTH_NKEY_ISSUER_SEED"), os.Getenv("NATS_AUTH_XKEY_ISSUER_SEED"))
	if err != nil {
		return fmt.Errorf("create broker authentication protocol: %w", err)
	}

	xkey, err := protocol.Curve.PublicKey()
	if err != nil {
		return fmt.Errorf("read callout encryption public key: %w", err)
	}

	if protocol.Issuer != os.Getenv("NATS_AUTH_NKEY_ISSUER_PUBLIC") || xkey != os.Getenv("NATS_AUTH_XKEY_ISSUER_PUBLIC") {
		return errors.New("callout public keys do not match issuer seeds")
	}

	store := envDefault("NATS_STORE_DIR", "/data/jetstream")
	startupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	identity, err := maintenance.Node(os.Getenv, store)
	if err != nil {
		return fmt.Errorf("load broker node identity: %w", err)
	}

	root := envDefault("NATS_TLS_ROOT", "/etc/nats-tls")

	minValidity, err := strconv.Atoi(envDefault("CERT_MIN_VALIDITY_SECONDS", "86400"))
	if err != nil {
		return fmt.Errorf("parse CERT_MIN_VALIDITY_SECONDS: %w", err)
	}

	if minValidity < 0 {
		return errors.New("invalid certificate minimum validity")
	}

	refreshSeconds, err := strconv.Atoi(envDefault("CERT_REFRESH_INTERVAL_SECONDS", "60"))
	if err != nil {
		return fmt.Errorf("parse CERT_REFRESH_INTERVAL_SECONDS: %w", err)
	}

	if refreshSeconds < 1 || refreshSeconds > 86400 {
		return errors.New("invalid certificate refresh interval")
	}

	certificates := &maintenance.Certificates{
		Root:        root,
		Domain:      envDefault("CERT_DOMAIN", "localhost"),
		Local:       os.Getenv("ENVIRONMENT") == "local",
		MinValidity: time.Duration(minValidity) * time.Second,
		Source:      maintenance.CertificateFiles(os.Getenv("NATS_CERT_FILE"), os.Getenv("NATS_KEY_FILE")),
	}

	if filename := os.Getenv("NATS_CA_FILE"); filename != "" {
		ca, err := os.ReadFile(filename)
		if err != nil {
			return fmt.Errorf("read TLS CA file %q: %w", filename, err)
		}

		certificates.Roots = x509.NewCertPool()

		if !certificates.Roots.AppendCertsFromPEM(ca) {
			return fmt.Errorf("invalid TLS CA file %q", filename)
		}
	}

	if err := certificates.Refresh(startupCtx); err != nil {
		return fmt.Errorf("bootstrap TLS certificate: %w", err)
	}

	defaults := map[string]string{
		"NATS_SERVER_NAME":      identity.Name,
		"NATS_STORE_DIR":        store,
		"NATS_MAX_MEMORY_STORE": envDefault("NATS_MAX_MEMORY_STORE", "256M"),
		"NATS_JETSTREAM_UNIQUE_TAG": envDefault(
			"NATS_JETSTREAM_UNIQUE_TAG",
			"az:",
		),
		"NATS_WEBSOCKET_ADVERTISE": envDefault("NATS_WEBSOCKET_ADVERTISE", "localhost:9222"),
		"NATS_TLS_CERT":            filepath.Join(root, "current", "server.crt"),
		"NATS_TLS_KEY":             filepath.Join(root, "current", "server.key"),
		"NATS_DEBUG_MODE":          envDefault("NATS_DEBUG_MODE", "false"),
		"NATS_TRACE_MODE":          envDefault("NATS_TRACE_MODE", "false"),
		"NATS_SAME_ORIGIN":         envDefault("NATS_SAME_ORIGIN", "false"),
		"NATS_ALLOWED_ORIGINS":     envDefault("NATS_ALLOWED_ORIGINS", "[]"),
	}

	for name, value := range defaults {
		if err := os.Setenv(name, value); err != nil {
			return fmt.Errorf("set broker environment %s: %w", name, err)
		}
	}

	options, err := server.ProcessConfigFile(config)
	if err != nil {
		return fmt.Errorf("load broker configuration %q: %w", config, err)
	}

	if options.Trace || options.TraceVerbose {
		return errors.New("protocol tracing is disabled for the auth-bearing broker")
	}

	options.Logtime = true

	if identity.PrivateIP != "" {
		options.ClientAdvertise = net.JoinHostPort(identity.PrivateIP, strconv.Itoa(options.Port))
		options.Cluster.Advertise = net.JoinHostPort(identity.PrivateIP, strconv.Itoa(options.Cluster.Port))
	}

	if routes != "" {
		for address := range strings.SplitSeq(routes, ",") {
			route, err := url.Parse(address)
			if err != nil {
				return fmt.Errorf("parse cluster route %q: %w", address, err)
			}

			if route.Host == "" {
				return errors.New("invalid cluster route")
			}

			options.Routes = append(options.Routes, route)
		}
	}

	capacity, err := strconv.Atoi(envDefault("NATS_AUTH_WORKERS", "16"))
	if err != nil {
		return fmt.Errorf("parse NATS_AUTH_WORKERS: %w", err)
	}

	worker, err := admission.NewWorker(
		&auth.RuntimeVerifier{},
		capacity,
	)
	if err != nil {
		return fmt.Errorf("create admission worker: %w", err)
	}

	settings := admission.Settings{
		Node:             identity.Name,
		Digest:           digest,
		Policy:           p,
		Protocol:         protocol,
		Worker:           worker,
		MaxConcurrent:    128,
		MaxAttempts:      4,
		AttemptTimeout:   300 * time.Millisecond,
		AdmissionTimeout: 1500 * time.Millisecond,
		ResponseReserve:  50 * time.Millisecond,
	}

	if check {
		if err := broker.ConfigureCallout(options, p, identity.Name, os.Getenv("NATS_CALLOUT_PASSWORD"), protocol.Issuer, xkey); err != nil {
			return fmt.Errorf("configure broker auth callout: %w", err)
		}

		if err := broker.ConfigureRegistration(options, *registration, os.Getenv("NATS_CALLOUT_PASSWORD")); err != nil {
			return fmt.Errorf("configure broker registration: %w", err)
		}

		return nil
	}

	runtime, err := broker.StartRuntime(ctx, broker.RuntimeConfig{
		Registration:        registration,
		Options:             options,
		Admission:           settings,
		Password:            os.Getenv("NATS_CALLOUT_PASSWORD"),
		Identity:            identity,
		Certificates:        certificates,
		CertificateInterval: time.Duration(refreshSeconds) * time.Second,
		HealthAddress: envDefault(
			"NATS_HEALTH_ADDRESS",
			"0.0.0.0:3020",
		),
		ControlSocket: envDefault("NATS_CONTROL_SOCKET", "/run/lixpi-nats/control.sock"),
	})
	if err != nil {
		return fmt.Errorf("start broker runtime: %w", err)
	}

	slog.Info(
		"embedded broker admission started",
		"protocol",
		policy.ProtocolVersion,
		"trustDigest",
		digest,
		"node",
		identity.Name,
	)

	if err := runtime.Run(ctx); err != nil {
		return fmt.Errorf("run broker runtime: %w", err)
	}

	return nil
}
