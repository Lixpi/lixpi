---
title: Certificate Manager Infrastructure
description: Pulumi resources for Caddy Lambda execution, certificate storage, renewal scheduling and alarms.
---

# Certificate Manager Infrastructure

This directory contains Pulumi resources and certificate-reference helpers. The [Caddy service](../../../../../services/caddy/README.md) owns the Go executable, container image, issuance, validation and publication behavior. Its [operations manual](../../../../../services/caddy/documentation/OPERATIONS.md) covers local CA trust, state recovery and delivery diagnosis.

## Image and invocation

`createLambdaCertificateManager` builds the Dockerfile supplied by its caller and creates the ECR repository and Lambda function. The main Pulumi program supplies `/usr/src/service/services/caddy/Dockerfile` with repository-root context `/usr/src/service`. The image contains the static `lixpi-caddy` executable and CA roots; Lambda starts that executable directly.

The function has a stable name, reserved concurrency of one and a default timeout of 900 seconds. It receives domains, ACME email, hosted-zone ID, state bucket, serving-secret prefix and metric dimension through environment variables. An initial invocation establishes the certificate dependency used by NATS deployment. An EventBridge rule invokes the same function every six hours, with bounded event age and retries. Failed maintenance returns a Lambda invocation error.

## Storage and permissions

The private state bucket enables versioning and AES256 server-side encryption, blocks public access and is protected from Pulumi deletion. Its `caddy-state.tar.gz` object stores durable Caddy account, certificate and renewal state. The function role can read and write that object. One concurrent invocation prevents competing whole-tree uploads.

For Secrets Manager publication, the resource creates each serving secret before invoking the function and retains a 30-day deletion recovery window. Secret names derive from the configured prefix and domain. The certificate helper supplies references and environment settings to the consuming deployment. The Caddy executable supports public publication through Secrets Manager; its local mode exports files for Compose.

The function role has Route53 DNS-challenge permissions, scoped to the supplied hosted zone where the AWS action supports it. CloudWatch metric writes are restricted to `Lixpi/Certificates`. Basic Lambda logging permissions are attached, with VPC execution permissions when private subnets are supplied. A VPC-attached function needs outbound connectivity to AWS, DNS and certificate-authority endpoints.

## Alarms and certificate delivery

CloudWatch alarms detect Lambda errors, two missing six-hour maintenance-success periods and less than seven days of certificate life. Their actions include the manager's SNS topic and any supplied `alarmActions`. The topic ARN is returned as `outputs.alertTopicArn`. `NATS_OPERATIONAL_ALERT_EMAIL` creates an email subscription that the recipient must confirm.

The [NATS deployment adapter](../NATS-cluster/README.md) reads the published pair and supplies files through a shared volume. The broker validates and rotates those files without restarting its serving process. Brokers can read their serving secret but cannot read ACME account state or publish certificates. Issuance alarms and broker delivery alarms cover separate failure paths; see [Caddy operations](../../../../../services/caddy/documentation/OPERATIONS.md) and [NATS operations](../../../../../services/nats/documentation/OPERATIONS.md).

## Verification

The colocated Pulumi tests use mocked resources to check concurrency, scheduling, retention and alarms. Run them through the shared infrastructure test domain:

```bash
docker compose -f docker-compose.typescript-test-runner.yml --profile dev run --rm --no-deps -T lixpi-typescript-test-runner infrastructure src/resources/certificate-manager/lambda-certificate-manager.test.ts
```

The [Go Testing and Tooling guide](../../../../../documentation/testing/Go/TESTING-GUIDE.md) documents the Caddy runtime suite. Public ACME issuance and deployed IAM permissions are verified through the target account's deployment process.
