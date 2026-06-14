# LLM Module

The in-process LangGraph workflow that orchestrates AI provider streaming. It replaces the standalone Python `services/llm-api/` Fargate service that previously did this work; the TypeScript LangGraph package now covers the workflow features Lixpi needs.

## What it does

- Receives a chat request from the NATS gateway handler (`services/api/src/NATS/subscriptions/ai-interaction-subjects.ts`).
- Starts the top-level chat stream immediately, then runs a LangGraph state machine per provider: `resolveWorkspaceContext → resolveFeatures → resolveImageBranch → validateRequest → streamTokens → [conditional] validateImagePrompt → executeImageGeneration` or `executeVideoGeneration` → `calculateUsage → cleanup`.
- Streams tokens to the browser via NATS (`ai.interaction.chat.receiveMessage.{ws}.{thread}`) — the API HTTP server is not in the streaming path.
- Routes dual-model image/video generation: text model emits `generate_image` or `generate_video`, then the workflow spawns a transient image-model provider or VEO video provider that stores the generated media in NATS Object Store.
- Routes multi-model media matrix requests by running one shared workspace/branch preflight, starting one reasoning run per selected reasoning model, then fanning each emitted media prompt out to the selected image or video models with per-run stream metadata.
- Plans media branch topology in the API for media-enabled requests, including branchOrigin and branchFork marker IDs, lineage parent IDs, neutral branch-root provenance, and per-run generated-media lineage assignments.
- Assigns reasoning/media run metadata through a shared media-agnostic run planner, so image and video providers only receive already-planned run IDs and lineage assignments instead of deciding topology themselves.
- Publishes `IMAGE_GENERATION_TRACE` and `VIDEO_GENERATION_TRACE` events immediately before invoking transient media providers. These traces contain the text-model tool prompt, routed media prompt, selected/excluded reference candidates, and preview-safe reference URLs when available.
- Computes token, image, and video usage costs via `decimal.js` pricing math against the model's pricing metadata. The reporter currently logs/returns the calculations; publishing usage events is still pending.

Frontend code must not recreate this orchestration. Branching, reasoning-run fanout, context relevance, resolver decisions, media lineage topology, marker provenance, and run assignments are API responsibilities. The browser may submit snapshots and render stream results, but any decision that changes generated-media graph state must be represented here or in another backend service through a typed contract.

## Public surface

```typescript
import { createLlmModule } from './llm/index.ts'
import { storeWorkspaceImage } from './services/image-storage.ts'
import { storeWorkspaceVideo } from './services/video-storage.ts'

const llmModule = createLlmModule({
    natsService: await NATS_Service.getInstance(),
    storeWorkspaceImage,
    storeWorkspaceVideo,
})

// Used by the gateway handler
await llmModule.process(instanceKey, providerName, requestData)

// Used by the gateway handler for multi-model media sends
await llmModule.processMediaGenerationMatrix(requestData)

// Used by the stop handler
await llmModule.stop(instanceKey)
await llmModule.stopMediaGenerationMatrix({ workspaceId, aiChatThreadId, generationRequestId })

// Used on SIGINT
await llmModule.shutdown()
```

The factory returns `{ process, processMediaGenerationMatrix, stop, stopMediaGenerationMatrix, shutdown, getSubscriptions }`. `getSubscriptions()` is currently `[]` because the gateway invokes `process()` in-process. It marks the intended boundary for a future worker split, but the worker subscriptions still need to be implemented before a separate `llm-workers` service can run.

## File layout

```
src/llm/
    index.ts                     # createLlmModule({ natsService, storeWorkspaceImage, storeWorkspaceVideo })
    config.ts                    # LLM_TIMEOUT_MS, VEO_POLL_INTERVAL_MS, BYTEPLUS_ARK_BASE_URL, BYTEPLUS_VIDEO_POLL_INTERVAL_MS
    graph/
        state.ts                 # ProviderState type + channel reducers (partial-overlay semantics)
        stream-publisher.ts      # START_STREAM, STREAMING, END_STREAM + image/video trace/error events
        image-publisher.ts       # IMAGE_PARTIAL, IMAGE_COMPLETE + content-hash deduped storage
        video-publisher.ts       # VIDEO_PENDING, VIDEO_GENERATING, VIDEO_COMPLETE, VIDEO_ERROR
        workspace-context-resolver.ts # Descriptor-first workspace relevance resolver
        image-branch-resolver.ts # Structured VLM target/reference resolver for image and video generation
    lineage/
        media-branch-lineage-planner.ts # API-owned branchOrigin/branchFork topology and run assignments
        media-generation-run-planner.ts # Shared reasoning/media run IDs, media run enrichment, and event metadata
    providers/
        base-provider.ts         # Abstract BaseProvider — owns the StateGraph, AbortController, workflow nodes
        provider-registry.ts     # Map<instanceKey, provider> + active-task dedupe via Map<string, AbortController>
        openai-provider.ts       # OpenAI Responses API + Image API (gpt-image-*)
        anthropic-provider.ts    # Anthropic messages.stream() + tool_use blocks
        google-provider.ts       # Google generateContentStream + native image generation + VEO submit/poll/download
        byteplus-provider.ts     # BytePlus ModelArk Seedance 2.0 (video-only: create/poll/download)
        byteplus-video-types.ts  # Typed ModelArk REST client + buildSeedanceContent + pollVideoGenerationTask
        stability-provider.ts    # Stability v2beta REST (multipart, no streaming, reference pixel-cap resizing)
    orchestration/
        media-generation-matrix.ts # Normalizes multi-model media requests, resolves model metadata, runs shared preflight, starts grouped reasoning runs
    tools/
        image-generation.ts      # Tool definition, per-provider format builders, tool-call extractors
        image-generation-trace.ts # Final image-model prompt + reference-image trace payload builder
        image-router.ts          # Spawns transient image-model provider for generate_image tool calls
        video-generation.ts      # Tool definition, per-provider format builders, tool-call extractors
        video-generation-trace.ts # Final video-model prompt (shared core + VEO/Seedance profiles) + reference trace builder
        video-router.ts          # Spawns transient video provider (VEO or BytePlus/Seedance) for generate_video tool calls; provider-aware reference cap
    utils/
        attachments.ts           # nats-obj:// resolver, magic-byte MIME detection, sharp downscaling
    prompts/
        load-prompts.ts          # readFileSync at module load
        system.txt               # Base system prompt
        image_generation_instructions.txt
        video_generation_instructions.txt
        anthropic_code_block_hack.txt
    usage/
        usage-reporter.ts        # decimal.js token, image, and video pricing math
```

## LangGraph workflow

```
resolveWorkspaceContext
    ↓
resolveFeatures
    ↓
resolveImageBranch (structured VLM; no-op unless an image or video model is selected)
    ↓
planMediaBranchLineage (API-owned media branch topology; no-op without media)
    ↓
validateRequest
    ↓
streamTokens (provider-specific streamImpl)
    ↓
routeAfterStream?
    ↓ generate_image                 ↓ generate_video          ↓ skip
validateImagePrompt                  executeVideoGeneration    |
    ↓                                ↓                         |
shouldGenerateImage? (post-rewrite)  calculateUsage ←──────────┘
    ↓ generate_image  ↓ skip         ↑
executeImageGeneration ──────────────┘
    ↓
cleanup
    ↓
END
```

Top-level chat requests publish `START_STREAM` before graph invocation. This keeps the browser in a receiving state while pre-stream work such as workspace relevance, `/use` resolution, branch VLM resolution, image URL fetches, and image downscaling runs. Transient image-model providers spawned by `ImageRouter` still skip their own `START_STREAM`/`END_STREAM`; the parent chat stream owns that lifecycle.

`resolveWorkspaceContext` runs first on every request carrying a `WorkspaceContextSnapshot`. It ranks compact node descriptors with the resolver model config (falling back to the chat text model), force-includes explicit chips and edge-forced nodes, and runs one bounded self-heal round for selected nodes whose descriptors are missing, failed, analyzing, thin, or explicitly flagged by the ranker. Improved descriptors are persisted through a targeted `canvasState.nodes[index].descriptor` patch, emitted on `CONTEXT_RELEVANCE_RESOLVED`, and used for one rerank before selected document/thread/media context is prepended to `state.messages` and `imageBranchCandidateSnapshot` is narrowed to the selected media set. When a branch snapshot already exists, auto-selected workspace media outside that snapshot is ignored; only forced chips and edge-forced media may expand it. Missing snapshots no-op so older call sites do not crash.

`resolveImageBranch` runs after workspace relevance and `/use` feature resolution, before the chat provider streams. It consumes the narrowed `imageBranchCandidateSnapshot`, normalizes candidate media URLs once, calls the structured VLM client when candidates exist, publishes `IMAGE_BRANCH_RESOLVED`, and rewrites `state.messages` so only VLM-selected candidate images reach provider `extractReferenceImages()`. Empty candidate snapshots are resolved in the API as fresh generated branches without a VLM call. The same resolver is used for video generation; video candidates contribute a representative still (`frameFileId`, falling back to poster) and the selected result maps to VEO first-frame or reference-image inputs. When the snapshot includes `activeTargetNodeId` / an `active-target` role hint, the resolver prompt treats that candidate as a weak UI selection hint for purely deictic edit prompts while still requiring the selected pixels to match any explicit subject named by the user. For example, a selected goat must not win a prompt that says "that man"; the resolver should choose a visible man candidate or return ambiguous. If the selected target/identity reference is an existing generated candidate, the resolver continues that generated branch even for substantial palette or medium changes; targetless `fresh-branch` is reserved for genuinely new subjects with no generated target. Feature sample references injected by `resolveFeatures` are preserved; only candidate image blocks from the workspace snapshot are stripped/replaced. The selected reference message reuses the resolver-normalized image URLs so the chat provider and media routers do not downscale the same candidate refs again.

For media-enabled requests, `MediaBranchLineagePlanner` runs immediately after branch resolution. It publishes `MEDIA_LINEAGE_PLANNED` with branch origin/fork marker IDs, marker provenance, lineage parent IDs, and run assignments. Those assignments are copied into `generationRun.lineageAssignment` before reasoning and media fanout, so image/video events carry API-owned topology. Matrix requests run the planner once in shared preflight and pass the plan to every reasoning child; single media requests run it as the graph's `planMediaBranchLineage` node.

`MediaBranchLineagePlanner` treats uploaded/source/reference media as context only. A media node becomes `parentMediaNodeId` only when it is already a generated branch member selected by the API as a continuation target. Reference-only video/image requests are rooted through a planned `branchOrigin` or chat/thread source, never by drawing a lineage edge from the uploaded source media itself.

`MediaGenerationRunPlanner` is the separate run metadata layer used by the single-request graph, matrix orchestrator, `ImageRouter`, and `VideoRouter`. It owns stable `reasoningRunId` / `mediaRunId` construction, event metadata enrichment, and copying a run's `MediaRunLineageAssignment` onto concrete image/video media runs. Provider-specific media routers must not duplicate branching or lineage-parent logic.

When the text provider emits `generate_image`, `BaseProvider.executeImageGeneration()` builds and publishes an `IMAGE_GENERATION_TRACE` payload before calling `ImageRouter`. When it emits `generate_video`, `BaseProvider.executeVideoGeneration()` builds and publishes `VIDEO_GENERATION_TRACE` before calling `VideoRouter`. The router and trace builders share prompt helpers so the prompt shown in chat is the exact prompt routed to the transient media provider, including `/use` feature-transfer wrapping when present. Traces must never carry inline image data. Branch references point back to workspace media objects, and `/use` feature sample references point to the authenticated feature sample route, so persisted chat history can render reference thumbnails after a page reload without storing image bytes in NATS stream payloads or ProseMirror state. Image router failures publish `IMAGE_ERROR` with the same media `generationRun` so the browser can remove only that failed placeholder, even when sibling media variants continue.

For multi-model media matrix requests, `MediaGenerationMatrixOrchestrator` resolves the selected models, runs workspace context, `/use` feature, branch resolution, and media lineage planning once, then passes the resolved state into every reasoning child with `preflightResolved`, including the narrowed `imageBranchCandidateSnapshot` used later by generation traces to render stored reference previews. Each reasoning child keeps its own `generationRun.reasoningRunId` and API lineage assignment; when a media tool call is emitted, the shared provider path fans out across the selected media models and gives each router call a `mediaRunId`. Transient media providers use those run ids in their instance keys, trace events, partial events, complete events, and usage metadata so parallel variants do not collide.

Each provider subclasses `BaseProvider` and implements `streamImpl(state)` — everything else is shared.

State updates flow through LangGraph channels with a "keep if undefined" reducer (`graph/state.ts`), giving the same partial-overlay semantics as Python's `TypedDict(total=False)`. A node returning `{ partialField: 'x' }` only mutates `partialField`; all other fields are preserved.

## Cancellation & timeouts

Every `process(...)` call gets an `AbortController`. The 20-minute circuit breaker (`LLM_TIMEOUT_MS = LLM_TIMEOUT_SECONDS * 1000`) aborts mid-stream if a request runs too long. The `stop(instanceKey)` API also aborts, propagating into the vendor SDK call via `{ signal }`.

## Future split

If LLM streaming workload grows enough to want deployment isolation from the gateway:
1. Implement the `getSubscriptions()` entries that route chat and stop subjects to `process()` / `stop()` from a worker process.
2. Deploy the same Docker image as `llm-workers` with a different CMD that subscribes to NATS via those entries instead of running the Express server.
3. Update Pulumi to add the `llm-workers` ECS service with the broader CPU/memory and AI provider env vars.
4. Restore a `serviceAuthConfigs` entry in the auth callout for `svc:llm-workers` (see `documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`).

Most of the workflow code can stay in `src/llm/`; the missing piece is the worker-facing subscription layer.

## Reference

- [`documentation/platform/SYSTEM-ARCHITECTURE.md`](../../../documentation/platform/SYSTEM-ARCHITECTURE.md) — system-wide architecture overview.
- [`documentation/platform/AI-GENERATION-PIPELINE.md`](../../../documentation/platform/AI-GENERATION-PIPELINE.md) — the shared LangGraph workflow this module implements.
- [`documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`](../../../documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md) — auth pattern preserved from the original Python service.
- [`@langchain/langgraph` JS docs](https://github.com/langchain-ai/langgraphjs).
