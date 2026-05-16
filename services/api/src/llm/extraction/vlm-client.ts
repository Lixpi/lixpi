'use strict'

import * as process from 'process'

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type NatsService from '@lixpi/nats-service'
import { warn, info } from '@lixpi/debug-tools'

import type { ProviderName } from '../config.ts'
import type { ChatMessage } from '../graph/state.ts'
import { convertAttachmentsForProvider, resolveImageUrls } from '../utils/attachments.ts'
import { detectCapabilities, type ModelCapabilities } from './capabilities.ts'

export type VlmJsonSchema = {
    name: string
    description: string
    schema: Record<string, any>
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
    format: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE',
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
        return { needsRetry: useThinking, rawText }
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

const callOpenAi = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    const client = getOpenAi()
    const formatted = await resolveAndConvert(args.userMessages, args.natsService, 'OPENAI')
    const messages: Array<Record<string, any>> = [
        { role: 'system', content: args.systemPrompt },
        ...formatted,
    ]

    const requestArgs: Record<string, any> = {
        model: args.modelVersion,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        tools: [{
            type: 'function',
            function: {
                name: args.schema.name,
                description: args.schema.description,
                parameters: args.schema.schema,
                strict: true,
            },
        }],
        tool_choice: { type: 'function', function: { name: args.schema.name } },
    }
    if (args.temperature !== undefined && caps.supportsTemperature) requestArgs.temperature = args.temperature
    if (args.maxTokens) requestArgs.max_tokens = args.maxTokens

    const stream = await client.chat.completions.create(requestArgs as any, { signal: args.abortSignal })

    let toolCallArgs = ''
    let modelName = args.modelVersion
    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of stream as any) {
        if (chunk?.model) modelName = chunk.model
        const delta = chunk?.choices?.[0]?.delta
        if (delta?.content && args.onTextChunk) args.onTextChunk(String(delta.content))
        if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
                if (tc?.function?.arguments) toolCallArgs += tc.function.arguments
            }
        }
        if (chunk?.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? promptTokens
            completionTokens = chunk.usage.completion_tokens ?? completionTokens
        }
    }

    if (!toolCallArgs) throw new Error(`OpenAI ${args.modelVersion} did not call tool "${args.schema.name}"`)
    let parsed: T
    try { parsed = JSON.parse(toolCallArgs) as T }
    catch (e: any) { throw new Error(`OpenAI returned non-JSON tool args: ${e?.message}`) }

    return { parsed, rawText: toolCallArgs, modelName, promptTokens, completionTokens }
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

    const stream = await client.models.generateContentStream({
        model: args.modelVersion,
        contents,
        config,
    } as any)

    let rawText = ''
    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of stream as any) {
        if (chunk?.usageMetadata) {
            promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens
            completionTokens = chunk.usageMetadata.candidatesTokenCount ?? completionTokens
        }
        // Parts can be either response text or thought summaries (when
        // includeThoughts=true). Thought parts have a `thought: true` flag.
        const candidates = chunk?.candidates ?? []
        let chunkHadParts = false
        for (const candidate of candidates) {
            const parts = candidate?.content?.parts ?? []
            for (const part of parts) {
                const text = part?.text ?? ''
                if (!text) continue
                chunkHadParts = true
                if (part.thought === true) {
                    if (args.onTextChunk) args.onTextChunk(text)
                } else {
                    rawText += text
                    if (args.onTextChunk) args.onTextChunk(text)
                }
            }
        }
        // Fallback for shapes where text is at chunk level (older SDK shapes).
        if (!chunkHadParts && typeof chunk?.text === 'string' && chunk.text) {
            rawText += chunk.text
            if (args.onTextChunk) args.onTextChunk(chunk.text)
        }
    }

    if (!rawText) throw new Error(`Google ${args.modelVersion} returned empty response for schema=${args.schema.name}`)

    // Gemini's responseSchema occasionally returns the JSON wrapped in
    // markdown code fences. Strip them defensively.
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()

    let parsed: T
    try { parsed = JSON.parse(cleaned) as T }
    catch (e: any) { throw new Error(`Google returned non-JSON output: ${e?.message}. Preview: ${cleaned.slice(0, 200)}`) }

    return { parsed, rawText: cleaned, modelName: args.modelVersion, promptTokens, completionTokens }
}

// ─── Public dispatcher ────────────────────────────────────────────────────────

export const callStructuredVlm = async <T>(args: VlmCallArgs): Promise<VlmCallResult<T>> => {
    const caps = detectCapabilities(args.provider, args.modelVersion)
    info(`[vlm] call provider=${args.provider} model=${args.modelVersion} thinkingMode=${caps.thinkingMode} requestThinking=${args.enableThinking === true}`)

    if (args.provider === 'Anthropic') return callAnthropic<T>(args)
    if (args.provider === 'OpenAI') return callOpenAi<T>(args)
    if (args.provider === 'Google') return callGoogle<T>(args)
    throw new Error(`Unsupported analysis provider for structured VLM call: ${args.provider}`)
}
