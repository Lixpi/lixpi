---
title: Caddy AWS Storage Adapter
description: Loading durable state from S3 and publishing certificate pairs and maintenance metrics through AWS SDK clients.
---

# Caddy AWS Storage Adapter

This package implements the maintenance manager's backend with AWS SDK v2 clients. [`backend.go`](backend.go) loads and saves Caddy state in S3, writes serving pairs to Secrets Manager and reports CloudWatch metrics. The command supplies the clients and resource names; Pulumi creates the resources and their permissions.

`Load` reads `caddy-state.tar.gz` with a size limit. Only an S3 `NoSuchKey` response means no state exists yet. Access denial, network errors and failed reads return errors so the manager cannot silently start with an empty account tree. `Save` uploads the archive as gzip with S3 AES256 server-side encryption.

`Publish` derives the secret name from the configured prefix and domain, replacing `*` with `wildcard` and dots with hyphens. It follows every page of secret versions to find `AWSCURRENT`, then reads and compares the published certificate/key pair. An unchanged pair needs no write. A version-listing error, failed secret read or invalid JSON stops publication rather than being treated as an empty secret.

A changed pair is written as one JSON value containing `certificate` and `private_key`. The SDK generates the request's idempotency token and reuses it across retries. The token must not be derived from certificate content: restoring a previously published pair can require a new write to make that pair current again. See the [Secrets Manager write contract](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html).

`Metrics` sends `CertificateMaintenanceSuccess` and `CertificateSecondsRemaining` in the `Lixpi/Certificates` namespace with the configured `Manager` dimension. The manager calls it after all publications succeed and supplies the shortest remaining certificate lifetime.

Change this package when AWS request formats, secret naming or metrics change. [`backend_test.go`](backend_test.go) supplies SDK-compatible clients to check pagination, unchanged pairs, repeat publication and failures without contacting AWS. [Configuration](../../documentation/CONFIGURATION.md) documents the storage and metrics contracts; the [Pulumi resource manual](../../../../infrastructure/pulumi/src/resources/certificate-manager/README.md) covers IAM, scheduling and alarms.
