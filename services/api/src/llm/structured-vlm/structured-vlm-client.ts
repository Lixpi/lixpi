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
    maxTokens?: number
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

const buildAnthropicRequest = (args: VlmCallArgs, caps: ModelCapabilities, formattedMessages: Array<{ role: string; content: any }>, useThinking: boolean): Record<string, any> => {
    const thinkingBudget = args.thinkingBudgetTokens ?? 4096
    const baseMaxTokens = args.maxTokens ?? 4096
    // When thinking is on, max_tokens must exceed budget_tokens (unless using
    // adaptive interleaved thinking; we play it safe and add a buffer).
    const maxTokens = useThinking
        ? Math.max(baseMaxTokens, thinkingBudget + 1024)
        : baseMaxTokens

    const request: Record<string, any> = {
        model: args.modelVersion,
        max_tokens: maxTokens,
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

const callAnthropicOnce = async <T>(args: VlmCallArgs, caps: ModelCapabilities, useThinking: boolean): Promise<VlmCallResult<T> | { needsRetry: true; rawText: string }> => {
    const client = getAnthropic()
    const formatted = await resolveAndConvert(args.userMessages, args.natsService, 'ANTHROPIC')
    const request = buildAnthropicRequest(args, caps, formatted, useThinking)

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
    const wantsThinking = args.enableThinking === true && caps.thinkingMode !== 'none'

    // First attempt: with thinking if requested and supported. tool_choice is
    // 'auto' in that case so the model COULD skip the tool — we handle that.
    if (wantsThinking) {
        const result = await callAnthropicOnce<T>(args, caps, true)
        if (!('needsRetry' in result)) return result
        warn(`Anthropic ${args.modelVersion} returned text instead of tool call with thinking on; retrying with forced tool_choice (thinking disabled). rawText preview=${result.rawText.slice(0, 200)}`)
    }

    // Forced tool call (no thinking) — guaranteed structured output.
    const result = await callAnthropicOnce<T>(args, caps, false)
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

const schemaNeedsClosedSchemaAdapter = (schema: unknown): boolean => {
    if (!schema || typeof schema !== 'object') return false
    const node = schema as Record<string, any>
    if (asTypeArray(node.type).includes('object') && node.additionalProperties !== false) {
        return true
    }

    if (node.properties && typeof node.properties === 'object') {
        const required = new Set(Array.isArray(node.required) ? node.required : [])
        for (const key of Object.keys(node.properties)) {
            if (!required.has(key)) return true
        }
        for (const child of Object.values(node.properties)) {
            if (schemaNeedsClosedSchemaAdapter(child)) return true
        }
    }

    const itemSchemas = Array.isArray(node.items)
        ? node.items
        : node.items ? [node.items] : []
    for (const child of itemSchemas) {
        if (schemaNeedsClosedSchemaAdapter(child)) return true
    }

    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        const variants = node[key]
        if (!Array.isArray(variants)) continue
        for (const child of variants) {
            if (schemaNeedsClosedSchemaAdapter(child)) return true
        }
    }

    if (node.not && schemaNeedsClosedSchemaAdapter(node.not)) return true
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
    const client = getOpenAi()
    // 'OPENAI' format yields the Responses-API content shape (input_text /
    // input_image). The system prompt rides on `instructions`, the modern
    // top-level field, rather than a synthetic system message in the input.
    const input = await resolveAndConvert(args.userMessages, args.natsService, 'OPENAI')
    const usesClosedSchemaEnvelope = caps.requiresClosedJsonSchema && schemaNeedsClosedSchemaAdapter(args.schema.schema)
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
    if (args.maxTokens) requestArgs.max_output_tokens = args.maxTokens

    const stream = await client.responses.create(requestArgs as any, { signal: args.abortSignal })

    let rawText = ''
    let finalText = ''
    let modelName = args.modelVersion
    let promptTokens = 0
    let completionTokens = 0

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
    if (args.maxTokens) config.maxOutputTokens = args.maxTokens

    // Enable thinking for visible reasoning when the model supports it. Gemini
    // 3.x uses thinkingLevel; Gemini 2.5 uses thinkingBudget. We include
    // includeThoughts so summaries arrive as thought parts.
    if (args.enableThinking === true && caps.thinkingMode !== 'none') {
        const isGemini3 = /^gemini-3\./i.test(args.modelVersion)
        config.thinkingConfig = isGemini3
            ? { thinkingLevel: 'medium', includeThoughts: true }
            : { thinkingBudget: args.thinkingBudgetTokens ?? -1, includeThoughts: true }
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
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 30_000)
    const dateMs = Date.parse(raw)
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 30_000))
    return undefined
}

const MAX_VLM_RETRIES = 2 // up to 3 attempts total

export const callStructuredVlm = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    assertProviderMessageInputKinds(args.provider, args.modelVersion, args.userMessages)
    info(`[vlm] call provider=${args.provider} model=${args.modelVersion} thinkingMode=${caps.thinkingMode} requestThinking=${args.enableThinking === true}`)

    const dispatch = (): Promise<VlmCallResult<T>> => {
        if (args.provider === 'Anthropic') return callAnthropic<T>(args)
        if (args.provider === 'OpenAI') return callOpenAi<T>(args)
        if (args.provider === 'Google') return callGoogle<T>(args)
        throw new Error(`Unsupported analysis provider for structured VLM call: ${args.provider}`)
    }

    for (let attempt = 0; ; attempt++) {
        try {
            return await dispatch()
        } catch (error: any) {
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
