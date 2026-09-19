---
title: Caddy Service Configuration
description: Commands, environment settings, certificate files and AWS storage contracts.
---

# Caddy Service Configuration

The container starts `/usr/local/bin/lixpi-caddy`. Configuration comes from environment variables supplied by Compose or Pulumi. Native Caddy configuration is constructed in Go, so there is no Caddyfile template to render at startup.

## Commands

| Command | Behavior |
|---|---|
| No arguments | Uses the Lambda runtime when `AWS_LAMBDA_RUNTIME_API` is set; otherwise selects local mode through `CADDY_LOCAL_MODE` or runs public maintenance once |
| `local` | Issues and exports the local `localhost` certificate, then exits |
| `maintain` | Runs public maintenance, or enters the Lambda invocation loop when the runtime API is present |
| `version` | Prints the embedded Caddy version and exits |

The explicit `local` command selects local issuance. Lambda invocation handling always selects public maintenance. An invalid command exits nonzero before starting Caddy.

## Local settings

| Variable | Meaning | Default |
|---|---|---|
| `CADDY_LOCAL_MODE` | Selects local mode outside Lambda when equal to `true` | Public maintenance |
| `CADDY_CERTIFICATES_DIR` | Writable Caddy state and exported certificate directory | `/certificates` |

Local mode issues for `localhost` and has a one-minute deadline. It does not require `DOMAINS`, email or AWS settings. Compose mounts the shared `caddy-certs` volume at `/certificates`; NATS and the local web UI consume the exported files from that volume.

## Public settings

| Variable | Meaning | Default |
|---|---|---|
| `DOMAINS` | Comma-separated DNS names, including optional leading wildcards | Required |
| `CADDY_EMAIL` | ACME registration email | Required |
| `CADDY_STATE_BUCKET` | S3 bucket containing the durable Caddy archive | Required |
| `SECRETS_PREFIX` | Prefix of existing serving-certificate secrets | Required |
| `CERT_MANAGER_NAME` | `Manager` dimension for CloudWatch measurements | Required |
| `CERT_TIMEOUT_SECONDS` | Issuance wait, from 1 through 840 seconds | `780` |
| `AWS_HOSTED_ZONE_ID` | Route53 hosted zone used for DNS challenges | Provider discovers the zone when omitted |
| `AWS_REGION` | Region supplied to the AWS clients and Route53 provider | AWS SDK configuration chain |
| `STORAGE_TYPE` | Serving publication backend | `secrets-manager`; other explicit values are rejected |

The domain reader trims whitespace, lowercases names and removes duplicates. Empty entries, URLs, IP addresses, path characters and invalid DNS labels are rejected. Public inputs use ASCII DNS names; supply internationalized names in their ASCII representation.

The service uses the AWS SDK credential chain, including the Lambda execution role. Static credentials are not embedded in the image or Caddy configuration. The Lambda runtime provides `AWS_LAMBDA_RUNTIME_API` and the per-invocation deadline. The image directs Caddy's ancillary XDG paths into `/tmp`, which is writable in Lambda.

The Pulumi helper's broader storage types also describe certificate references for other consumers. This executable publishes public certificates to Secrets Manager. It rejects an explicit S3 or EFS serving-storage selection before issuance.

## Durable and serving formats

S3 stores the compressed Caddy tree at `caddy-state.tar.gz`. The key remains stable across image deployments. State contains private keys and must stay private, encrypted and recoverable. The [architecture guide](ARCHITECTURE.md) explains archive validation and transient locks.

For each domain, the secret name is the prefix followed by `-` and the domain with `*` replaced by `wildcard` and `.` replaced by `-`. For example, prefix `nats-certs` and domain `*.example.com` produce `nats-certs-wildcard-example-com`. The JSON value has this shape:

```json
{
    "certificate": "-----BEGIN CERTIFICATE-----\n...full PEM chain...",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...matching PEM key..."
}
```

The certificate secret must already exist. Pulumi creates it before invoking the function. An empty secret receives its first value; an unchanged current value does not receive another version.

Local consumers read `ca.crt`, `localhost.crt` and `localhost.key`. Caddy's own CA and issuance data remain alongside those exports. Preserve the entire volume to preserve the development CA, rather than retaining only the exported leaf certificate.

## Metrics and logs

CloudWatch namespace `Lixpi/Certificates` receives `CertificateMaintenanceSuccess` with value `1` and unit `Count`, plus `CertificateSecondsRemaining` with the shortest remaining certificate lifetime and unit `Seconds`. Both use the deployment's `Manager` dimension.

Structured service logs include the `LOCAL_CERTIFICATE_READY`, `CERTIFICATE_MAINTENANCE_COMPLETE` and Lambda failure `CERTIFICATE_RENEWAL_FAILED` event markers. Caddy writes its own structured issuer and renewal logs. The program does not log certificate private keys or secret payloads.
