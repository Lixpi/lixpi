---
title: NATS Runtime Registrations
description: Signed registration validation, native persistence and identity-based permission expansion.
---

# NATS Runtime Registrations

This package defines what an application must submit for the broker to authenticate its clients. A registration binds public keys or a browser issuer to explicit NATS accounts and permissions. Deployment authorizes the declaration with a signature; a connecting client cannot grant itself permissions.

`registration.go` checks that signature, the authority's owner/account scope, identity uniqueness and permission syntax. `store.go` saves versioned manifests in the protected REGISTRATION account's JetStream KV stream and reads its leader for admission. `policy.go` defines internal transport subjects and expands identity placeholders in browser grants.

Application service names and subject declarations belong to the application. For Lixpi they live in the [subject registry](../../../../packages/lixpi/nats-subject-registry/README.md), which deployment tooling signs and API startup submits. The broker image does not import that package. [Runtime registration](../../documentation/ARCHITECTURE.md#runtime-registration) explains the boundary; [Configuration](../../documentation/CONFIGURATION.md#registration-protocol) describes the wire format.
