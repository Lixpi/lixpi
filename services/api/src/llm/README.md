# LLM Module

The in-process LangGraph workflow that orchestrates AI provider streaming. Replaces the standalone Python `services/llm-api/` Fargate service that previously did this work — it became unnecessary once `@langchain/langgraph` reached parity with the Python LangGraph package.

## What it does

- Receives a chat request from the NATS gateway handler (`services/api/src/NATS/subscriptions/ai-interaction-subjects.ts`).
- Runs a 6-node LangGraph state machine per provider: `validateRequest → streamTokens → [conditional] validateImagePrompt → executeImageGeneration → calculateUsage → cleanup`.
- Streams tokens to the browser via NATS (`ai.interaction.chat.receiveMessage.{ws}.{thread}`) — the API HTTP server is not in the streaming path.
- Routes dual-model image generation: text model emits a `generate_image` tool call, the workflow's conditional edge spawns a transient image-model provider (OpenAI gpt-image-*, Google Gemini, Stability) that uploads the final image to NATS Object Store.
- Reports token + image usage costs via `decimal.js` pricing math against the model's pricing metadata.

## Public surface

```typescript
import { createLlmModule } from './llm/index.ts'
import { storeWorkspaceImage } from './services/image-storage.ts'

const llmModule = createLlmModule({
    natsService: await NATS_Service.getInstance(),
    storeWorkspaceImage,
})

// Used by the gateway handler
await llmModule.process(instanceKey, providerName, requestData)

// Used by the stop handler
await llmModule.stop(instanceKey)

// Used on SIGINT
await llmModule.shutdown()
```

The factory returns `{ process, stop, shutdown, getSubscriptions }`. `getSubscriptions()` is currently `[]` because the gateway invokes `process()` in-process; it exists so a future split into a separate `llm-workers` ECS service could register the same subscriptions on a different NATS connection without code changes.

## File layout

```
src/llm/
    index.ts                     # createLlmModule({ natsService, storeWorkspaceImage })
    config.ts                    # LLM_TIMEOUT_MS, ProviderName, StreamStatus enum
    graph/
        state.ts                 # ProviderState type + channel reducers (partial-overlay semantics)
        stream-publisher.ts      # START_STREAM, STREAMING, END_STREAM + tag-aware <image_prompt> buffering
        image-publisher.ts       # IMAGE_PARTIAL, IMAGE_COMPLETE + content-hash deduped storage
    providers/
        base-provider.ts         # Abstract BaseProvider — owns the StateGraph, AbortController, workflow nodes
        provider-registry.ts     # Map<instanceKey, provider> + active-task dedupe via Map<string, AbortController>
        openai-provider.ts       # OpenAI Responses API + Image API (gpt-image-*)
        anthropic-provider.ts    # Anthropic messages.stream() + tool_use blocks
        google-provider.ts       # Google generateContentStream + native image generation
        stability-provider.ts    # Stability v2beta REST (multipart, no streaming)
    tools/
        image-generation.ts      # Tool definition, per-provider format builders, tool-call extractors
        image-router.ts          # Spawns transient image-model provider for generate_image tool calls
    utils/
        attachments.ts           # nats-obj:// resolver, magic-byte MIME detection, sharp downscaling
    prompts/
        load-prompts.ts          # readFileSync at module load
        system.txt               # Base system prompt
        image_generation_instructions.txt
        anthropic_code_block_hack.txt
    usage/
        usage-reporter.ts        # decimal.js token + image pricing math
```

## LangGraph workflow

```
validateRequest
    ↓
streamTokens (provider-specific streamImpl)
    ↓
shouldGenerateImage? (checks state.generatedImagePrompt)
    ↓ generate_image                ↓ skip
validateImagePrompt                  |
    ↓                                |
shouldGenerateImage? (post-rewrite)  |
    ↓ generate_image  ↓ skip         |
executeImageGeneration               |
    ↓                                |
calculateUsage ←─────────────────────┘
    ↓
cleanup
    ↓
END
```

Each provider subclasses `BaseProvider` and implements `streamImpl(state)` — everything else is shared.

State updates flow through LangGraph channels with a "keep if undefined" reducer (`graph/state.ts`), giving the same partial-overlay semantics as Python's `TypedDict(total=False)`. A node returning `{ partialField: 'x' }` only mutates `partialField`; all other fields are preserved.

## Cancellation & timeouts

Every `process(...)` call gets an `AbortController`. The 20-minute circuit breaker (`LLM_TIMEOUT_MS = LLM_TIMEOUT_SECONDS * 1000`) aborts mid-stream if a request runs too long. The `stop(instanceKey)` API also aborts, propagating into the vendor SDK call via `{ signal }`.

## Future split

If LLM streaming workload grows enough to want deployment isolation from the gateway:
1. Deploy the same Docker image as `llm-workers` with a different CMD that subscribes to NATS via `getSubscriptions()` instead of running the Express server.
2. Update Pulumi to add the `llm-workers` ECS service with the broader CPU/memory and AI provider env vars.
3. Restore a `serviceAuthConfigs` entry in the auth callout for `svc:llm-workers` (see `documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`).

The LLM module's `index.ts` and the rest of `src/llm/` would not change — they'd just be hosted by a different process that registers `getSubscriptions()` on a NATS connection.

## Reference

- [`documentation/ARCHITECTURE.md`](../../../documentation/ARCHITECTURE.md) — system-wide architecture overview.
- [`documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`](../../../documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md) — auth pattern preserved from the original Python service.
- [`@langchain/langgraph` JS docs](https://github.com/langchain-ai/langgraphjs).
