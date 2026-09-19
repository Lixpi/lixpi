---
title: Caddy Certificate Operations
description: Running local issuance, trusting the development CA, monitoring renewals and recovering durable state.
---

# Caddy Certificate Operations

A successful certificate-manager invocation means it completed maintenance, published any changed serving pairs and sent its metrics. It does not prove that a broker has loaded those files. Check issuance, delivery and the served certificate separately when investigating a TLS failure.

## Local certificates and trust

Compose builds [the service image](../Dockerfile) from the repository root and runs local issuance as a one-shot dependency. Preserve the `caddy-certs` volume between runs. It holds the development CA as well as the exported certificate and key; removing it creates a different CA that existing host trust will not recognize.

The service exports the public CA at `/certificates/ca.crt`. To copy it out of a default Compose volume:

```bash
docker run --rm -v lixpi_caddy-certs:/certs:ro busybox cat /certs/ca.crt > ca.crt
```

The volume's actual name follows the Compose project name. The local web UI also serves this public certificate at `http://localhost:3001/certs/ca.crt`. Export only the public root, never the CA key or serving private key.

Install the CA in the development machine's trusted roots:

- On macOS, import `ca.crt` into the System keychain with Keychain Access and set its trust to Always Trust. The command-line equivalent is `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt`.
- On Linux, copy it to `/usr/local/share/ca-certificates/lixpi-local-ca.crt`, then run `sudo update-ca-certificates`.
- On Windows, import it into Trusted Root Certification Authorities through `certlm.msc`, or run `Import-Certificate -FilePath "ca.crt" -CertStoreLocation Cert:\LocalMachine\Root` in an administrator PowerShell.

Restart clients after installing trust. A browser with a separate trust store may need an explicit CA import; Firefox exposes this under Settings, Privacy & Security, Certificates, Authorities. This root is for local development and must not be installed as the public deployment's trust anchor.

Local issuance exits nonzero on timeout or invalid material, so dependent Compose services do not treat an incomplete export as ready. If an export fails after some files have been written, rerun local issuance before starting its consumers. The long local lifetimes reduce routine reissuance, but the CA and leaf still have expiry dates.

## Public deployment

[Pulumi](../../../infrastructure/pulumi/src/resources/certificate-manager/README.md) builds the image, creates the function and storage, configures permissions and invokes initial maintenance. NATS startup depends on that initial invocation. EventBridge invokes the same function every six hours. Reserved concurrency of one serializes scheduled and deployment work against the shared state bucket.

The function needs outbound access to AWS APIs, certificate authorities and DNS resolvers. Route53 DNS-01 does not need an A record pointing to the Lambda or an inbound listener. When the function is placed in private subnets, the deployment must provide the required outbound connectivity.

Keep the configured Lambda timeout longer than the issuance wait. The default 900-second function timeout and 780-second issuance budget leave time to stop Caddy and save state. If an invocation approaches its deadline, the manager shortens issuance to reserve the final minute. A hard runtime termination can prevent the upload; inspect Lambda timeout errors as well as renewal errors.

## State recovery

The encrypted, versioned S3 object contains ACME account keys and renewal data, not just serving certificates. The bucket is protected from Pulumi deletion, and certificate secrets have a 30-day deletion recovery window. Keep access to the state bucket limited to the certificate manager and authorized recovery operators. Brokers need access only to their serving secret.

If restoration fails, inspect the S3 response and invocation logs first. Fix permissions or connectivity for an unavailable object. For damaged contents, restore a known-good version of `caddy-state.tar.gz` and invoke maintenance again. Do not delete state to force issuance: that discards account and renewal history and can trigger avoidable certificate requests.

A failed renewal still saves recoverable account and issuer progress. A failed state upload prevents publication. If publication fails after a successful upload, the next run can restore the completed certificate and retry publication without requesting another certificate. A failed secret read leaves the current value untouched.

Never run two public maintenance processes against the same bucket outside the function's concurrency control. The full-tree snapshot is protected by serialized invocation, not by an S3 distributed lock.

## Alarms and delivery failures

The manager's CloudWatch alarms cover Lambda errors, two missed six-hour success periods and less than seven days of certificate life. The exported `alertTopicArn` identifies its SNS topic. `NATS_OPERATIONAL_ALERT_EMAIL` asks Pulumi to create an email subscription; the recipient must confirm it before SNS delivers mail. Existing incident destinations can be supplied through `alarmActions` or subscribed to the topic.

The deployment adapter reads the serving secret and supplies the pair to NATS. The broker checks the candidate and switches its certificate pointer without a full NATS configuration reload. New TLS handshakes use the new pair; existing WebSocket sessions retain their established connection. Failed delivery or validation retains the installed certificate. [NATS operations](../../nats/documentation/OPERATIONS.md) describes the immutable certificate directories, fingerprint probe and rollback.

The adapter publishes `CertificateRefreshHealthy` and `CertificateValidBeyondSevenDays` measurements for the broker fleet and individual servers. Fleet alarms use the minimum health value and treat missing fleet samples as failure. Fleet health alone cannot identify a single node that stopped publishing samples.

Start an investigation with the manager's `CERTIFICATE_MAINTENANCE_COMPLETE` or `CERTIFICATE_RENEWAL_FAILED` events, then compare the secret with the broker's served certificate. Broker refresh errors use `certificate refresh failed; retaining installed certificate`. A fresh secret is insufficient when file delivery or installation failed. Certificate API outages do not by themselves justify replacing healthy NATS tasks.

## Verification

The shared [Go Testing and Tooling guide](../../../documentation/testing/Go/TESTING-GUIDE.md) contains build, dependency, race-test and linter commands. The `caddy` suite uses generated certificates, a real embedded internal CA and fake AWS clients. It covers local exports and reuse, trust and key checks, renewal windows, ARI, archive recovery, failed state operations, unchanged secret publication and metric names.

The infrastructure suite uses Pulumi mocks to verify serialization, scheduling, retention and alarms. NATS certificate tests cover live broker rotation. These checks do not issue a public certificate or modify Route53. Actual ACME issuance, deployed IAM permissions and SNS delivery must be checked in the target account through its deployment process.
