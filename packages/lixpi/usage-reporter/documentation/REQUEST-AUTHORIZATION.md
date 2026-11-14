---
title: Provider Request Authorization
description: Upper-bound provider usage estimates and the authorization decision before provider transport.
---

# Provider Request Authorization

`estimateProviderUsageForRun()` produces a model's modality, upper-bound usage quantity, and an estimate basis. `ProviderUsageClient.authorizeRequest()` sends that request over `metrics.provider.request.authorize`. A negative decision prevents provider transport.

The request names the model actually invoked. A reasoning call uses token modality even when its workflow will later generate media. Each transient media call needs authorization for its own model.

## LocalAuth0 usage

The enabled integration remains active for LocalAuth0. In an explicitly local deployment, the paired responder can issue a durable authorization for the verified local account without checking, reserving or debiting a balance. It records measured usage and, when the current catalog can price it, computed cost in separate local records. An unavailable tariff does not discard the local measurement. No funds or placeholder balance are required. The existing request, measurement and completion contracts are unchanged.

The responder derives this policy from the main deployment's local authentication configuration and checks the coherent fixture account. Request payloads, headers, model output and organization names cannot select it. The API still verifies the user's identity and workspace access, and its private service connection owns the metrics requests. Hosted identities use normal authorization even when the services run locally. Nonlocal deployments reject local policy configuration and local authorization receipts.

Local receipts bind the organization, user, workflow, model and modality. Their measurements and completion acknowledgements survive retries and restarts. Switching a local deployment back to hosted authentication stops new local issuance while allowing already-issued local receipts to finish recording there. Local recording emits no balance updates or synthetic monetary transfers.

## Usage estimates

For text, `estimatedUnits = ceil(promptTokensMeasured * UNMEASURED_PROMPT_GROWTH_FACTOR) + completionCeiling`. The growth factor is 2. It allows for later context and Tool assembly but cannot guarantee a bound on arbitrarily large additions. The completion ceiling uses the request's explicit maximum, then the model maximum, then the remaining context window. `completionCeilingFrom` records which value supplied it.

An image generation run estimates one image. Separate model and Capability runs authorize independently.

Video uses the called inference provider's catalog usage unit. Per-second models use clip duration. Token-based models use [video token accounting](SEEDANCE-VIDEO-TOKENS.md). Published duration choices constrain the estimate; an unsupported choice uses the longest published duration, and a model without duration choices uses the requested duration. Source video contributes its measured duration, or the longest published duration when the source duration is unavailable.

## Results and logs

The result contains `authorized`, an optional opaque `authorizationId`, and an optional neutral reason. The ID accompanies later usage records. `logRequestAuthorization()` records the model, modality, quantity, estimate basis, decision, and correlation fields.

A provisional video frame size logs at warning level because its token estimate uses provisional dimensions. Estimates remain distinct from measured usage.

The API graph adapter is `services/api/src/llm/usage/provider-usage-estimate.ts`. Callers outside the graph can use the shared estimator directly.
