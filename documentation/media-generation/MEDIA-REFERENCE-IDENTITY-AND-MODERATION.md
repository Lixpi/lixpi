---
title: Media Reference Identity and Provider Moderation
description: Durable provider-safe media requests, Asset identity attestations, native verification, provider policy profiles, and recoverable canvas states.
---

# Media Reference Identity and Provider Moderation

Every image or video request crosses one provider-neutral boundary before a reasoning or generation provider receives it. That boundary separates mutable workspace display metadata from provider intent, persists requests that can pause, applies the selected provider's explicit policy profile, and projects recoverable state into the API-planned canvas lineage slot.

## Boundary invariants

- Asset titles and original filenames are UI/audit metadata. When they identify an attached reference, they cannot appear in reasoning context or provider payloads.
- Stable Asset IDs remain internal authority. Providers receive request-scoped aliases such as `REFERENCE_1` plus authorized descriptors and selected pixels/frames.
- Unmatched text remains user intent. Lixpi does not redact a name merely because it resembles a person or public figure.
- An ambiguous match or missing native verification pauses before a paid media call.
- A provider rejection is terminal for that run. Lixpi never automatically retries a cosmetically rewritten paid request.
- Every current and future media provider requires a validated `MediaProviderDefinition`; startup fails when a current provider profile is missing.

The compiler assigns aliases in canonical reference order, collapses multiple canvas placements of one Asset for matching, and fingerprints canonical safe text together with stable Asset IDs. It scans forbidden checkpoint and current title/filename variants after compilation, after reasoning/branch context assembly, and immediately before provider transport.

## Local reference matching

`media-reference-matcher.ts` compares free-form prompt windows only with the user-visible title and filename identities of Assets attached to the current request. It normalizes Unicode, case, punctuation, possessives, common plurals, generic media suffixes, bounded edit distance, token overlap, and character trigrams. A phrase containing only non-identifying function words cannot match an Asset. Descriptor summaries and entity/style tags remain provider-safe generation context; they are never Asset identity aliases and cannot trigger reference resolution.

A score must meet the unique threshold and beat the runner-up by the versioned winning margin. Close candidates become `awaiting-reference-resolution`; zero matches preserve the original text. Requests are capped at 32 unique bindings and ambiguity records expose at most five candidates.

Explicit ProseMirror media-reference atoms never require text matching. Their authorized `assetId` maps directly to the assigned alias. Persisted user resolutions are honored only when the phrase still matches a current identity variant, preventing obsolete matcher decisions from rewriting ordinary instructions after a matcher upgrade.

## Durable media request

`MediaGenerationRequest` is the authority for multi-model execution and recovery. It stores:

- owner, organization, Workspace, and conversation Asset identity;
- the organization Blob hash for an immutable structured checkpoint;
- safe reference bindings and unresolved candidate records;
- user-selected resolutions;
- per-reasoning/per-media-model run state with stable media-run, Asset, operation-node, and output-node IDs;
- provider verification sessions containing hashes and provider/account scope, never provider tokens;
- a compare-and-swap revision and status timestamps.

The checkpoint contains the original ProseMirror request document, stable selected Asset/node IDs, model selection, generation configuration, and display snapshots needed for restoration and leak guards. Checkpoint validation rejects media data URLs, buffers/typed arrays, provider tokens, authorization values, cookies, API keys, and secrets.

Paused requests are never TTL-cancelled. Completed requests release their checkpoint after every run and durable output/canvas/conversation state settle. Failed, mixed-error, and action-required requests retain it until explicit Dismiss/Cancel or Workspace deletion. Workspace cleanup removes the request/meta/access rows, checkpoint reference, and request event subject idempotently.

## Request state and canvas recovery

Reference selection and native verification use the same request ID and CAS revision. The API reauthorizes every bound Asset on reference resume, refreshes revisions/descriptors/identity, and retains both checkpoint and current forbidden display variants. A user-selected visual branch target is persisted and bypasses another ambiguous VLM decision.

Each run owns an `operationStatus` state node and a stable pending image/video output node created when the request is accepted. The operation points to `outputNodeId`, and branch planning enriches that same output with its exact API lineage assignment. The state moves through:

- `in-progress`, with its operation node kept state-only while the output media node renders its own progress timeline;
- `action-required` with an anchored candidate picker or native-verification action;
- `failed` with sanitized provider details, Edit request, and Dismiss.

Only `action-required` and `failed` render a separate recovery card because those states need an interactive surface.

Successful output projection replaces the planned node identity in place and preserves branch edges. Successful siblings remain when another run fails. Edit request restores the checkpointed ProseMirror document and model/config selection but performs no provider call; only a new explicit Submit creates a new paid request ID.

The browser loads request metadata, subscribes to the tokenized live subject, then replays JetStream events. It deduplicates by `streamSequence`, closing the live/replay race across reloads.

## Medium, subject identity, and attestations

`Asset.depictionMedium` is required and automatically derived from descriptor evidence. `Asset.subjectIdentity` is separately required and defaults to `unknown`. A painting can depict a real person; medium never proves identity.

The existing canvas Asset information panel and Media Library inspector use the same five-position `slidingSwitch`. A switch change is the complete attestation action—there is no modal, proof upload, second checkbox, or confirmation dialog. The server owns these exact versioned statements:

- `no-person`: the Asset does not depict a person.
- `fictional`: any depicted person or character is not asserted to be a real identifiable individual.
- `self`: the authenticated actor states that they are the depicted person and authorize the organization's permitted generation use.
- `authorized-real-person`: the authenticated actor states that the organization has the necessary rights or consent for the depicted real person.
- `unknown`: no active assertion; selecting it supersedes/revokes the prior assertion.

Every append-only attestation records Asset/revision, actor, organization, timestamp, classification, statement version, and superseded attestation ID. The Asset revision and current projection update transactionally. Switching to `unknown`, `no-person`, or `fictional` revokes provider verification handles.

Lineage inheritance is conservative. `no-person` inputs do not create conflicts. Compatible person-bearing inputs must agree on classification, active attestation state, and identity group. Unknown ancestry, fictional/real mixtures, missing groups for real classifications, or different groups resolve to `unknown`. Provider handles inherit only when all relevant inputs carry the same valid handle and the provider profile explicitly allows documented derivative reuse in the same account/project.

## Provider policy profiles

Every provider definition owns supported media inputs, positional alias compilation, moderation settings, verification strategy, problem normalization, retention/sensitive-data notes, official documentation URLs, review date, and profile version.

Current controls are:

| Provider | Required behavior |
|---|---|
| OpenAI | GPT Image requests use `moderation: 'low'`; automatic retry is `never`. |
| Google | Veo requires `GOOGLE_VEO_PERSON_GENERATION_PROFILE=standard|restricted`. Standard text-to-video and extension use `allow_all`; image-conditioned requests use `allow_adult`; restricted profiles use `allow_adult`. Unsupported/missing configuration fails visibly. |
| Stability | Fixed provider policy, shared anti-leak compiler, normalized failures, no automatic retry. |
| BytePlus | Fixed Seedance policy, positional alias conversion, native verification preflight for classified real-person references, normalized failures, no automatic retry. |
| Anthropic | Reasoning-only profile; receives provider-safe context and never registers a media capability. |

Runway cannot be added without a profile that sets `contentModeration.publicFigureThreshold: 'low'`, normalizes failures, and declares automatic retry `never`.

Provider errors normalize to `MediaGenerationProblem` with category, stage (`preflight`, `submit`, `poll`, `download`, or `persist`), provider/model/code, sanitized reason, support code, and allowed action. Logs contain those bounded fields, never raw prompt text, URLs, tokens, response bodies, or binary payloads.

## BytePlus native verification

BytePlus real-person verification is provider-hosted. Lixpi creates a short-lived session, opens the returned H5 URL, signs callback state with `PROVIDER_VERIFICATION_STATE_SECRET`, and stores only state/session token hashes. Verification media goes directly to BytePlus; it never enters a Lixpi API request, Blob, or checkpoint.

The callback validates signature, expiry, request/user/session scope, one-time status, and the returned `bytedToken`. The configured exchange endpoint must complete the BytePlus result lookup plus provider private-human Asset/group activation and return the usable provider Asset ID as `subject_handle`. Seedance receives that as `asset://<subject_handle>` under the configured `BYTEPLUS_ACCOUNT_SCOPE`.

Required runtime configuration:

```text
API_PUBLIC_URL
PROVIDER_VERIFICATION_STATE_SECRET
BYTEPLUS_ACCOUNT_SCOPE
BYTEPLUS_PROJECT_NAME
BYTEPLUS_IDENTITY_VERIFICATION_SESSION_URL
BYTEPLUS_IDENTITY_VERIFICATION_EXCHANGE_URL
ARK_API_KEY
GOOGLE_VEO_PERSON_GENERATION_PROFILE=standard|restricted
```

Invalid, expired, revoked, or wrong-account handles pause at preflight. Callback replay and stale request revisions are rejected.

## Storage and transport

DynamoDB tables:

- `Media-Generation-Requests` — authoritative aggregate;
- `Media-Generation-Requests-Meta` — Workspace/status recovery projection;
- `Media-Generation-Requests-Access-List` — owner and Workspace principals;
- `Asset-Subject-Identity-Attestations` — parent-authorized append-only audit events.

The request event stream is per Workspace and has one subject per request. It has no age-based cancellation/expiry; explicit checkpoint retention cleanup purges the subject. Browser commands are `GET`, `REPLAY`, `RESOLVE_REFERENCE`, `CANCEL`, `VERIFICATION_START`, and `VERIFICATION_COMPLETE`; live events use the tokenized `STATUS` relay.

## Migration and strict cutover

The one-time migration adds required conservative Asset identity fields, recomputes safe generated lineage, and converts legacy `uploadPlaceholder` nodes to `operationStatus`. Runtime Asset/canvas validation rejects legacy shapes; there is no compatibility union.

Run preflight and apply only inside the API Docker container:

```bash
docker exec lixpi-api pnpm migrate:unified-media-reference
docker exec lixpi-api pnpm migrate:unified-media-reference --apply
```

Preflight reports legacy IDs and quarantined corrupt records without writes. Apply refuses quarantined input and performs a postflight audit; deployment activation requires zero remaining legacy or quarantined records.

## Provider onboarding gate

A new image/video provider is incomplete until it supplies and tests:

1. a `MediaProviderDefinition` with media capabilities, supported inputs, positional alias compiler, and final leak assertion;
2. exact least-restrictive documented settings for every supported model/input/region/account profile;
3. `automaticRetry: 'never'`, cost-on-filter metadata, retention notes, sensitive-data notes, official URLs, review date, and profile version;
4. synchronous, polling, download, persistence, moderation, capacity, and output problem normalization;
5. an explicit native-verification strategy and derivative-handle reuse policy;
6. setting-matrix, registration, leak, sanitization, no-retry, and failure-stage tests.

Relevant implementation starts at [`media-reference-compiler.ts`](../../services/api/src/llm/media-reference/media-reference-compiler.ts), [`media-generation-request-service.ts`](../../services/api/src/services/media-generation-request-service.ts), [`media-provider-definition.ts`](../../services/api/src/llm/providers/media-provider-definition.ts), and [`asset-subject-identity-service.ts`](../../services/api/src/services/asset-subject-identity-service.ts).
