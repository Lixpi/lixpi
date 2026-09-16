---
title: Provider Request Authorization
description: Upper-bound provider usage estimates and the authorization decision before provider transport.
---

# Provider Request Authorization

`estimateProviderUsageForRun()` produces a model's modality, upper-bound usage quantity, and an estimate basis. `ProviderUsageClient.authorizeRequest()` sends that request over `metrics.provider.request.authorize`. A negative decision prevents provider transport.

The request names the model actually invoked. A reasoning call uses token modality even when its workflow will later generate media. Each transient media call needs authorization for its own model.

## Usage estimates

For text, `estimatedUnits = ceil(promptTokensMeasured * UNMEASURED_PROMPT_GROWTH_FACTOR) + completionCeiling`. The growth factor is 2. It allows for later context and Tool assembly but cannot guarantee a bound on arbitrarily large additions. The completion ceiling uses the request's explicit maximum, then the model maximum, then the remaining context window. `completionCeilingFrom` records which value supplied it.

An image generation run estimates one image. Separate model and Capability runs authorize independently.

Video uses the called inference provider's catalog usage unit. Per-second models use clip duration. Token-based models use [video token accounting](SEEDANCE-VIDEO-TOKENS.md). Published duration choices constrain the estimate; an unsupported choice uses the longest published duration, and a model without duration choices uses the requested duration. Source video contributes its measured duration, or the longest published duration when the source duration is unavailable.

## Results and logs

The result contains `authorized`, an optional opaque `authorizationId`, and an optional neutral reason. The ID accompanies later usage records. `logRequestAuthorization()` records the model, modality, quantity, estimate basis, decision, and correlation fields.

A provisional video frame size logs at warning level because its token estimate uses provisional dimensions. Estimates remain distinct from measured usage.

The API graph adapter is `services/api/src/llm/usage/provider-usage-estimate.ts`. Callers outside the graph can use the shared estimator directly.
