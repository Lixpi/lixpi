'use strict'

import * as process from 'process'

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type NatsService from '@lixpi/nats-service'
import { warn, info, err } from '@lixpi/debug-tools'

import type { ProviderName } from '@lixpi/constants'
import type { ChatMessage } from '../graph/state.ts'
import { convertAttachmentsForProvider, resolveImageUrls, type AttachmentFormat } from '../utils/attachments.ts'
import {
    assertProviderMessageInputKinds,
    detectCapabilities,
    type ModelCapabilities,
} from '../providers/provider-capabilities.ts'

export type VlmJsonSchema = {
    name: string
    description: string
    schema: Record<string, any>
    // OpenAI strict structured output requires `additionalProperties: false` on every
    // nested object. Schemas that intentionally use open-ended objects (dynamic keys)
    // must opt out with `strict: false`. Defaults to true. OpenAI-only; ignored by
    // the Anthropic and Google paths.
    strict?: boolean
}

export type VlmCallArgs = {
    provider: ProviderName
    modelVersion: string
    systemPrompt: string
    userMessages: ChatMessage[]
    schema: VlmJsonSchema
    natsService: NatsService
    temperature?: number
    // Tokens for the ANSWER only. Thinking headroom is added on top by the
    // runner, uniformly for every provider. See resolveOutputBudget.
    maxTokens?: number
    // The model's hard output ceiling (maxCompletionSize), when the caller knows
    // it. The answer + thinking wire cap is clamped to it.
    maxOutputTokensCeiling?: number
    abortSignal?: AbortSignal
    // Caller intent: should we try to stream reasoning to the user? The strategy
    // layer decides if and how the underlying model can satisfy this — Anthropic
    // gets adaptive/manual thinking (with tool_choice=auto), Google gets
    // thinkingConfig+includeThoughts, OpenAI is silent for non-reasoning models.
    enableThinking?: boolean
    thinkingBudgetTokens?: number
    // Streams text + thinking deltas as they arrive. Visible reasoning when the
    // model emits preamble text or thinking tokens. Only published when the
    // caller provides a callback so parallel callers (extractors) stay silent.
    onTextChunk?: (text: string) => void
}

export type VlmCallResult<T = unknown> = {
    parsed: T
    rawText: string
    modelName: string
    promptTokens: number
    completionTokens: number
}

// ─── Output budget normalization ──────────────────────────────────────────────

// Every provider charges hidden reasoning tokens against the SAME output cap as
// the answer: Anthropic `max_tokens` covers thinking blocks, Google
// `maxOutputTokens` covers thinking parts (Gemini 2.5 thinkingBudget and 3.x
// thinkingLevel alike), OpenAI `max_output_tokens` covers reasoning items. So a
// caller that asks for N tokens of JSON and also asks for thinking gets its JSON
// truncated mid-object, reported as finishReason=MAX_TOKENS, stop_reason
// max_tokens, or response.incomplete, well below the model's real output limit.
//
// `maxTokens` on VlmCallArgs therefore means "tokens for the ANSWER". This layer
// adds the thinking headroom on top, identically for every provider, so no
// caller and no capability has to know provider-specific reasoning accounting.
const DEFAULT_ANSWER_TOKENS = 4096
const DEFAULT_THINKING_TOKENS = 8192

type OutputBudget = {
    answerTokens: number
    thinkingTokens: number
    // What actually goes on the wire as the provider's output cap.
    wireMaxTokens: number
}

type OutputBudgetRequest = {
    maxTokens?: number
    thinkingBudgetTokens?: number
    enableThinking?: boolean
    // The model's own hard output ceiling (maxCompletionSize). The wire cap stays
    // at or below it, since models with small caps reject anything larger.
    maxOutputTokensCeiling?: number
}

const resolveOutputBudget = (args: OutputBudgetRequest, caps: ModelCapabilities): OutputBudget => {
    const requestedAnswer = Math.max(256, args.maxTokens ?? DEFAULT_ANSWER_TOKENS)
    const thinks = args.enableThinking === true && caps.thinkingMode !== 'none'
    // Reasoning scales with task size, so the reserve never drops below the
    // answer itself. A bigger batch thinks proportionally longer.
    const requestedThinking = thinks
        ? Math.max(args.thinkingBudgetTokens ?? DEFAULT_THINKING_TOKENS, requestedAnswer)
        : 0

    const ceiling = args.maxOutputTokensCeiling
    const hasCeiling = typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0
    const requestedWire = requestedAnswer + requestedThinking
    if (!hasCeiling || requestedWire <= ceiling) {
        return { answerTokens: requestedAnswer, thinkingTokens: requestedThinking, wireMaxTokens: requestedWire }
    }

    // The model's ceiling binds. Split it so the answer always keeps at least
    // half, and thinking takes the rest up to what it asked for.
    const thinkingTokens = Math.min(requestedThinking, Math.floor(ceiling / 2))
    return { answerTokens: ceiling - thinkingTokens, thinkingTokens, wireMaxTokens: ceiling }
}

// The completion tokens a caller must reserve in the context window for an answer
// budget of `maxTokens`: the answer plus the provider-normalized thinking reserve.
// Callers that do their own context-window math use this so their reservation
// matches what the runner sends.
export const reservedCompletionTokensForStructuredCall = (request: {
    provider: ProviderName
    modelVersion: string
    maxTokens?: number
    thinkingBudgetTokens?: number
    enableThinking?: boolean
    maxOutputTokensCeiling?: number
}): number => {
    const caps = detectCapabilities(request.provider, request.modelVersion)
    return resolveOutputBudget(request, caps).wireMaxTokens
}

// Raised when the model hit the output cap before closing its structured output.
// Retried by the dispatcher with an escalated budget rather than surfaced as a
// bogus "non-JSON output" parse error.
class VlmOutputTruncatedError extends Error {
    constructor(provider: ProviderName, modelVersion: string, schemaName: string, budget: OutputBudget, detail: string) {
        super(`${provider}/${modelVersion} truncated structured output for schema=${schemaName} at answerTokens=${budget.answerTokens} thinkingTokens=${budget.thinkingTokens} (wire cap ${budget.wireMaxTokens}). ${detail}`)
        this.name = 'VlmOutputTruncatedError'
    }
}

let _anthropic: Anthropic | undefined
let _openai: OpenAI | undefined
let _google: GoogleGenAI | undefined

const getAnthropic = (): Anthropic => {
    if (!_anthropic) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required')
        _anthropic = new Anthropic({ apiKey })
    }
    return _anthropic
}

const getOpenAi = (): OpenAI => {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
        _openai = new OpenAI({ apiKey })
    }
    return _openai
}

const getGoogle = (): GoogleGenAI => {
    if (!_google) {
        const apiKey = process.env.GOOGLE_API_KEY
        if (!apiKey) throw new Error('GOOGLE_API_KEY environment variable is required')
        _google = new GoogleGenAI({ apiKey })
    }
    return _google
}

const resolveAndConvert = async (
    messages: ChatMessage[],
    natsService: NatsService,
    format: AttachmentFormat,
): Promise<Array<{ role: string; content: any }>> => {
    const out: Array<{ role: string; content: any }> = []
    for (const msg of messages) {
        let content: any = msg.content ?? ''
        content = await resolveImageUrls(content, natsService)
        content = convertAttachmentsForProvider(content, format)
        out.push({ role: msg.role, content })
    }
    return out
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

const buildAnthropicRequest = (args: VlmCallArgs, caps: ModelCapabilities, budget: OutputBudget, formattedMessages: Array<{ role: string; content: any }>, useThinking: boolean): Record<string, any> => {
    // max_tokens covers thinking + answer, so it is always the wire cap; the
    // thinking budget is the reserve carved out of it.
    const thinkingBudget = Math.max(1024, budget.thinkingTokens)

    const request: Record<string, any> = {
        model: args.modelVersion,
        max_tokens: useThinking ? budget.wireMaxTokens : budget.answerTokens,
        system: args.systemPrompt,
        messages: formattedMessages,
        tools: [{
            name: args.schema.name,
            description: args.schema.description,
            input_schema: args.schema.schema,
        }],
    }

    if (useThinking) {
        if (caps.thinkingMode === 'adaptive') {
            // Opus 4.7 / Sonnet 4.6 / Opus 4.6 / Mythos. Adaptive auto-enables
            // interleaved thinking and lets Claude decide how much to think.
            request.thinking = { type: 'adaptive', display: 'summarized' }
        } else if (caps.thinkingMode === 'manual') {
            // Older Claude 4 models — manual budget required.
            request.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
        }
        // With thinking enabled, the only legal tool_choice values are 'auto'
        // and 'none'. We use 'auto' and rely on the strong system prompt to
        // make the model call the structured-output tool reliably.
        request.tool_choice = { type: 'auto' }
    } else {
        // No thinking: we can force the tool call for guaranteed structured output.
        request.tool_choice = { type: 'tool', name: args.schema.name }
        if (args.temperature !== undefined && caps.supportsTemperature) {
            request.temperature = args.temperature
        }
    }

    return request
}

const callAnthropicOnce = async <T>(args: VlmCallArgs, caps: ModelCapabilities, budget: OutputBudget, useThinking: boolean): Promise<VlmCallResult<T> | { needsRetry: true; rawText: string }> => {
    const client = getAnthropic()
    const formatted = await resolveAndConvert(args.userMessages, args.natsService, 'ANTHROPIC')
    const request = buildAnthropicRequest(args, caps, budget, formatted, useThinking)

    const stream = client.messages.stream(request as any, { signal: args.abortSignal })

    for await (const event of stream) {
        if (event.type === 'content_block_delta') {
            const delta = event.delta as any
            const deltaType = delta?.type
            if (deltaType === 'text_delta') {
                const text = delta.text ?? ''
                if (text && args.onTextChunk) args.onTextChunk(text)
            } else if (deltaType === 'thinking_delta') {
                const text = delta.thinking ?? ''
                if (text && args.onTextChunk) args.onTextChunk(text)
            }
        }
    }

    const finalMessage = await stream.finalMessage()

    let parsed: T | undefined
    let rawText = ''
    for (const block of finalMessage.content ?? []) {
        const blockType = (block as any).type
        if (blockType === 'tool_use' && (block as any).name === args.schema.name) {
            parsed = (block as any).input as T
            rawText = JSON.stringify(parsed)
            break
        }
        if (blockType === 'text') rawText += (block as any).text ?? ''
    }

    if (parsed === undefined) {
        // A tool call cut off by the output cap arrives as an unusable partial, so
        // escalate the budget instead of blaming the model for skipping the tool.
        if (finalMessage.stop_reason === 'max_tokens') {
            throw new VlmOutputTruncatedError(args.provider, args.modelVersion, args.schema.name, budget, 'stop_reason=max_tokens')
        }
        // Model didn't call the tool. If thinking was enabled (which forces
        // tool_choice='auto'), we can retry without thinking to force the call.
        // Otherwise this is a hard failure.
        if (useThinking) return { needsRetry: true, rawText }
        throw new Error(`Anthropic ${args.modelVersion} did not call tool "${args.schema.name}" even with forced tool_choice. rawText preview=${rawText.slice(0, 200)}`)
    }

    return {
        parsed,
        rawText,
        modelName: finalMessage.model ?? args.modelVersion,
        promptTokens: finalMessage.usage?.input_tokens ?? 0,
        completionTokens: finalMessage.usage?.output_tokens ?? 0,
    }
}

const callAnthropic = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    const budget = resolveOutputBudget(args, caps)
    const wantsThinking = args.enableThinking === true && caps.thinkingMode !== 'none'

    // First attempt: with thinking if requested and supported. tool_choice is
    // 'auto' in that case so the model COULD skip the tool — we handle that.
    if (wantsThinking) {
        const result = await callAnthropicOnce<T>(args, caps, budget, true)
        if (!('needsRetry' in result)) return result
        warn(`Anthropic ${args.modelVersion} returned text instead of tool call with thinking on; retrying with forced tool_choice (thinking disabled). rawText preview=${result.rawText.slice(0, 200)}`)
    }

    // Forced tool call (no thinking) — guaranteed structured output.
    const result = await callAnthropicOnce<T>(args, caps, budget, false)
    if ('needsRetry' in result) {
        throw new Error(`Anthropic ${args.modelVersion} did not call tool "${args.schema.name}" even with forced tool_choice. rawText preview=${result.rawText.slice(0, 200)}`)
    }
    return result
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

const asTypeArray = (type: unknown): string[] => {
    if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === 'string')
    return typeof type === 'string' ? [type] : []
}

const OPENAI_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
    '$schema',
    'allOf',
    'dependentRequired',
    'dependentSchemas',
    'else',
    'if',
    'not',
    'oneOf',
    'then',
    'uniqueItems',
])

const schemaNeedsOpenAIAdapter = (schema: unknown): boolean => {
    if (!schema || typeof schema !== 'object') return false
    const node = schema as Record<string, any>
    if (Object.keys(node).some(key => OPENAI_UNSUPPORTED_SCHEMA_KEYWORDS.has(key))) return true
    if (asTypeArray(node.type).includes('object') && node.additionalProperties !== false) {
        return true
    }

    if (node.properties && typeof node.properties === 'object') {
        const required = new Set(Array.isArray(node.required) ? node.required : [])
        for (const key of Object.keys(node.properties)) {
            if (!required.has(key)) return true
        }
        for (const child of Object.values(node.properties)) {
            if (schemaNeedsOpenAIAdapter(child)) return true
        }
    }

    const itemSchemas = Array.isArray(node.items)
        ? node.items
        : node.items ? [node.items] : []
    for (const child of itemSchemas) {
        if (schemaNeedsOpenAIAdapter(child)) return true
    }

    if (Array.isArray(node.anyOf)) {
        for (const child of node.anyOf) {
            if (schemaNeedsOpenAIAdapter(child)) return true
        }
    }

    return false
}

const buildClosedSchemaPayloadEnvelope = (schema: VlmJsonSchema): VlmJsonSchema => ({
    name: `${schema.name}_payload`,
    description: `${schema.description} Return the result as a JSON string payload.`,
    schema: {
        type: 'object',
        properties: {
            payload: {
                type: 'string',
                description: `A JSON string conforming to the original ${schema.name} schema.`,
            },
        },
        required: ['payload'],
        additionalProperties: false,
    },
})

const buildClosedSchemaPayloadInstructions = (systemPrompt: string, schema: VlmJsonSchema): string => [
    systemPrompt,
    '',
    'Structured output adapter:',
    'Return a JSON object with exactly one field named "payload".',
    'The payload value must be a JSON string, not markdown.',
    `The payload JSON string must conform to this original schema: ${JSON.stringify(schema.schema)}`,
].join('\n')

const parseClosedSchemaPayloadEnvelope = <T>(outer: unknown, provider: ProviderName, schemaName: string): { parsed: T; payloadText: string } => {
    const payload = (outer as any)?.payload
    if (typeof payload !== 'string' || payload.trim() === '') {
        throw new Error(`${provider} returned invalid JSON payload envelope for schema=${schemaName}`)
    }

    try {
        return { parsed: JSON.parse(payload) as T, payloadText: payload }
    } catch (e: any) {
        throw new Error(`${provider} returned non-JSON payload for schema=${schemaName}: ${e?.message}`)
    }
}

const callOpenAi = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    const budget = resolveOutputBudget(args, caps)
    const client = getOpenAi()
    // 'OPENAI' format yields the Responses-API content shape (input_text /
    // input_image). The system prompt rides on `instructions`, the modern
    // top-level field, rather than a synthetic system message in the input.
    const input = await resolveAndConvert(args.userMessages, args.natsService, 'OPENAI')
    const usesClosedSchemaEnvelope = caps.requiresClosedJsonSchema && schemaNeedsOpenAIAdapter(args.schema.schema)
    const requestSchema = usesClosedSchemaEnvelope ? buildClosedSchemaPayloadEnvelope(args.schema) : args.schema
    const instructions = usesClosedSchemaEnvelope ? buildClosedSchemaPayloadInstructions(args.systemPrompt, args.schema) : args.systemPrompt

    const requestArgs: Record<string, any> = {
        model: args.modelVersion,
        instructions,
        input,
        stream: true,
        store: false,
        // Structured Outputs on the Responses API: the model is constrained to
        // the JSON schema and emits the object as output_text — no tool-call
        // round-trip needed.
        text: {
            format: {
                type: 'json_schema',
                name: requestSchema.name,
                description: requestSchema.description,
                schema: requestSchema.schema,
                strict: true,
            },
        },
    }
    if (args.temperature !== undefined && caps.supportsTemperature) requestArgs.temperature = args.temperature
    // Reasoning items are billed against max_output_tokens on the Responses API,
    // so the wire cap carries the same answer+thinking headroom as elsewhere.
    requestArgs.max_output_tokens = budget.wireMaxTokens

    const stream = await client.responses.create(requestArgs as any, { signal: args.abortSignal })

    let rawText = ''
    let finalText = ''
    let modelName = args.modelVersion
    let promptTokens = 0
    let completionTokens = 0
    let incompleteByCap = false

    for await (const event of stream as any) {
        switch (event?.type) {
            case 'response.output_text.delta': {
                const delta: string = event.delta ?? ''
                if (delta) {
                    rawText += delta
                    if (args.onTextChunk && !usesClosedSchemaEnvelope) args.onTextChunk(delta)
                }
                break
            }
            case 'response.completed':
            case 'response.incomplete': {
                const response = event.response
                if (response?.model) modelName = response.model
                if (response?.incomplete_details?.reason === 'max_output_tokens') incompleteByCap = true
                if (typeof response?.output_text === 'string' && response.output_text) {
                    finalText = response.output_text
                }
                if (response?.usage) {
                    promptTokens = response.usage.input_tokens ?? promptTokens
                    completionTokens = response.usage.output_tokens ?? completionTokens
                }
                break
            }
            case 'response.failed': {
                const message = event.response?.error?.message ?? 'unknown error'
                throw new Error(`OpenAI ${args.modelVersion} response failed: ${message}`)
            }
        }
    }

    const outputText = finalText || rawText
    if (incompleteByCap) {
        throw new VlmOutputTruncatedError(args.provider, args.modelVersion, args.schema.name, budget, 'incomplete_details.reason=max_output_tokens')
    }
    if (!outputText) throw new Error(`OpenAI ${args.modelVersion} returned empty structured output for schema=${args.schema.name}`)
    let parsedOuter: unknown
    try { parsedOuter = JSON.parse(outputText) }
    catch (e: any) { throw new Error(`OpenAI returned non-JSON structured output: ${e?.message}`) }
    if (usesClosedSchemaEnvelope) {
        const payload = parseClosedSchemaPayloadEnvelope<T>(parsedOuter, args.provider, args.schema.name)
        return { parsed: payload.parsed, rawText: payload.payloadText, modelName, promptTokens, completionTokens }
    }

    return { parsed: parsedOuter as T, rawText: outputText, modelName, promptTokens, completionTokens }
}

// ─── Google ───────────────────────────────────────────────────────────────────

const callGoogle = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    const budget = resolveOutputBudget(args, caps)
    const client = getGoogle()
    const formatted = await resolveAndConvert(args.userMessages, args.natsService, 'GOOGLE')
    const contents: Array<Record<string, any>> = formatted.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: Array.isArray(msg.content) ? msg.content : [{ text: String(msg.content) }],
    }))

    const config: Record<string, any> = {
        systemInstruction: args.systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: args.schema.schema,
    }
    if (args.temperature !== undefined && caps.supportsTemperature) config.temperature = args.temperature
    // Gemini counts thinking parts against maxOutputTokens, so the wire cap
    // carries the thinking reserve on top of the answer budget.
    config.maxOutputTokens = budget.wireMaxTokens

    // Enable thinking for visible reasoning when the model supports it. Gemini
    // 3.x uses thinkingLevel; Gemini 2.5 uses thinkingBudget. We include
    // includeThoughts so summaries arrive as thought parts.
    if (args.enableThinking === true && caps.thinkingMode !== 'none') {
        const isGemini3 = /^gemini-3\./i.test(args.modelVersion)
        config.thinkingConfig = isGemini3
            ? { thinkingLevel: 'medium', includeThoughts: true }
            // An unbounded (-1) budget would let thinking eat the whole cap and
            // starve the answer; pin it to the reserve we sized for it.
            : { thinkingBudget: budget.thinkingTokens, includeThoughts: true }
    }

    let rawText = ''
    let promptTokens = 0
    let completionTokens = 0
    let finishReason = ''

    const collectUsage = (usageMetadata: any): void => {
        if (!usageMetadata) return
        promptTokens = usageMetadata.promptTokenCount ?? promptTokens
        completionTokens = usageMetadata.candidatesTokenCount ?? completionTokens
    }

    const collectResponseText = (response: any): void => {
        collectUsage(response?.usageMetadata)
        if (!finishReason) {
            const finishedCandidate = response?.candidates?.find((candidate: any) => candidate?.finishReason || candidate?.finish_reason)
            finishReason = finishedCandidate?.finishReason ?? finishedCandidate?.finish_reason ?? ''
        }
        const directText = !args.onTextChunk && typeof response?.text === 'string' ? response.text : ''
        if (directText) {
            rawText += directText
            return
        }
        for (const candidate of response?.candidates ?? []) {
            const parts = candidate?.content?.parts ?? []
            for (const part of parts) {
                const text = part?.text ?? ''
                if (!text) continue
                if (part.thought === true) {
                    if (args.onTextChunk) args.onTextChunk(text)
                } else {
                    rawText += text
                    if (args.onTextChunk) args.onTextChunk(text)
                }
            }
        }
    }

    if (args.onTextChunk) {
        const stream = await client.models.generateContentStream({
            model: args.modelVersion,
            contents,
            config,
        } as any)

        for await (const chunk of stream as any) {
            collectResponseText(chunk)
        }
    } else {
        const response = await client.models.generateContent({
            model: args.modelVersion,
            contents,
            config,
        } as any)
        collectResponseText(response)
    }

    const truncated = /MAX_TOKENS/i.test(finishReason)
    if (truncated) {
        throw new VlmOutputTruncatedError(args.provider, args.modelVersion, args.schema.name, budget, `finishReason=${finishReason}`)
    }
    if (!rawText) throw new Error(`Google ${args.modelVersion} returned empty response for schema=${args.schema.name}`)

    // Gemini's responseSchema occasionally returns the JSON wrapped in
    // markdown code fences. Strip them defensively.
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

    let parsed: T
    try { parsed = JSON.parse(cleaned) as T }
    catch (e: any) {
        const finish = finishReason ? ` finishReason=${finishReason}.` : ''
        throw new Error(`Google returned non-JSON output:${finish} ${e?.message}. Preview: ${cleaned.slice(0, 200)}`)
    }

    return { parsed, rawText: cleaned, modelName: args.modelVersion, promptTokens, completionTokens }
}

// ─── Public dispatcher ────────────────────────────────────────────────────────

// Provider SDKs (Anthropic/OpenAI) throw APIConnectionError with a bland
// "Connection error." message and stash the real cause (ECONNRESET, socket hang up,
// fetch failed, timeout) on `.cause`; rate limits arrive as status=429 with a
// retry-after header. This unwraps all of that into one readable line.
const describeProviderError = (error: any): string => {
    if (!error) return 'unknown error'
    const parts: string[] = [error.name || 'Error']
    if (error.status !== undefined) parts.push(`status=${error.status}`)
    if (error.code !== undefined) parts.push(`code=${error.code}`)
    const headers = error.headers
    const getHeader = (key: string): string | undefined =>
        typeof headers?.get === 'function' ? headers.get(key) : headers?.[key]
    const retryAfter = getHeader('retry-after')
    if (retryAfter) parts.push(`retry-after=${retryAfter}`)
    const requestId = error.request_id ?? error.requestID ?? getHeader('request-id') ?? getHeader('x-request-id')
    if (requestId) parts.push(`requestId=${requestId}`)
    parts.push(`message="${error.message ?? String(error)}"`)
    // Walk the cause chain — the connection error wraps the underlying network error.
    const causes: string[] = []
    let cause = error.cause
    for (let depth = 0; cause && depth < 5; depth++) {
        const code = cause.code ? ` (code=${cause.code})` : ''
        causes.push(`${cause.name ?? 'cause'}: ${cause.message ?? String(cause)}${code}`)
        cause = cause.cause
    }
    if (causes.length) parts.push(`cause=[${causes.join(' <- ')}]`)
    return parts.join(' ')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Transient = worth retrying: rate limits (429), server errors (5xx), and the
// connection/timeout family the SDK surfaces as APIConnectionError + a network cause.
const TRANSIENT_CAUSE_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])

const isTransientError = (error: any): boolean => {
    const status = error?.status
    if (status === 429 || (typeof status === 'number' && status >= 500)) return true
    if (/APIConnection(Timeout)?Error|APITimeoutError|APIConnectionError/.test(error?.name ?? '')) return true
    let cause = error?.cause
    for (let depth = 0; cause && depth < 5; depth++) {
        if (cause.code && TRANSIENT_CAUSE_CODES.has(cause.code)) return true
        cause = cause.cause
    }
    // Anthropic's APIConnectionError carries no status and a bland message.
    if (status === undefined && /connection error|socket hang up|fetch failed|\bterminated\b/i.test(error?.message ?? '')) return true
    return false
}

// Honor a retry-after header (seconds or HTTP-date) when present, capped to 30s.
const parseRetryAfterMs = (error: any): number | undefined => {
    const headers = error?.headers
    const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after']
    if (!raw) return undefined
    const seconds = Number(raw)
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 30000)
    const dateMs = Date.parse(raw)
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 30000))
    return undefined
}

const MAX_VLM_RETRIES = 2 // up to 3 attempts total
// How far truncation-driven escalation may grow the answer budget when the caller
// gives no model ceiling to grow into. With a ceiling, escalation runs up to it.
const MAX_ESCALATED_ANSWER_TOKENS = 32768

export const callStructuredVlm = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    assertProviderMessageInputKinds(args.provider, args.modelVersion, args.userMessages)
    info(`[vlm] call provider=${args.provider} model=${args.modelVersion} thinkingMode=${caps.thinkingMode} requestThinking=${args.enableThinking === true}`)

    const dispatch = (attemptArgs: VlmCallArgs): Promise<VlmCallResult<T>> => {
        if (attemptArgs.provider === 'Anthropic') return callAnthropic<T>(attemptArgs)
        if (attemptArgs.provider === 'OpenAI') return callOpenAi<T>(attemptArgs)
        if (attemptArgs.provider === 'Google') return callGoogle<T>(attemptArgs)
        throw new Error(`Unsupported analysis provider for structured VLM call: ${attemptArgs.provider}`)
    }

    // Answer budget for the current attempt; doubled on truncation.
    let answerTokens = resolveOutputBudget(args, caps).answerTokens

    for (let attempt = 0; ; attempt++) {
        try {
            return await dispatch({ ...args, maxTokens: answerTokens })
        } catch (error: any) {
            // Truncation means the answer did not fit, not that the model failed.
            // Retry with a doubled answer budget, which doubles the thinking
            // reserve with it, growing into the model's own ceiling.
            const escalationCap = args.maxOutputTokensCeiling ?? MAX_ESCALATED_ANSWER_TOKENS
            const grown = Math.min(answerTokens * 2, escalationCap)
            // A request already at the model's output ceiling cannot grow, and
            // repeating it identically would only burn tokens.
            const atCeiling = resolveOutputBudget({ ...args, maxTokens: grown }, caps).answerTokens <= answerTokens
            const canGrow = error instanceof VlmOutputTruncatedError
                && grown > answerTokens
                && !atCeiling
                && !args.abortSignal?.aborted
            if (canGrow) {
                warn(`[vlm] output truncated provider=${args.provider} model=${args.modelVersion} schema=${args.schema.name}; retrying with answerTokens ${answerTokens} -> ${grown} :: ${error.message}`)
                answerTokens = grown
                continue
            }

            const detail = describeProviderError(error)
            const canRetry = attempt < MAX_VLM_RETRIES && isTransientError(error) && !args.abortSignal?.aborted
            if (canRetry) {
                // Jittered exponential backoff, or the server's retry-after when given.
                const backoff = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 400)
                const waitMs = parseRetryAfterMs(error) ?? backoff
                warn(`[vlm] transient failure (attempt ${attempt + 1}/${MAX_VLM_RETRIES + 1}) provider=${args.provider} model=${args.modelVersion} schema=${args.schema.name}; retrying in ${waitMs}ms :: ${detail}`)
                await sleep(waitMs)
                continue
            }
            err(`[vlm] FAILED provider=${args.provider} model=${args.modelVersion} schema=${args.schema.name} after ${attempt + 1} attempt(s): ${detail}`)
            // Re-throw with the enriched detail so the stage trace + UI substep show the real cause.
            throw new Error(`${args.provider}/${args.modelVersion} (${args.schema.name}): ${detail}`, { cause: error })
        }
    }
}
