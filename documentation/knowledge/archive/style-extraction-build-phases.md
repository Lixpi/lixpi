---
title: Style Extraction Build Phases (Archived)
description: Historical implementation record of the Style Extraction build, including the file-structure map and the eleven-phase work sequence. Preserved for provenance, not as live reference.
---

# Style Extraction Build Phases (Archived)

{% callout type="important" %}
**Historical implementation record — preserved for provenance.** This page
documents the file map and the phase-by-phase work sequence that drove the
style-extraction build. It is *not* live reference documentation and should not
be used as instructions for new contributors. For current behaviour see the live
library docs:
[Style Extraction Tool](../../library/STYLE-EXTRACTION-TOOL.md),
[Style Extraction Pipeline](../../library/STYLE-EXTRACTION-PIPELINE.md), and
[Capability Storage and Operations](../../library/CAPABILITY-STORAGE.md).
{% /callout %}

## File structure

The implementation maps onto the following paths. This map was the navigation
index during the build; new contributors should start from the live docs above
rather than from the phase sequence below.

**Shared types and constants:**

- [`packages/lixpi/constants/ts/types.ts`](../../../packages/lixpi/constants/ts/types.ts) — `Feature`, `FeatureMeta`, `FeatureAccessList`, `FeatureScope`, `StyleSampleRef` (with `kind` and `cropRegion`), `FeatureSourceImageCrop`, `SceneAssessment`, `AxisExtraction`, `StyleDraft`, `StageTraceEvent`, `ExtractionRun` (with `trace`), `CanvasStyleExtractionState` (with `traceEvents`), `referencedFeatureIds` on `AiInteractionChatSendMessagePayload`.
- [`packages/lixpi/constants/nats-subjects.json`](../../../packages/lixpi/constants/nats-subjects.json) — `WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.*`, `FEATURE_LIBRARY_SUBJECTS.LIST_GLOBAL`, `AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.*`.
- [`packages/lixpi/constants/ts/aws-resources.ts`](../../../packages/lixpi/constants/ts/aws-resources.ts) — DDB table identifiers `FEATURES`, `FEATURES_META`, `FEATURES_ACCESS_LIST`, `EXTRACTION_RUNS`.

**Infrastructure:**

- [`infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts`](../../../infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts) — table definitions including the `byScopeAndOwner` GSI on `FEATURES`.

**API services — data layer:**

- [`services/api/src/models/feature.ts`](../../../services/api/src/models/feature.ts) — `createFeature`, `getFeature`, `listByScope`, `updateFeature`, `deleteFeature`, `changeScope`, `incrementReportCount`, `canRead`.
- [`services/api/src/models/extraction-run.ts`](../../../services/api/src/models/extraction-run.ts) — `createRun`, `getRun`, `updateStatus`, `appendTrace`, `markComplete`, `markFailed`.

**API services — NATS handlers:**

- [`services/api/src/NATS/subscriptions/feature-subjects.ts`](../../../services/api/src/NATS/subscriptions/feature-subjects.ts) — feature CRUD over NATS.
- [`services/api/src/NATS/subscriptions/extraction-subjects.ts`](../../../services/api/src/NATS/subscriptions/extraction-subjects.ts) — extracts the user's intent string from the last user message, resolves analysis and image models, dispatches to `processExtraction`.

**API services — REST routes:**

- [`services/api/src/routes/feature-routes.ts`](../../../services/api/src/routes/feature-routes.ts) — `GET /api/features/:featureId/samples/:sampleIndex`, ACL-checked image proxy.

**Style Extraction Capability package (the six-stage pipeline):**

- [`services/api/src/capability-modules/style-extraction/tools/index.ts`](../../../services/api/src/capability-modules/style-extraction/tools/index.ts) — standalone Tool-module entry point and six-stage runner wiring.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/types.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/types.ts) — extraction input, state, logger, extractor, and dependency contracts.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/trace.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/trace.ts) — stage trace construction and event delivery.
- [`services/api/src/llm/structured-vlm/structured-vlm-client.ts`](../../../services/api/src/llm/structured-vlm/structured-vlm-client.ts) — shared, capability-aware structured-output caller.
- [`services/api/src/llm/providers/provider-capabilities.ts`](../../../services/api/src/llm/providers/provider-capabilities.ts) — provider/model capability detection used by structured VLM calls.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage1-router.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage1-router.ts) — scene assessment, axis dominance scoring, and intent resolution.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage2-extractors.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage2-extractors.ts) — parallel extractor fan-out with isolated failures.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage3-crops.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage3-crops.ts) — deterministic crop materialization and validation.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage4-synthesis.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage4-synthesis.ts) — dominance-weighted synthesis.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage5-samples.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage5-samples.ts) — palette, texture, and applied-medium sample generation.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/stage6-persist.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/stage6-persist.ts) — persistence as a generated `visual-style` Capability.

**Extractor registry (modular, one file per axis):**

- [`services/api/src/capability-modules/style-extraction/tools/pipeline/extractors/registry.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/extractors/registry.ts) — `registerExtractor`, `getExtractors`, `getExtractor`, `getRegisteredAxes`.
- [`services/api/src/capability-modules/style-extraction/tools/pipeline/extractors/_helpers.ts`](../../../services/api/src/capability-modules/style-extraction/tools/pipeline/extractors/_helpers.ts) — shared `runAxisVlm` wrapper and schema envelope.
- One file per axis: `palette-extractor.ts`, `medium-signature-extractor.ts`, `character-design-extractor.ts`, `lighting-extractor.ts`, `composition-extractor.ts`, `mood-extractor.ts`, `background-treatment-extractor.ts`, `edge-treatment-extractor.ts`, `line-quality-extractor.ts`, `surface-texture-extractor.ts`. New axes are added by dropping a file here and importing it from `orchestrator.ts`.

**Chat graph integration (for `/use` chip resolution):**

- [`services/api/src/llm/graph/feature-resolver.ts`](../../../services/api/src/llm/graph/feature-resolver.ts) — the `resolveFeatures` pre-stage; LRU cache; partitions samples by `kind` and forwards them as `input_image` blocks on multimodal requests.
- [`services/api/src/llm/providers/base-provider.ts`](../../../services/api/src/llm/providers/base-provider.ts) — `resolveFeatures` wired as the first graph node before `validateRequest`.

**LLM module integration:**

- [`services/api/src/llm/index.ts`](../../../services/api/src/llm/index.ts) — `processExtraction` on `LlmModule`; instantiates `ExtractionOrchestrator` with `runImageRouter` and `storeWorkspaceImage` deps.

**Web UI:**

- [`services/web-ui/src/infographics/workspace/extractionTab.ts`](../../../services/web-ui/src/infographics/workspace/extractionTab.ts) — stage-aware timeline rendering one row per streamed `StageTraceEvent`; reasoning panel auto-opens on first chunk; feature card rendering; persisted state restoration.
- [`services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts`](../../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts) — right-side Media Library panel; adapts existing Features and manages explicitly saved Images.
- [`services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts`](../../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) — bubble-menu Ask-AI handler wired to extraction; panel-tabs controller; library-panel toggle wiring.
- [`services/web-ui/src/components/WorkspaceCanvas.svelte`](../../../services/web-ui/src/components/WorkspaceCanvas.svelte) — adds the independent bottom-right Media Library launcher above the existing standalone zoom indicator.
- [`services/web-ui/src/infographics/workspace/media-library-panel.scss`](../../../services/web-ui/src/infographics/workspace/media-library-panel.scss) — Media Library browser/inspector drawer and stage timeline styles.
- [`services/web-ui/src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts`](../../../services/web-ui/src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts) — `/use` and `/extract` slash commands.

## Historical phase sequence

The work was sequenced into 11 phases, each independently shippable and testable.
Foundation primitives (types, DB, NATS subjects) landed first; the LangGraph
extension second; the UI surfaces last.

### Phase 1 — Types, constants, NATS subjects (foundation)

Single source of truth, used by web-ui + api.

**Files:**

- Extend [`packages/lixpi/constants/ts/types.ts`](../../../packages/lixpi/constants/ts/types.ts) with: `FeatureScope`, `Feature` (with nested per-axis `parameters` structure incl. `axisDominance` and `sceneAssessment`), `FeatureMeta`, `FeatureAccessList`, `StyleSampleRef` (incl. `kind: 'source-crop' | 'texture-specimen' | 'applied-medium-probe'` and optional `cropRegion: { imageRef, x, y, width, height, label, purpose }`), `SceneAssessment`, `AxisExtraction`, `StyleDraft`, `StageTraceEvent` (the per-stage trace event shape), `FeatureReferenceMessageBlock`, `ExtractionRun` (with `trace: StageTraceEvent[]`), `ExtractionRunStatus`, `PanelTab` (and the extension to `CanvasState`), and `referencedFeatureIds?: string[]` on `AiInteractionChatSendMessagePayload`.
- Extend [`packages/lixpi/constants/nats-subjects.json`](../../../packages/lixpi/constants/nats-subjects.json) with `WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.*`, top-level `FEATURE_LIBRARY_SUBJECTS.LIST_GLOBAL`, and `AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.*`.

**Tests:** type compilation; subject string format snapshot.

### Phase 2 — DynamoDB tables + Pulumi infra

**Files:**

- [`infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts`](../../../infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts) — add `FEATURES`, `FEATURES_META`, `FEATURES_ACCESS_LIST`, `EXTRACTION_RUNS` definitions to `getTableDefinitions()` (~lines 32–191).
- [`infrastructure/pulumi/src/pulumiProgram.ts`](../../../infrastructure/pulumi/src/pulumiProgram.ts) — wire the four new tables into `createMainApiService(...).resourceBindings.tables`.

**Side-quest** (called out during exploration): the existing
`resourceBindings.tables` may be missing `WORKSPACES` and `AI_CHAT_THREADS`.
Verify against the model files in `services/api/src/models/` and add them if
confirmed missing. If this is a real production gap, treat it as a separate
ticket; do not block this phase on it.

**Tests:** Pulumi preview against a dev stack to confirm table creation + IAM
grants.

### Phase 3 — API layer (NATS handlers + sample image proxy)

**Files:**

- New `services/api/src/models/feature.ts`: `createFeature`, `getFeature(featureId, requesterContext)`, `listByScope(scope, scopeOwnerId, requesterContext, paging)`, `updateFeature`, `deleteFeature`, `changeScope`, `incrementReportCount`, `canRead(userId, feature)` (ACL helper).
- New `services/api/src/models/extraction-run.ts`: `createRun`, `getRun`, `appendTranscriptDelta`, `markComplete(runId, featureId)`, `markFailed(runId, error)`.
- New `services/api/src/NATS/subscriptions/feature-subjects.ts` — subscribes to `WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.*`, mirrors structure of [`document-subjects.ts`](../../../services/api/src/NATS/subscriptions/document-subjects.ts).
- New `services/api/src/NATS/subscriptions/extraction-subjects.ts` — handles `AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.START`/`STOP`/`STATUS`. Calls into LangGraph (Phase 4).
- New REST route `GET /api/features/:featureId/samples/:sampleIndex` in `services/api/src/routes/` — ACL-checks via `Feature.canRead`, then streams the image bytes from the NATS Object Store using the existing helpers in [`image-storage.ts`](../../../services/api/src/services/image-storage.ts).

**Tests:** model-layer unit tests for ACL paths (workspace / user / org /
public); integration test of the sample-proxy route; one end-to-end NATS-handler
test.

### Phase 4 — Extraction pipeline (6 stages + extractor registry + tracing)

Phase 4 is the heart of the rewrite. It is split into four independently-shippable
sub-phases (4a–4d) so the work can land incrementally, each sub-phase testable
end-to-end behind a feature flag.

#### Phase 4a — Extraction graph skeleton + tracing infrastructure

**Files:**

- New `services/api/src/llm/extraction/types.ts` — `SceneAssessment`, `AxisExtraction`, `StyleDraft`, `StageTraceEvent`, `ExtractionState` types.
- New `services/api/src/llm/extraction/trace.ts` — `StageLogger` helper (emits to stdout, to stream-publisher, to `ExtractionRun.trace[]`).
- New `services/api/src/llm/extraction/graph.ts` — the extraction LangGraph: 6 nodes (`runRouter`, `runExtractors`, `materializeSourceCrops`, `synthesizeStyle`, `generateSamples`, `persistStyle`). Wiring only — each node delegates to its own file.
- Stage stubs (no-op implementations that emit a trace event and return): `services/api/src/llm/extraction/stage1-router.ts`, `stage2-extractors.ts`, `stage3-crops.ts`, `stage4-synthesis.ts`, `stage5-samples.ts`, `stage6-persist.ts`.
- Modify `services/api/src/NATS/subscriptions/extraction-subjects.ts` to invoke the new extraction graph instead of the chat graph for extraction runs.
- Modify `services/api/src/models/extraction-run.ts` — add `trace: StageTraceEvent[]` field and `appendTrace(event)` method.

**Tests:** graph snapshot; trace event format snapshot; end-to-end stub run that
emits 6 trace events and writes them to DDB.

#### Phase 4b — Stage 1 router + extractor registry + 4 baseline extractors

**Files:**

- New `services/api/src/llm/extraction/extractors/registry.ts` — exports `getExtractors(): StyleExtractor[]`.
- New extractor modules (one file each in `services/api/src/llm/extraction/extractors/`):
  - `palette-extractor.ts`
  - `medium-signature-extractor.ts` (critical — this is the digital-vs-traditional discriminator)
  - `character-design-extractor.ts` (critical — captures the "rendering of the subject" signature)
  - `lighting-extractor.ts`
- Implement `stage1-router.ts` with a media-neutral structured-output schema generated from the registry.
- Implement `stage2-extractors.ts` with `Promise.all()` fan-out + isolated failure handling.
- Modify [`services/api/src/llm/prompts/load-prompts.ts`](../../../services/api/src/llm/prompts/load-prompts.ts) — delete the v0 `STYLE_EXTRACTION_INSTRUCTIONS` (the long monolithic prompt that biased toward watercolor terminology). Replace with stage-specific prompts (`ROUTER_SYSTEM_PROMPT`, `SYNTHESIS_SYSTEM_PROMPT`) plus the per-extractor system prompts inlined in each extractor module.

**Tests:** unit tests for each extractor (mock VLM, snapshot output structure);
integration test that runs router → 4 extractors against a recorded VLM response.

#### Phase 4c — Stages 3–6 + remaining 6 extractors

**Files:**

- Implement `stage3-crops.ts` — source crop materialization via sharp from router bboxes; store-then-readback.
- Implement `stage4-synthesis.ts` — dominance-weighted synthesis prompt; produces `StyleDraft`.
- Implement `stage5-samples.ts` — three sample builders: deterministic palette board, deterministic 2×2 texture composite (only when surface-texture dominant — replaces v0 procedural SVG), model-rendered applied-medium probe via `runImageRouter` with source crops attached. **Delete** the v0 `renderTextureReferenceSheet` SVG helpers in `services/api/src/llm/providers/base-provider.ts`.
- Implement `stage6-persist.ts` — `Feature.create`, `ExtractionRun.markComplete`, `FEATURE_SUBJECTS.CREATE`, stream feature_card.
- Add remaining extractors: `composition-extractor.ts`, `mood-extractor.ts`, `background-treatment-extractor.ts`, `edge-treatment-extractor.ts`, `line-quality-extractor.ts`, `surface-texture-extractor.ts`.

**Tests:** stage-3 crop materialization unit tests (sharp); stage-4 synthesis
against recorded VLM (snapshot the structured output); stage-5 deterministic
builders (palette board pixel snapshot, 2×2 texture composite layout); stage-6
full DDB round-trip.

#### Phase 4d — `resolveFeatures` + chat-graph cleanup

**Files:**

- New `services/api/src/llm/graph/feature-resolver.ts` — the `resolveFeatures` pre-stage logic (DDB fetch + Object Store fetch + system-message construction + LRU cache). Partitions samples by `kind`; forwards source-crop samples (primary) plus texture-specimen and applied-medium-probe samples (auxiliary) as `input_image` blocks. Injects the strict anti-leakage instruction once at the top.
- Modify `services/api/src/llm/providers/base-provider.ts` — register `resolveFeatures` between `START` and `validateRequest`. **Remove** the `validateFeatureSpec` and `executeStyleExtraction` nodes (subsumed by Phase 4a–4c's dedicated extraction graph). **Remove** the conditional edge from `streamTokens` to `validateFeatureSpec`.
- **Delete** `services/api/src/llm/tools/extract-feature.ts` (the chat-level tool is gone — extraction is its own pipeline).
- Modify [`openai-provider.ts`](../../../services/api/src/llm/providers/openai-provider.ts), [`anthropic-provider.ts`](../../../services/api/src/llm/providers/anthropic-provider.ts), [`google-provider.ts`](../../../services/api/src/llm/providers/google-provider.ts) — remove the `extract_feature` tool registration. Keep `generate_image`.
- Modify [`services/api/src/llm/graph/state.ts`](../../../services/api/src/llm/graph/state.ts) — **remove** `styleExtractionSpec` field and reducer; **remove** `isExtractionRun` field (extraction runs use a different graph entirely now).

**Tests:** chat graph snapshot (confirms `extract_feature` is gone,
`resolveFeatures` is the first node); `/use` flow end-to-end test that confirms a
feature's source crops + samples reach the image-router call as `input_image`
blocks.

### Phase 5 — Tab system in the AI chat panel

**Files:**

- Refactor [`services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts`](../../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) `renderActiveAiChatPanel` (~lines 1328–1533) into a `PanelTabsController`:
  - Tab strip rendered as a horizontal flex row at the top of `.workspace-ai-chat-floating-panel`.
  - Body factory dispatches by `PanelTab.type`: `renderThreadTabBody(threadId)` (factor out today's panel body) or `renderExtractionTabBody(extractionRunId)` (Phase 7).
  - Persistence via existing `onCanvasStateChange?.()` hook in `canvasState.aiChatPanel`.
  - Reactive bridge: subscribe to `WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE` for cross-device tab sync.
  - Window-level keyboard listener: `Cmd/Ctrl+W`, `Cmd/Ctrl+1..9`, `Cmd/Ctrl+Shift+[`/`]` — only active when panel is focused.
  - Panel state writes use `canvasState.aiChatPanel`; current chat context uses explicit `contextChips`.

**Tests:** jsdom test of tab-state reducers; manual visual QA pass.

### Phase 6 — Rewire image Ask-AI bubble button

**Files:**

- Modify [`WorkspaceCanvas.ts`](../../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) — replace the `onAskAi` callback in `initCanvasBubbleMenu` (~lines 359–425) with the new flow: `ExtractionRun` create → open new `extraction` tab → `FEATURE_EXTRACT.START` with image + edge-graph context.

The bubble menu definition file
[`canvasBubbleMenuItems.ts`](../../../services/web-ui/src/infographics/workspace/canvasBubbleMenuItems.ts)
does not change — only the callback body. Keep the `magicIcon` and the "Ask AI"
label; tooltip becomes "Ask AI · Extract feature."

**Tests:** integration test that clicking the wand emits the right NATS request
and opens an extraction tab.

### Phase 7 — Extraction tab UX (stage-aware timeline)

**Files:**

- New `services/web-ui/src/infographics/workspace/extractionTab.ts` (vanilla TS, attached to panel body element):
  - **Stage-aware timeline** rendered as a chronological list of `StageTraceEvent` rows. Each row shows: stage name (`Stage 1 — Scene Assessment & Router`, `Stage 2 — palette extractor`, etc.), model name (e.g. `claude-opus-4-7`), duration, status (spinner / check / failed), and an expandable detail panel with the prompt preview, input summary, and output summary. Replaces the static 4-step strip of v0 entirely.
  - Streams in `StageTraceEvent` rows as they arrive on the subscription subject.
  - Final feature card block (name, category, scope, summary, tags, samples, `axisDominance` breakdown bar chart, action buttons including "Show full pipeline trace").
  - Restores state from `EXTRACTION_RUNS.trace[]` on reload (the full trace is persisted).

**Tests:** jsdom rendering + simulated streaming `StageTraceEvent` sequence;
visual QA pass.

### Phase 8 — ProseMirror feature reference inline node + hover info bubble

**Files:**

- New plugin: `services/web-ui/src/components/proseMirror/plugins/featureReferencePlugin/`:
  - `featureReferenceNode.ts` — inline atom node spec.
  - `featureReferenceNodeView.ts` — NodeView with hover info bubble using existing [`components/infoBubble/`](../../../services/web-ui/src/components/infoBubble/). Lazy-loads feature data + samples; caches per featureId per editor session.
  - `featureReferencePlugin.ts` — registers the node into prompt-input + thread schemas.
  - `featureReference.scss` — chip styling per "obviously highlighted" requirement.
  - `index.ts` — exports.
  - `README.md` — pattern documentation matching the rest of the plugins folder.
- Modify [`services/web-ui/src/services/ai-chat-thread-service.ts`](../../../services/web-ui/src/services/ai-chat-thread-service.ts) and the `AiPromptInputController` send path — walk the ProseMirror JSON, collect feature_reference IDs, populate `referencedFeatureIds` on outgoing `AiInteractionChatSendMessagePayload`.

**Tests:** ProseMirror plugin unit tests (insertion, deletion, hover trigger,
payload extraction).

### Phase 9 — Slash commands (`/use` and `/extract`)

**Files:**

- Modify [`services/web-ui/src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts`](../../../services/web-ui/src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts) — add `SLASH_COMMANDS` entries:
  - **`/use`** (aliases: `feature`, `f`): on execute, opens a feature picker submenu (flat list, filterable, recent at top, source via `FEATURE_SUBJECTS.LIST_BY_SCOPE` aggregated). On select, inserts a `feature_reference` ProseMirror node at the slash trigger position.
  - **`/extract`** (aliases: `extract-feature`, `ext`): on execute, opens a new `extraction` tab in the panel; captures any text typed after `/extract` as the extraction seed; inherits the current thread's edge-graph context via existing `findConnectedNodes` + `extractConnectedContext`.

The existing slash menu plugin already supports filtering, arrow keys, Esc,
click-out — no changes needed there.

**Tests:** slash menu trigger + command execution + feature insertion.

### Phase 10 — Feature Library panel (historical design; replaced by Media Library)

**Files:**

- Superseded by `services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts` (vanilla TS, attached to `paneEl`, mirrors existing chat panel styling pattern):
  - Independent Media Library toggle icon above the bottom-right zoom indicator in [`services/web-ui/src/components/WorkspaceCanvas.svelte`](../../../services/web-ui/src/components/WorkspaceCanvas.svelte). ARIA label: "Media Library."
  - Full-height right-side two-thirds drawer that shifts left of the AI chat panel and covers its launcher while open.
  - Header and compact control bar: title, segmented `Features` / `Images` mode, `Scope` select, search input, close X.
  - Body: Features grouped by category as concise cards with large thumbnail, name, two-line summary preview, scope chip, and `Use`; the selected Feature renders all stored details and management controls in a separate inspector.
  - At narrow available widths, selecting a Feature switches to a focused detail view with a Back action.
  - Footer-right floating button: `+ Extract new`.
  - Live updates via `FEATURE_SUBJECTS.CREATE`/`UPDATE`/`DELETE` NATS broadcasts.
- SCSS: `services/web-ui/src/infographics/workspace/media-library-panel.scss` for glass drawer chrome, backed content surfaces, right-side layout, AI-chat positioning, and responsive inspector behavior.

**Tests:** visual QA + scope-tab filter unit tests.

### Phase 11 — Public publishing + report action + workspace-deletion migration

**Files:**

- The selected Feature inspector exposes an owner-only scope dropdown; moving to `public` requires confirmation.
- The inspector exposes `Report` on public Features the current user does not own, emitting `FEATURE_SUBJECTS.REPORT_ABUSE`.
- NATS handlers verify ownership for Feature mutation, derive scope owners from authenticated workspace/organization membership, and preserve public report threshold behavior.
- [`feature-sample-storage.ts`](../../../services/api/src/services/feature-sample-storage.ts) performs copy-before-promotion into `user-{ownerUserId}-features` and supports legacy fallback reads.
- The `WORKSPACE_SUBJECTS.DELETE_WORKSPACE` handler in [`workspace-subjects.ts`](../../../services/api/src/NATS/subscriptions/workspace-subjects.ts) preserves promoted sample sets before workspace storage teardown and aborts if that preservation cannot complete.

**Tests:** Feature NATS authorization and promotion-order tests plus durable
sample-copy and legacy fallback tests.
