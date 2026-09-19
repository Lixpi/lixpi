---
title: Caddy Test Certificates
description: Creating disposable certificate authorities and serving pairs for certificate and maintenance tests.
---

# Caddy Test Certificates

This package creates certificate fixtures for the service's tests. [`authority.go`](authority.go) generates a disposable ECDSA authority and exposes its trust pool. `Authority.Issue` signs a serving certificate for a supplied domain and validity period, returning the same certificate/key pair type used by publication.

Tests choose the validity window so they can exercise expired certificates, renewal thresholds and ready certificates without waiting for time to pass. Each authority has its own generated key, so trust failures can be tested without reading application keys or changing the machine's trust store.

`Write` stores a pair and caller-supplied renewal metadata under a synthetic Caddy issuer directory. It uses CertMagic's safe domain filename, including for wildcard domains. This lets tests exercise the actual certificate reader, archive code and maintenance manager against filesystem fixtures.

The package imports Go's `testing` API and is used only by test files. Production packages must not import it. It doesn't exercise a public authority or Route53; [`main_test.go`](../../cmd/lixpi-caddy/main_test.go) separately runs Caddy's real internal CA. The shared [Go Testing and Tooling guide](../../../../documentation/testing/Go/TESTING-GUIDE.md) documents the Docker test runner.
