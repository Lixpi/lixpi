---
title: Caddy Certificate Validation
description: Selecting trusted serving material, deciding when maintenance is due and exporting local certificate files.
---

# Caddy Certificate Validation

This package decides whether certificate material can be served and whether it needs maintenance. [`certificates.go`](certificates.go) uses Go's TLS and X.509 libraries to check the certificate/key match, DNS name, validity period, server-auth usage and chain of trust. Public validation uses system roots; local mode supplies Caddy's generated root.

`Read` searches Caddy's issuer directories because a fallback authority may have issued the certificate. It uses CertMagic's safe domain filename and selects the valid candidate with the latest expiry. The candidate carries the checked PEM pair and parsed leaf together, so publication uses the material that was validated.

Validity and readiness are separate checks. `Candidate.Ready` requires the certificate to be outside the final third of its lifetime. It also reads persisted ACME Renewal Information, or ARI: the earlier of `_selectedTime` and `_retryAfter` can make maintenance due within the next minute. A missing metadata file leaves the lifetime check in charge; malformed metadata rejects that candidate. An ARI refresh can be due even when no replacement certificate is needed.

`LocalRoots` loads the generated CA certificate. `ExportLocal` validates `localhost` against it and writes `ca.crt`, `localhost.crt` and `localhost.key` into the shared directory. The public files use mode `0644`; the key uses `0600`. Compose waits for successful completion before starting consumers.

Changes to certificate acceptance and readiness belong here. NATS independently validates delivered files before installing them, as described in [NATS certificate maintenance](../../../nats/internal/maintenance/README.md). [`certificates_test.go`](certificates_test.go) covers validation and renewal decisions; [Public maintenance](../../documentation/ARCHITECTURE.md#public-maintenance) explains how the manager uses those decisions.
