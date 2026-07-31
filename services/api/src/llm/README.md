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

Context snapshots contain candidate, node, and Asset IDs plus descriptors. The API also extracts typed prompt-reference atoms from the authoritative latest user message, reauthorizes them, and materializes Asset-only media references without inventing canvas nodes. Media-enabled turns merge them into the candidate resolver; text-only reasoning turns attach the authorized image or representative frame directly to the latest user message. Video candidates use representative-frame/poster renditions; explicit extension resolves the authorized source video Asset to canonical/original MP4 internally.

Capability resolution maps selected top-level modules to their module-internal entry packages, accepts only structurally standalone Tool/Skill references on those categories, captures current manifest hashes, authorizes the transitive closure, enforces dependency and aggregate resource limits, and seals the plan. `required` Tools run before provider streaming. `model-required` Tools run exactly once inside each selected reasoning provider's agent loop before its final response, while `model-choice` Tools remain optional. Capability-only Artifact output is staged during that Tool round and attached to the Workspace only after the provider continuation has ended and its pending conversation writes have drained. The reasoning model also receives `search_capabilities` and `use_capability`; model-selected visual Tool output is folded back into the same provider state before lineage planning and generation. Transient media providers cannot recurse into those functions.

## Streams

Live interaction events:

```text
ai.interaction.chat.receiveMessage.<organizationId>.<conversationAssetId>               # internal canonical
ai.interaction.chat.receiveMessage.<userIdToken>.<organizationId>.<conversationAssetId> # authorized browser relay
```

Pipeline replay logs are keyed by workspace and conversation pipeline ID. `StreamPublisher` writes replay before live publication and preserves per-`mediaRunId` event ordering without serializing sibling runs.
The authorized browser relay refreshes requester and conversation authorization on a short interval, then forwards events directly between refreshes so partial-image fanout cannot queue behind one database authorization read per event.
Transient image/video providers forward media events to their owning reasoning provider; only that owner live-publishes the mirrored event, preventing duplicate partial and completion delivery.

Conversation document steps use:

```text
asset.document.steps.<organizationId>.<conversationAssetId>.conversation               # internal durable
asset.document.events.<userIdToken>.<organizationId>.<conversationAssetId>.conversation # authorized browser relay
```

`AiChatProseMirrorStreamAssembler` is the single writer for AI transcript steps. It parses streamed Markdown, updates reasoning/trace/generated-output nodes, and publishes expected-sequence step/control events through `AssetProseMirrorStepTransport`. Media generation trace blocks are keyed by the full media run inside a reasoning section, so image/video model fanout preserves one final prompt and trace per output instead of overwriting sibling variants. Capability generation traces use the same collapsible node and retain Tool identity, run ID, output Assets, and workflow-step summaries beside the provider's continued assistant response.
Before provider invocation, the API rebuilds messages and the current prompt from that authoritative conversation document; browser-serialized transcript history and prompt fingerprints are not trusted.

Generated-output replay is an explicit exception to reasoning prompt creation, not to authorization. The API validates that the requested preserved lineage marker exists in the editable Workspace and belongs to the supplied branch. A replay matrix carries output-scoped final media prompts keyed by reasoning model, media model, and modality. The provider graph skips `streamImpl`, injects each prompt only into its matching media fanout, retains the original model parameters, and creates replacement output Assets under the preserved marker. Its lineage plan includes the preserved regeneration target so clients never treat that committed marker as temporary UI geometry; all clients consume the same API-persisted marker and generated-media coordinates. Normal prompt regeneration does not use this replay contract and therefore creates a new API-planned lineage.

## Media preflight and Asset creation

`MediaBranchLineagePlanner` enumerates reasoning/media axes and returns marker topology plus one `MediaRunLineageAssignment` per concrete output. Each assignment includes its stable output `assetId`, every selected `referenceAssetId`, and the node-backed `referenceNodeId` subset. Asset-only references contribute provenance but never canvas topology.

For a plain single-model request, reasoning chooses `generate_image` or `generate_video` before lineage planning, so only the chosen modality receives an assignment even though both scalar model selectors are configured. Character Creator is image-only: request routing selects the Tool before provider execution, retains the selected reasoning/image axes, and removes every video model and video option before matrix normalization or scalar provider setup. Explicit matrix requests still enumerate every requested model axis allowed by the selected Tool. `ImageRouter` packages every source and capability image into the typed `imageGenerationReferences` contract. `BaseProvider` resolves and fingerprints that ordered list exactly once before any image-provider workflow runs; OpenAI, Google, Stability, and future provider adapters consume the same `resolvedImageGenerationReferences` state instead of reparsing vendor-specific message blocks. Character Creator therefore preserves the authoritative character source first and the packaged sheet-layout example second across every provider. The Character Creator action logs the packaged example's byte length and SHA-256 when it leaves capability storage, and the shared resolver logs the same fingerprint at provider ingress, so a run can prove that the repository resource—not a prompt-only substitute—reached the media adapter.

Shared preflight creates pending Assets with:

- workspace scope/catalog and conversation/media surface reference;
- owner ACL and Meta projection;
- `creating/processing/building` states;
- `sourceConversationAssetId`;
- `parentAssetId` and `sourceAssetIds` resolved from authorized node-to-Asset maps;
- generation/reasoning/media IDs and prompt fingerprint.

`ImageRouter` reads source images directly from the authoritative candidate-based branch resolution and snapshot. Reasoning-provider tool-call extraction is only a fallback when no branch references were selected, so a failed or skipped reasoning response cannot silently remove an explicitly selected character source. Character Creator forces the closest supported landscape size (`1536x1024` for OpenAI and `3:2` for ratio-based providers) and treats `character-sheet-example.jpg` as the authoritative output-layout template. Its textual contract matches the template's complete turnaround, head, feature, notes, palette, material, detail, alignment-guide, and pose-panel structure; a simplified turnaround strip is invalid. When character source images exist, generation is a two-pass workflow: a capture-only layout-synthesis pass uses the source images plus template, then a bounded fidelity-restoration edit uses the generated sheet as the locked composition target and reattaches every source image for identity, design, medium, line, edge, mark, palette, substrate, and texture preservation. Only the restoration pass is persisted. OpenAI reference-conditioned generation uses `images.edit`; GPT Image 2 supplies automatic high input fidelity, while GPT Image 1 and 1.5 explicitly request `input_fidelity=high`. Google interleaves an explicit role label before every image part. Stability uses the template through Structure control for layout synthesis, then uses the captured sheet as `init_image` and a composite containing every character source as `style_image` for the restoration pass.

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

## Provenance

`asset-provenance-materializer.ts` projects only the matching reasoning/media run from the settled conversation Asset into a schema-valid, title-free ProseMirror provenance snapshot. It stores the sealed snapshot Blob in `documents.provenance` and updates terminal states under Asset revision. A completed run retries while the rich conversation projection is still settling, then uses a minimal valid terminal projection only after bounded retries are exhausted. Failed/cancelled runs receive the same minimal valid terminal projection when no generated-media atom exists. Deferred reconstruction does not depend on pipeline events that normal cleanup may already have purged.

Request-level failure/cancellation settles every unfinished planned Asset. Assets whose original already settled rely on their per-publisher provenance job/retry.

Pipeline cleanup may discard source events after terminal delivery because deferred provenance reconstruction reads the settled conversation Asset.

Generated media partials never travel inside pipeline, ProseMirror, or live NATS event payloads. Providers write each revision to an immutable run-scoped object in the organization transient-media Object Store and publish only an authenticated API reference. After a replacement is stored, the superseded revision is deleted; terminal media clears the last partial immediately, with provider teardown retrying any failed cleanup. The mechanism is media-type agnostic, and final media remains available only through its settled Asset rendition.

Asset-document resume follows the same payload boundary: core NATS returns snapshot metadata and byte-bounded replay pages, while the browser fetches the Blob-backed ProseMirror snapshot through the authenticated Asset HTTP route. Conversation growth cannot turn a resume reply into a `max_payload` failure.

## Cancellation

Matrix stop aborts and awaits provider groups, patches cancelled state into the persisted conversation Asset through the system snapshot path, settles canvas removals using the retained lineage plan, materializes cancelled provenance for unfinished outputs, drains projection/document queues, and releases the lease.

If no live publisher exists, the API still performs persisted conversation cancellation and canvas settlement. It never depends solely on browser state.

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
- `usage/usage-log.ts` owns the shape of both metering log lines, `[Metrics] usage check` and `[Metrics] usage confirm`, so a run's estimate and its measured cost read as a pair. The check line shows how the estimate decomposed and flags any safety factor or placeholder that went into it.
- Every request has an AbortController and the global timeout.

## Related docs

- [`documentation/platform/AI-GENERATION-PIPELINE.md`](../../../documentation/platform/AI-GENERATION-PIPELINE.md)
- [`documentation/media-generation/BRANCH-LINEAGE.md`](../../../documentation/media-generation/BRANCH-LINEAGE.md)
- [`documentation/platform/DATA-STORAGE.md`](../../../documentation/platform/DATA-STORAGE.md)
