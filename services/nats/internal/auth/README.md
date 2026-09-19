---
title: NATS Credential Verification
description: Proving the client identity and binding its permissions to the broker's pending connection.
---

# NATS Credential Verification

This package decides whether a connecting client has proved an identity and which registered account and permissions it should receive. It accepts browser JWTs, registered service JWTs and native NKey challenge signatures. It does not decide which peer should do the work or whether a user may edit a particular workspace.

There are two checks. `Protocol` verifies the signed, encrypted request from NATS and binds the response to that pending connection. `Verifier` checks the credentials inside it. Both matter: even a valid browser token must not produce an authorization response for an unrelated or expired connection request.

`runtime.go` selects service keys and browser profiles from the authoritative snapshot pinned by admission. The broker does not discover application identities from its environment. Browser signing keys come from the bounded JWKS cache. An invalid signature returns a denial; a failed key fetch returns unavailable. Keeping those outcomes separate lets the dispatcher retry an operational failure without asking another worker to override a rejected credential.

On success, the protocol signs and encrypts the NATS response carrying the account and permissions. The server then enforces them. [Credential verification](../../documentation/MODULES.md#credential-verification) explains each file and credential branch; [One connection attempt](../../documentation/ARCHITECTURE.md#one-connection-attempt) shows the exchange.
