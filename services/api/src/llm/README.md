# LLM Module

The in-process LangGraph workflow that orchestrates AI provider streaming. It replaces the standalone Python `services/llm-api/` Fargate service that previously did this work; the TypeScript LangGraph package now covers the workflow features Lixpi needs.

## What it does

- Receives a chat request from the NATS gateway handler (`services/api/src/NATS/subscriptions/ai-interaction-subjects.ts`).
- Starts the top-level chat stream immediately, then runs a LangGraph state machine per provider: `resolveWorkspaceContext → resolveFeatures → resolveImageBranch → validateRequest → streamTokens → [conditional] validateImagePrompt → executeImageGeneration` or `executeVideoGeneration` → `calculateUsage → cleanup`.
- Streams tokens to the browser via NATS (`ai.interaction.chat.receiveMessage.{ws}.{thread}`) — the API HTTP server is not in the streaming path.
- Routes dual-model image/video generation: text model emits `generate_image` or `generate_video`, then the workflow spawns a transient image-model provider or VEO video provider that stores the generated media in NATS Object Store.
- Publishes `IMAGE_GENERATION_TRACE` and `VIDEO_GENERATION_TRACE` events immediately before invoking transient media providers. These traces contain the text-model tool prompt, routed media prompt, selected/excluded reference candidates, and preview-safe reference URLs when available.
- Computes token, image, and video usage costs via `decimal.js` pricing math against the model's pricing metadata. The reporter currently logs/returns the calculations; publishing usage events is still pending.

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

// Used by the stop handler
await llmModule.stop(instanceKey)

// Used on SIGINT
await llmModule.shutdown()
```

The factory returns `{ process, stop, shutdown, getSubscriptions }`. `getSubscriptions()` is currently `[]` because the gateway invokes `process()` in-process. It marks the intended boundary for a future worker split, but the worker subscriptions still need to be implemented before a separate `llm-workers` service can run.

## File layout

```
src/llm/
    index.ts                     # createLlmModule({ natsService, storeWorkspaceImage, storeWorkspaceVideo })
    config.ts                    # LLM_TIMEOUT_MS, VEO_POLL_INTERVAL_MS
    graph/
        state.ts                 # ProviderState type + channel reducers (partial-overlay semantics)
        stream-publisher.ts      # START_STREAM, STREAMING, END_STREAM + image/video trace events
        image-publisher.ts       # IMAGE_PARTIAL, IMAGE_COMPLETE + content-hash deduped storage
        video-publisher.ts       # VIDEO_PENDING, VIDEO_GENERATING, VIDEO_COMPLETE, VIDEO_ERROR
        workspace-context-resolver.ts # Descriptor-first workspace relevance resolver
        image-branch-resolver.ts # Structured VLM target/reference resolver for image and video generation
    providers/
        base-provider.ts         # Abstract BaseProvider — owns the StateGraph, AbortController, workflow nodes
        provider-registry.ts     # Map<instanceKey, provider> + active-task dedupe via Map<string, AbortController>
        openai-provider.ts       # OpenAI Responses API + Image API (gpt-image-*)
        anthropic-provider.ts    # Anthropic messages.stream() + tool_use blocks
        google-provider.ts       # Google generateContentStream + native image generation + VEO submit/poll/download
        stability-provider.ts    # Stability v2beta REST (multipart, no streaming)
    tools/
        image-generation.ts      # Tool definition, per-provider format builders, tool-call extractors
        image-generation-trace.ts # Final image-model prompt + reference-image trace payload builder
        image-router.ts          # Spawns transient image-model provider for generate_image tool calls
        video-generation.ts      # Tool definition, per-provider format builders, tool-call extractors
        video-generation-trace.ts # Final video-model prompt + reference trace payload builder
        video-router.ts          # Spawns transient VEO provider for generate_video tool calls
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

`resolveWorkspaceContext` runs first on every request carrying a `WorkspaceContextSnapshot`. It ranks compact node descriptors with the resolver model config (falling back to the chat text model), force-includes explicit chips and edge-forced nodes, and runs one bounded self-heal round for selected nodes whose descriptors are missing, failed, analyzing, thin, or explicitly flagged by the ranker. Improved descriptors are persisted through a targeted `canvasState.nodes[index].descriptor` patch, emitted on `CONTEXT_RELEVANCE_RESOLVED`, and used for one rerank before selected document/thread/media context is prepended to `state.messages` and `imageBranchCandidateSnapshot` is narrowed to the selected media set. Missing snapshots no-op so older call sites do not crash.

`resolveImageBranch` runs after workspace relevance and `/use` feature resolution, before the chat provider streams. It consumes the narrowed `imageBranchCandidateSnapshot`, normalizes candidate media URLs once, calls the structured VLM client, publishes `IMAGE_BRANCH_RESOLVED`, and rewrites `state.messages` so only VLM-selected candidate images reach provider `extractReferenceImages()`. The same resolver is used for video generation; video candidates contribute a representative still (`frameFileId`, falling back to poster) and the selected result maps to VEO first-frame or reference-image inputs. When the snapshot includes `activeTargetNodeId` / an `active-target` role hint, the resolver prompt treats that candidate as a weak UI selection hint for purely deictic edit prompts while still requiring the selected pixels to match any explicit subject named by the user. For example, a selected goat must not win a prompt that says "that man"; the resolver should choose a visible man candidate or return ambiguous. If the selected target/identity reference is an existing generated candidate, the resolver continues that generated branch even for substantial palette or medium changes; targetless `fresh-branch` is reserved for genuinely new subjects with no generated target. Feature sample references injected by `resolveFeatures` are preserved; only candidate image blocks from the workspace snapshot are stripped/replaced. The selected reference message reuses the resolver-normalized image URLs so the chat provider and media routers do not downscale the same candidate refs again.

When the text provider emits `generate_image`, `BaseProvider.executeImageGeneration()` builds and publishes an `IMAGE_GENERATION_TRACE` payload before calling `ImageRouter`. When it emits `generate_video`, `BaseProvider.executeVideoGeneration()` builds and publishes `VIDEO_GENERATION_TRACE` before calling `VideoRouter`. The router and trace builders share prompt helpers so the prompt shown in chat is the exact prompt routed to the transient media provider, including `/use` feature-transfer wrapping when present. Traces must never carry inline image data. Branch references point back to workspace media objects, and `/use` feature sample references point to the authenticated feature sample route, so persisted chat history can render reference thumbnails after a page reload without storing image bytes in NATS stream payloads or ProseMirror state.

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
