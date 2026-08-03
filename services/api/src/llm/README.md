# LLM Module

The in-process TypeScript LangGraph workflow for conversation streaming, context resolution, multi-model media generation, Asset lineage, provenance, usage, and cancellation.

## Storage contract

- A conversation is an Asset with a `conversation` ProseMirror role.
- Every concrete image/video run receives a pending output Asset before provider fan-out.
- Media bytes and document/provenance JSON are organization content-addressed Blobs.
- Canvas nodes contain `assetId`; node IDs remain independent topology identities.
- The conversation streams once. Output provenance is projected from the settled conversation Asset at terminal state.

There is no document/chat-thread persistence model or workspace file storage adapter in this module.

## Entry points

`createLlmModule()` returns:

- `process()` for a single reasoning request;
- `processMediaGenerationMatrix()` for shared-preflight multi-model fan-out;
- `seedCapabilities()` for package seeding after every isolated module has registered its actions;
- `stop()` and `stopMediaGenerationMatrix()`;
- `shutdown()`;
- `getSubscriptions()` (currently empty because the API gateway invokes the module in-process).

The NATS gateway authenticates the conversation Asset, acquires its workspace lease, obtains the authoritative `organizationId` from the Asset, and renews the lease while the workflow runs.

## Workflow

```text
validateRequest
  → resolveWorkspaceContext
  → resolveCapabilities
  → executeRequiredCapabilities
  → resolveMediaBranch
  → streamTokens
  → planMediaBranchLineage
  → generate_image | generate_video | skip
  → calculateUsage
  → cleanup
```

Context snapshots contain only nodes and media candidates explicitly attached to the submitted turn. The API filters candidate snapshots against their explicit-reference allowlist before Asset authorization, ignores edge topology for context, and never ranks the rest of the canvas. It also extracts typed prompt-reference atoms from the authoritative latest user message, reauthorizes them, and materializes Asset-only media references without inventing canvas nodes. Media-enabled turns merge prompt references and composer context into the explicit candidate set; text-only reasoning turns attach the authorized image or representative frame directly to the latest user message. Video candidates use representative-frame/poster renditions; explicit extension resolves the authorized source video Asset to canonical/original MP4 internally.

Capability resolution maps selected top-level modules to their module-internal entry packages, accepts only structurally standalone Tool/Skill references on those categories, captures current manifest hashes, authorizes the transitive closure, enforces dependency and aggregate resource limits, and seals the plan. `required` Tools run before provider streaming. `model-required` Tools run exactly once inside each selected reasoning provider's agent loop before its final response, while `model-choice` Tools remain optional. Capability-only Artifact output is staged during that Tool round and attached to the Workspace only after the provider continuation has ended and its pending conversation writes have drained. The reasoning model also receives `search_capabilities` and `use_capability`; model-selected visual Tool output is folded back into the same provider state before lineage planning and generation. Transient media providers cannot recurse into those functions.

## Streams

Live interaction events:

```text
ai.interaction.chat.receiveMessage.<organizationId>.<conversationAssetId>               # internal canonical
ai.interaction.chat.receiveMessage.<userIdToken>.<organizationId>.<conversationAssetId> # authorized browser relay
```

Pipeline replay logs are keyed by workspace and conversation pipeline ID. `StreamPublisher` writes replay before live publication and preserves per-`mediaRunId` event ordering without serializing sibling runs.
The authorized browser interaction and conversation-document relays refresh authorization against the request's single Workspace and conversation Asset on a short interval, then forward events directly between refreshes. They carry the originating `workspaceId` and must never rebuild account-wide Workspace/Organization requester context for stream keepalives or ProseMirror step delivery.
Transient image/video providers forward media events to their owning reasoning provider; only that owner live-publishes the mirrored event, preventing duplicate partial and completion delivery. Matrix reasoning owners mirror provider lifecycle events to both the shared ProseMirror writer and the live response subject, while ordinary reasoning tokens remain single-published by the child stream.

Conversation document steps use:

```text
asset.document.steps.<organizationId>.<conversationAssetId>.conversation               # internal durable
asset.document.events.<userIdToken>.<organizationId>.<conversationAssetId>.conversation # authorized browser relay
```

`AiChatProseMirrorStreamAssembler` is the single writer for AI transcript steps. It parses streamed Markdown, updates reasoning/trace/generated-output nodes, and publishes expected-sequence step/control events through `AssetProseMirrorStepTransport`. Media generation trace blocks are keyed by the full media run inside a reasoning section, so image/video model fanout preserves one final prompt and trace per output instead of overwriting sibling variants. Capability generation traces use the same collapsible node and retain Tool identity, run ID, output Assets, and workflow-step summaries beside the provider's continued assistant response.

Conversation snapshot settlement is serialized per organization, Asset, and document role. Every attempt reloads the current Asset revision before the transaction, retries bounded revision conflicts, and suppresses logging only for those expected conditional losses; non-conditional transaction failures remain terminal and logged. Accepted client step batches are coalesced behind one idle-debounced settlement per Asset role. Final-response persistence cancels that pending idle settlement before using the same coordinator, so it cannot race a queued client settlement inside one API process. Structured settlement logs identify the trigger, coalesced batch count, current-Asset read origin, attempts, version, and duration.

Matrix requests carry an explicit `outputMediaTypes` list. Lineage planning, pending Asset creation, provider tool availability, and fanout use only those output sections; a default singular model from an inactive section must not become an extra branch assignment.
Before provider invocation, the API rebuilds messages and the current prompt from that authoritative conversation document; browser-serialized transcript history and prompt fingerprints are not trusted.

Generated-output replay is an explicit exception to reasoning prompt creation, not to authorization. The API validates that the requested preserved lineage marker exists in the editable Workspace and belongs to the supplied branch. A replay matrix carries output-scoped final media prompts keyed by reasoning model, media model, and modality. The provider graph skips `streamImpl`, injects each prompt only into its matching media fanout, retains the original model parameters, and creates replacement output Assets under the preserved marker. Its lineage plan includes the preserved regeneration target so clients never treat that committed marker as temporary UI geometry; all clients consume the same API-persisted marker and generated-media coordinates. Normal prompt regeneration does not use this replay contract and therefore creates a new API-planned lineage.

## Media preflight and Asset creation

Media-model requests first cross the durable [media reference and moderation boundary](../../../documentation/media-generation/MEDIA-REFERENCE-IDENTITY-AND-MODERATION.md). The NATS handler authorizes structured ProseMirror references, assigns `REFERENCE_n`, runs bounded local free-form matching, stores the immutable checkpoint, and returns before any reasoning/media call when ambiguity exists. Provider-safe messages and candidate/workspace snapshots exclude Asset titles and filenames. Leak assertions run after compilation and at provider transport. System-owned generated-media placeholder names are still compiled and sanitized as aliases, but their normalized `generated` token is not treated as an identity-bearing forbidden name because it also appears in trusted structural fields such as the `generated-variant` role hint.

`MediaGenerationRequestService` owns CAS status/run transitions, checkpoint retention, operation-node projection, same-request ambiguity/verification resume, and explicit cancellation. `MediaGenerationRequestEventLog` owns non-expiring wait events and tokenized replay/live recovery. Provider adapters register through `MediaProviderDefinition`; missing profiles fail startup, current moderation settings are explicit, normalized problems are sanitized, and automatic paid retry is always forbidden.

`MediaBranchLineagePlanner` enumerates reasoning/media axes and returns marker topology plus one `MediaRunLineageAssignment` per concrete output. Each assignment includes its stable output `assetId`, every selected `referenceAssetId`, and the node-backed `referenceNodeId` subset. Asset-only references contribute provenance but never canvas topology.

For a plain single-model request, reasoning chooses `generate_image` or `generate_video` before lineage planning, so only the chosen modality receives an assignment even though both scalar model selectors are configured. A Google reasoning run that skips tool selection for an explicit video-generation request is retried with `generate_video` as the only allowed function; a second miss fails the run explicitly instead of publishing a zero-assignment lineage plan. Character Creator is image-only: request routing selects the Tool before provider execution, retains the selected reasoning/image axes, and removes every video model and video option before matrix normalization or scalar provider setup. Explicit matrix requests still enumerate every requested model axis allowed by the selected Tool. `ImageRouter` packages every source and capability image into the typed `imageGenerationReferences` contract. Duplicate candidate records for the same source URL collapse before roles and filenames are assigned. The Character Creator visual contract bounds only its variable user-request section, then the router adds a compact image-role preface so the complete Stability request remains below its provider prompt limit without dropping the fixed sheet or fidelity contract. `BaseProvider` resolves and fingerprints that ordered list exactly once before any image-provider workflow runs; OpenAI, Google, Stability, and future provider adapters consume the same `resolvedImageGenerationReferences` state instead of reparsing vendor-specific message blocks. Character Creator therefore preserves the authoritative character source first and the packaged sheet-layout example second across every provider. The Character Creator action logs the packaged example's byte length and SHA-256 when it leaves capability storage, and the shared resolver logs the same fingerprint at provider ingress, so a run can prove that the repository resource—not a prompt-only substitute—reached the media adapter.

Shared preflight creates pending Assets with:

- workspace scope/catalog and conversation/media surface reference;
- owner ACL and Meta projection;
- `creating/processing/building` states;
- `sourceConversationAssetId`;
- `parentAssetId` and `sourceAssetIds` resolved from authorized node-to-Asset maps;
- generation/reasoning/media IDs and prompt fingerprint.

`ImageRouter` reads source images directly from the authoritative candidate-based branch resolution and snapshot. Reasoning-provider tool-call extraction is only a fallback when no branch references were selected, so a failed or skipped reasoning response cannot silently remove an explicitly selected character source. Character Creator forces the closest supported landscape size (`1536x1024` for OpenAI and `3:2` for ratio-based providers) and treats `character-sheet-example.jpg` as the authoritative output-layout template. Its textual contract matches the template's complete turnaround, head, feature, notes, palette, material, detail, alignment-guide, and pose-panel structure; a simplified turnaround strip is invalid. When character source images exist, generation is a two-pass workflow: a capture-only layout-synthesis pass uses the source images plus template, then a bounded fidelity-restoration edit uses the generated sheet as the locked composition target and reattaches every source image for identity, design, and rendering-class preservation. The draft character pixels are disposable: photographic sources cause the second pass to fully re-render every character depiction as photorealistic photography while the non-character layout pixels remain fixed. Only the restoration pass is persisted. The NEX model-synchronization workload stores each model's `imageInputFidelity` policy in the catalog. `ImageRouter` requires the routed model's effective `level` to be `high`; provider adapters forward the optional `requestValue` from that same metadata instead of matching model names. OpenAI reference-conditioned generation uses `images.edit`. Google interleaves an explicit role label before every image part. Stability uses the template through Structure control for layout synthesis, then uses the captured sheet as `init_image` and a composite containing every character source as `style_image` for the restoration pass.

Providers and browser code must never synthesize assignments, marker IDs, or output Asset IDs.
A lineage-plan canvas write persists branch markers only. Planned media slots remain transient until the first media event attaches each preassigned Asset node through its reference-counted Asset/workspace transaction.
A matrix reasoning child never completes the shared generation request. It may settle only its own skipped branch; the matrix orchestrator publishes the single request-level completion after every reasoning child finishes.
A reasoning-only matrix has no concrete media assignments, so it creates no pending output Assets or media-lineage canvas markers.

## Image and video publishers

Image partials are ephemeral Object Store objects and are never Blob renditions. Final publishers:

1. validate provider bytes;
2. store/register the original Blob on the preassigned Asset;
3. start the rendition service;
4. project and attach the final canvas node through the Asset transaction;
5. publish `IMAGE_COMPLETE` or `VIDEO_COMPLETE` with `assetId` and authoritative canvas geometry;
6. materialize terminal provenance, queuing a rebuild on failure.

Canvas attach failure propagates; the publisher does not emit a fabricated durable completion.
A failed concrete media run is settled independently: the API detaches only that run's pending Asset placement and mutates the Workspace canvas in the same Asset-reference transaction, rebalances the remaining siblings, and publishes `CANVAS_GEOMETRY_RESOLVED`. Direct Workspace mutation cannot remove Asset-backed nodes. The browser never saves a locally reconstructed failure topology, so one failed provider cannot delete or overwrite sibling runs from a newer API canvas revision.

## Provenance

`asset-provenance-materializer.ts` projects only the matching reasoning/media run from the settled conversation Asset into a schema-valid, title-free ProseMirror provenance snapshot. It stores the sealed snapshot Blob in `documents.provenance` and updates terminal states under Asset revision. A completed run retries while the rich conversation projection is still settling, then uses a minimal valid terminal projection only after bounded retries are exhausted. Failed/cancelled runs receive the same minimal valid terminal projection when no generated-media atom exists. Deferred reconstruction does not depend on pipeline events that normal cleanup may already have purged.

Request-level failure/cancellation settles every unfinished planned Asset. Assets whose original already settled rely on their per-publisher provenance job/retry.

Pipeline cleanup may discard source events after terminal delivery because deferred provenance reconstruction reads the settled conversation Asset.

Generated media partials never travel inside pipeline, ProseMirror, or live NATS event payloads. Providers write each revision to an immutable run-scoped object in the organization transient-media Object Store and publish only an authenticated API reference. After a replacement is stored, the superseded revision is deleted; terminal media clears the last partial immediately, with provider teardown retrying any failed cleanup. The mechanism is media-type agnostic, and final media remains available only through its settled Asset rendition.

Asset-document resume follows the same payload boundary: core NATS returns snapshot metadata and byte-bounded replay pages, while the browser fetches the Blob-backed ProseMirror snapshot through the authenticated Asset HTTP route. Conversation growth cannot turn a resume reply into a `max_payload` failure.

## Cancellation

Matrix stop aborts and awaits provider groups, patches cancelled state into the persisted conversation Asset through the system snapshot path, materializes cancelled provenance for unfinished outputs, drains projection/document queues, and releases the lease. The authenticated stop handler then removes every persisted marker and generated output carrying the request ID. Asset-backed nodes are detached through Asset transactions, and generation-only conversation surface references are removed so abandoned output Assets can be deleted.

If workflow cancellation fails or no live publisher exists, the stop handler still removes the persisted request projection. It never depends solely on browser state.

## File layout

```text
llm/
├── graph/
│   ├── state.ts
│   ├── stream-publisher.ts
│   ├── pipeline-event-log.ts
│   ├── workspace-context-resolver.ts
│   ├── media-branch-resolver.ts
│   ├── image-publisher.ts
│   └── video-publisher.ts
├── lineage/
│   ├── media-branch-lineage-planner.ts
│   └── media-generation-run-planner.ts
├── orchestration/media-generation-matrix.ts
├── providers/
├── structured-vlm/
├── tools/
├── prompts/
└── usage/

../../../packages/lixpi/capability-system/    # reusable validation, resolver, registry, runner, dispatcher, module contracts
../../../packages/lixpi/capability-system/src/capabilities/ # self-contained built-in modules and cross-runtime definitions
../capability-system/                         # API storage, NATS, LangGraph, and seeding adapters
../installed-capabilities.ts                  # built-in Tool and Skill composition root
../prosemirror/ai-chat-stream-assembler.ts
../prosemirror/asset-prosemirror-step-transport.ts
../services/asset-canvas-projection.ts
../services/generated-asset-storage.ts
../services/asset-provenance-materializer.ts
```

## AWS Bedrock inference

Anthropic and Stability inference can run through AWS Bedrock instead of each vendor's own API. A provider opts in through its own env flag, separately from its api key:

| Flag | Effect |
|------|--------|
| `ANTHROPIC_USE_AWS_BEDROCK_INFERENCE=true` | `AnthropicProvider` and the structured-VLM client invoke Bedrock, and `ANTHROPIC_API_KEY` goes unused |
| `STABILITY_USE_AWS_BEDROCK_INFERENCE=true` | `StabilityProvider` invokes Bedrock, and `STABLE_DIFFUSION_API_KEY` goes unused |

`STABLE_DIFFUSION_USE_AWS_BEDROCK_INFERENCE` is accepted as an alias of the Stability flag, so you can keep the flag next to the api-key name your `.env` already uses.

Bedrock requests go to `AWS_REGION` and are signed with AWS credentials instead of an api key. Locally that is the SSO profile named by `AWS_PROFILE`, resolved against the developer's `~/.aws` SSO cache that docker-compose mounts into the container. On AWS it is the ECS task role, which carries Bedrock invoke and catalog-read permissions.

`providers/bedrock-inference.ts` owns the flags, the region, credential resolution, and the translation from a catalog model id to a Bedrock model id. It discovers that translation from the Bedrock control plane and caches it per process: it normalizes the catalog id to a Bedrock model-name stem, matches it against `ListFoundationModels`, and for models that Bedrock does not serve on demand it picks the cross-region inference profile covering the model. New model releases need no code change because of that, and only a renamed id needs an alias entry.

Bedrock serves Stability as text-to-image and image-to-image only, so it has no equivalent of the `control/*` endpoints the direct API path uses. Reference-driven requests fall back to image-to-image with a strength chosen per routing mode, the secondary style reference is dropped, and the provider logs a warning naming the fallback. Anthropic behaves the same on both paths.

The `ai-models-synchronization` NEX workload reads `ANTHROPIC_USE_AWS_BEDROCK_INFERENCE` too. With the flag on it lists Anthropic models from the Bedrock foundation-model catalog and projects Bedrock ids onto exact dated vendor snapshot ids, so persisted selections remain exact catalog keys when there is no Anthropic api key.

## Provider invariants

- Provider state updates are partial overlays; undefined fields do not erase state.
- Capability references resolve once in shared preflight to an immutable, hash-verified plan. Matrix children receive that exact plan and never re-resolve it.
- Reasoning providers expose `search_capabilities`, `use_capability`, and attached `model-choice` Tools through bounded provider-native continuation loops. Transient image/video providers never expose Capability invocation functions.
- Preflight-required Tools execute before reasoning. Model-required Tools execute inside the selected reasoning adapter with provider-native forced Tool choice, then return their structured result to the same agent loop so the ordinary assistant response continues. Every Tool action resolves through the server allowlist and emits replayable generic run events with sealed manifest provenance.
- Media-generation context Tools return provider-neutral instructions and model-safe references. Shared preflight forwards that context to every selected reasoning/media child without changing the selected model matrix. `MediaBranchLineagePlanner` allocates the normal output Assets and topology before provider fanout; Tool runtimes do not generate or attach those outputs themselves.
- A model-required non-generation Tool may return terminal output Assets and suppress ordinary media routing when its product contract makes those Assets the request result. Action Timeline uses this path for one non-media Artifact per selected reasoning model; explicit `/` selection keeps the generic module badge and resolves duration/precision from authoritative prompt wording before Tool-input validation. Character Creator remains a preflight generation-context Tool.
- Capability-only routing is identical for scalar and matrix submissions: ignored image/video axes are removed before model lookup, the selected reasoning model is forced to call Action Timeline, the Tool stages the terminal Artifact output, and media-branch resolution plus media-lineage planning stay disabled. The same provider loop then streams a brief plain-language confirmation through the API-owned ProseMirror conversation writer under an explicit no-code/no-visualization completion contract. `BaseProvider` publishes the terminal stream event and finalizes the conversation before the registered output finalizer reconstructs the authoritative canvas run from staged-Asset lineage, then attaches, activates, and publishes the Artifact node; pipeline-event purge remains deferred until normal cleanup. Failed or cancelled continuations discard their staged Assets. Stable request/reasoning-run IDs bind that response and the Capability generation trace to the Artifact's standard lineage history without creating image or video work.
- Capability output classification keeps all output Asset IDs for projection and a separate media-only list for media lineage. Non-media Artifacts never enter image/video run planning.
- Transient media providers do not emit their own top-level start/end lifecycle.
- Reference traces never contain inline image bytes.
- Provider routers receive exact preplanned run metadata.
- Every reasoning adapter measures the complete translated provider-native request against the selected model's context window before invocation, reserves its completion budget, and rejects overflow without clipping text or media inputs.
- Usage uses synchronized model pricing and decimal arithmetic.
- The pre-call spend gate names one model and one modality, and they always describe the same thing. `usage/usage-estimator.ts` derives the modality from what the run's own model is, so a reasoning run gates as `tokens` even with image or video generation enabled; the media calls it triggers are separate paid calls through transient media providers, each admitted against its own media model. Escalating the modality instead would name a text model under an image tariff, which does not exist and is denied.
- That gate sends an upper-bound unit count in the unit its modality is metered in: estimated prompt tokens plus the reserved completion ceiling for `tokens`, one image for `image`, and for `video` either clip seconds or vendor video tokens depending on the model's own `pricing.video.measuringUnit`. The check carries no measuring unit of its own, so the backend reads the count in whatever unit that model's tariff meters, and sending seconds against a token tariff would understate it by orders of magnitude. The backend multiplies the count by the model's rate, so it may over-count but must never under-count.
- Text token counts reuse the same heuristic as the context-window guard in `providers/provider-input-budget.ts`. The prompt term covers the assembled messages and the system prompt, then carries a fixed margin for tool schemas, workspace context, and Capability content, which the resolver nodes add after the gate has already run.
- `usage/video-token-accounting.ts` converts clip seconds to vendor video tokens. The formula and the fixed 24fps frame rate are the vendor's; the per-tier frame dimensions it multiplies are **placeholders**, deliberately biased high, carrying a `TODO` that records what is sourced and what is not. A check that used them logs at warn level so a placeholder-derived charge estimate is never mistaken for a real one.
- Video confirms report `inputVideoSeconds`, the measured length of the source clip on an extension run, because vendors price a run with video input differently from one without. The length is read off the source Asset when the request resolves and carried on graph state; downstream the source is only a URI and carries no duration. Absent means text-to-video. The same measured length feeds the spend gate's input-duration term, which falls back to the model's longest clip when the Asset has no measured duration.
- `usage/usage-log.ts` owns the shape of both metering log lines, `[Metrics] usage check` and `[Metrics] usage confirm`, so a run's estimate and its measured cost read as a pair. The check line shows how the estimate decomposed and flags any safety factor or placeholder that went into it.
- Every request has an AbortController and the global timeout.
- Attached Asset display titles/original filenames never enter provider-safe reasoning or media payloads; final adapters fail closed on a forbidden variant.
- Every current provider has one validated policy definition with explicit moderation, verification, retention, sensitive-data, documentation, review, and problem-normalization fields.
- Provider failures are terminal per run. Recovery requires Edit request plus a new explicit Submit; no adapter automatically retries a cosmetically rewritten prompt.

## Related docs

- [`documentation/platform/AI-GENERATION-PIPELINE.md`](../../../documentation/platform/AI-GENERATION-PIPELINE.md)
- [`documentation/media-generation/BRANCH-LINEAGE.md`](../../../documentation/media-generation/BRANCH-LINEAGE.md)
- [`documentation/platform/DATA-STORAGE.md`](../../../documentation/platform/DATA-STORAGE.md)
