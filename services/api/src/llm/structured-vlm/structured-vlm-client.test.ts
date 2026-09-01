'use strict'

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
    beforeEach,
} from 'vitest'

import * as debugTools from '@lixpi/debug-tools'
import type { AiModelInferenceCapabilities } from '@lixpi/constants'

import {
    callStructuredVlm,
    type VlmCallArgs,
} from './structured-vlm-client.ts'

const openAiCreate = vi.fn()
const anthropicStream = vi.fn()
const googleGenerateContent = vi.fn()
const googleGenerateContentStream = vi.fn()

vi.mock('openai', () => ({
    default: class {
        public responses = { create: openAiCreate }
    },
}))

vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        public messages = { stream: anthropicStream }
    },
}))

vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        public models = {
            generateContent: googleGenerateContent,
            generateContentStream: googleGenerateContentStream,
        }
    },
}))

const schema = {
    name: 'extract',
    description: 'extract',
    schema: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string' } },
        additionalProperties: false,
    },
}

const OPENAI_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: true,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const ANTHROPIC_ADAPTIVE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'anthropic-adaptive',
    requiresAutoToolChoiceWithThinking: true,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const GOOGLE_LEVEL_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'google-level',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'audio', 'document-text'],
}

const baseArgs: Omit<VlmCallArgs, 'provider' | 'modelVersion' | 'natsService'> = {
    systemPrompt: 'You are helping.',
    userMessages: [{ role: 'user', content: 'analyze this' }],
    schema,
    inferenceCapabilities: OPENAI_CAPABILITIES,
    temperature: 0.6,
    maxTokens: 4096,
}

const makeAsyncStream = <T>(chunks: T[]) => ({
    async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
    },
})

const makeAnthropicStream = (events: any[], finalMessage: any) => ({
    async *[Symbol.asyncIterator]() {
        for (const event of events) yield event
    },
    async finalMessage() {
        return finalMessage
    },
})

// Responses-API streaming events: structured output arrives as output_text
// deltas; the terminal event carries the authoritative output_text + usage.
const makeOpenAiTextDelta = (delta: string) => ({
    type: 'response.output_text.delta',
    delta,
})
const makeOpenAiCompleted = (outputText: string, model: string, usage?: { input_tokens: number; output_tokens: number }) => ({
    type: 'response.completed',
    response: { model, output_text: outputText, ...(usage ? { usage } : {}) },
})

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null

describe('callStructuredVlm', () => {
    beforeEach(() => {
        debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
        debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
        debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)

        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
        process.env.OPENAI_API_KEY = 'test-openai-key'
        process.env.GOOGLE_API_KEY = 'test-google-key'
        vi.clearAllMocks()
    })

    afterEach(() => {
        debugInfoSpy?.mockRestore()
        debugInfoSpy = null
        debugWarnSpy?.mockRestore()
        debugWarnSpy = null
        debugErrSpy?.mockRestore()
        debugErrSpy = null
    })

    it('dispatches to OpenAI and parses streamed structured output', async () => {
        openAiCreate.mockResolvedValueOnce(makeAsyncStream([
            makeOpenAiTextDelta('{"status":"'),
            makeOpenAiTextDelta('ok"}'),
            makeOpenAiCompleted('{"status":"ok"}', 'gpt-4.1', { input_tokens: 11, output_tokens: 8 }),
        ]))

        const result = await callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
        })

        expect(openAiCreate).toHaveBeenCalledOnce()
        expect(result.modelName).toBe('gpt-4.1')
        expect(result.rawText).toBe('{"status":"ok"}')
        expect(result.parsed).toEqual({ status: 'ok' })
        expect(result.promptTokens).toBe(11)
        expect(result.completionTokens).toBe(8)
        const createRequest = openAiCreate.mock.calls[0]?.[0]
        expect(createRequest?.model).toBe('gpt-4.1')
        expect(createRequest?.instructions).toBe('You are helping.')
        expect(createRequest?.text?.format).toMatchObject({ type: 'json_schema', name: 'extract', strict: true })
    })

    it('wraps OpenAI open schemas in a closed payload envelope and returns the parsed payload', async () => {
        const openSchema = {
            name: 'extract',
            description: 'extract',
            schema: {
                type: 'object',
                required: ['status'],
                properties: {
                    status: { type: 'string' },
                    optionalNote: { type: 'string' },
                },
            },
        }
        const payloadText = '{"status":"ok","optionalNote":"kept"}'
        const envelopeText = JSON.stringify({ payload: payloadText })
        const chunks: string[] = []

        openAiCreate.mockResolvedValueOnce(makeAsyncStream([
            makeOpenAiTextDelta(envelopeText.slice(0, 12)),
            makeOpenAiTextDelta(envelopeText.slice(12)),
            makeOpenAiCompleted(envelopeText, 'gpt-4.1', { input_tokens: 14, output_tokens: 9 }),
        ]))

        const result = await callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
            schema: openSchema,
            onTextChunk: (text) => chunks.push(text),
        })

        expect(result.rawText).toBe(payloadText)
        expect(result.parsed).toEqual({ status: 'ok', optionalNote: 'kept' })
        expect(chunks).toEqual([])

        const createRequest = openAiCreate.mock.calls[0]?.[0]
        expect(createRequest?.text?.format).toMatchObject({
            type: 'json_schema',
            name: 'extract_payload',
            strict: true,
            schema: {
                type: 'object',
                required: ['payload'],
                additionalProperties: false,
            },
        })
        expect(createRequest?.instructions).toContain('Structured output adapter:')
        expect(createRequest?.instructions).toContain('The payload value must be a JSON string, not markdown.')
        expect(createRequest?.instructions).toContain('"optionalNote"')
    })

    it('omits temperature when synchronized OpenAI capabilities disable it', async () => {
        openAiCreate.mockResolvedValueOnce(makeAsyncStream([
            makeOpenAiCompleted('{"status":"ok"}', 'gpt-5'),
        ]))

        await callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-5',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: {
                ...OPENAI_CAPABILITIES,
                supportsTemperature: false,
            },
        })

        const createRequest = openAiCreate.mock.calls[0]?.[0]
        expect(createRequest).not.toHaveProperty('temperature')
        expect(createRequest?.max_output_tokens).toBe(4096)
    })

    it('omits temperature from forced Anthropic tool calls when synchronized capabilities disable it', async () => {
        anthropicStream.mockReturnValueOnce(makeAnthropicStream([], {
            model: 'claude-sonnet-5',
            content: [{ type: 'tool_use', name: 'extract', input: { status: 'ok' } }],
            usage: { input_tokens: 5, output_tokens: 7 },
        }))

        await callStructuredVlm({
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-5',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: {
                ...ANTHROPIC_ADAPTIVE_CAPABILITIES,
                supportsTemperature: false,
            },
            enableThinking: false,
        })

        expect(anthropicStream.mock.calls[0]?.[0]).not.toHaveProperty('temperature')
    })

    it('retries and succeeds when OpenAI throws a transient error once', async () => {
        const headers = { get: vi.fn((key: string) => key === 'retry-after' ? '0' : undefined) }
        const transientError = { name: 'APIConnectionError', message: 'Connection error.', cause: { code: 'ECONNRESET', message: 'socket hang up' }, headers }

        openAiCreate
            .mockRejectedValueOnce(transientError)
            .mockResolvedValueOnce(makeAsyncStream([
                makeOpenAiTextDelta('{"status":"'),
                makeOpenAiTextDelta('ok"}'),
                makeOpenAiCompleted('{"status":"ok"}', 'gpt-4.1'),
            ]))

        const result = await callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
        })

        expect(openAiCreate).toHaveBeenCalledTimes(2)
        expect(result.parsed).toEqual({ status: 'ok' })
    })

    it('fails immediately when OpenAI throws a non-transient error', async () => {
        const nonTransientError = {
            name: 'BadRequestError',
            status: 400,
            message: 'Request malformed',
            headers: { get: vi.fn(() => undefined) },
        }

        openAiCreate.mockRejectedValueOnce(nonTransientError)

        await expect(callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
        })).rejects.toThrow('OpenAI/gpt-4.1 (extract): BadRequestError')

        expect(openAiCreate).toHaveBeenCalledOnce()
    })

    it('retries transient OpenAI errors inferred from a nested cause code', async () => {
        const transientError = {
            name: 'Error',
            message: 'temporary network disruption',
            headers: { get: vi.fn(() => '0') },
            cause: {
                name: 'CauseError',
                message: 'timeout while reading',
                cause: { code: 'ETIMEDOUT', message: 'socket timed out' },
            },
        }

        openAiCreate
            .mockRejectedValueOnce(transientError)
            .mockResolvedValueOnce(makeAsyncStream([
                makeOpenAiTextDelta('{"status":"'),
                makeOpenAiTextDelta('ok"}'),
                makeOpenAiCompleted('{"status":"ok"}', 'gpt-4.1'),
            ]))

        const result = await callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
        })

        expect(openAiCreate).toHaveBeenCalledTimes(2)
        expect(result.parsed).toEqual({ status: 'ok' })
    })

    it('retries transient failures up to three attempts and then throws with enriched context', async () => {
        const headers = { get: vi.fn(() => '0') }
        const transientError = { name: 'APIConnectionError', message: 'Connection error.', cause: { code: 'ECONNRESET', message: 'socket hang up' }, headers }
        openAiCreate
            .mockRejectedValueOnce(transientError)
            .mockRejectedValueOnce(transientError)
            .mockRejectedValueOnce(transientError)

        await expect(callStructuredVlm({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            natsService: {} as any,
            ...baseArgs,
        })).rejects.toThrow('OpenAI/gpt-4.1 (extract): APIConnectionError')

        expect(openAiCreate).toHaveBeenCalledTimes(3)
    })

    it('retries a thinking-enabled Anthropic run with forced tool call if thinking emits no tool', async () => {
        anthropicStream
            .mockReturnValueOnce(makeAnthropicStream([
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'thinking...' } },
            ], { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'analysis-only' }], usage: { input_tokens: 3, output_tokens: 9 } }))
            .mockReturnValueOnce(makeAnthropicStream([
                { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } },
            ], {
                model: 'claude-sonnet-4-6',
                content: [{ type: 'tool_use', name: 'extract', input: { status: 'ok' } }],
                usage: { input_tokens: 5, output_tokens: 12 },
            }))

        const result = await callStructuredVlm({
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: ANTHROPIC_ADAPTIVE_CAPABILITIES,
            enableThinking: true,
        })

        expect(anthropicStream).toHaveBeenCalledTimes(2)
        expect(result.parsed).toEqual({ status: 'ok' })
        expect(result.promptTokens).toBe(5)
        expect(result.completionTokens).toBe(12)
        const firstRequest = anthropicStream.mock.calls[0]?.[0]
        const secondRequest = anthropicStream.mock.calls[1]?.[0]
        expect(firstRequest?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
        expect(firstRequest?.tool_choice).toEqual({ type: 'auto' })
        expect(secondRequest?.tool_choice).toEqual({ type: 'tool', name: 'extract' })
    })

    it('throws from Anthropic when forced tool-call mode still returns no tool use', async () => {
        anthropicStream.mockReturnValueOnce(makeAnthropicStream(
            [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'plain text' } }],
            { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'plain text' }], usage: { input_tokens: 3, output_tokens: 1 } },
        ))

        await expect(callStructuredVlm({
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: ANTHROPIC_ADAPTIVE_CAPABILITIES,
            enableThinking: false,
        })).rejects.toThrow('did not call tool')
        expect(anthropicStream).toHaveBeenCalledTimes(1)
    })

    it('dispatches to Google and strips markdown fences before JSON parse', async () => {
        googleGenerateContent.mockResolvedValue({
            candidates: [{ content: { parts: [{ text: '```json\n{"status":"ok"}\n```' }] } }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
        })

        const result = await callStructuredVlm({
            provider: 'Google',
            modelVersion: 'gemini-2.5-flash-image',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: {
                ...GOOGLE_LEVEL_CAPABILITIES,
                thinkingMode: 'google-budget',
            },
        })

        expect(googleGenerateContent).toHaveBeenCalledOnce()
        expect(googleGenerateContentStream).not.toHaveBeenCalled()
        expect(result.modelName).toBe('gemini-2.5-flash-image')
        expect(result.rawText).toBe('{"status":"ok"}')
        expect(result.promptTokens).toBe(2)
        expect(result.completionTokens).toBe(1)
    })

    it('streams Google content and excludes thought-only blocks from parsed raw JSON', async () => {
        googleGenerateContentStream.mockResolvedValue(makeAsyncStream([
            {
                candidates: [
                    {
                        content: { parts: [{ text: '{"status"' }, { thought: true, text: '"ignore":true' }] },
                    },
                ],
                finishReason: 'STOP',
            },
            {
                candidates: [
                    {
                        content: { parts: [{ text: ':"ok"}' }] },
                    },
                ],
                finishReason: 'STOP',
            },
        ]))

        const chunks: string[] = []
        const result = await callStructuredVlm({
            provider: 'Google',
            modelVersion: 'gemini-3.0-flash',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: GOOGLE_LEVEL_CAPABILITIES,
            enableThinking: true,
            onTextChunk: (text) => chunks.push(text),
        })

        expect(googleGenerateContentStream).toHaveBeenCalledOnce()
        expect(googleGenerateContent).not.toHaveBeenCalled()
        expect(chunks.join('')).toContain('"ignore":true')
        expect(result.rawText).toBe('{"status":"ok"}')
        expect(result.rawText).not.toContain('"ignore":true')
        expect(result.parsed).toEqual({ status: 'ok' })
        expect(googleGenerateContentStream.mock.calls[0]?.[0]?.config?.thinkingConfig).toEqual({
            thinkingLevel: 'medium',
            includeThoughts: true,
        })
    })

    it('throws for malformed Google JSON after streaming', async () => {
        const malformedGoogleResponse = {
            candidates: [
                {
                    content: { parts: [{ text: 'not-json' }] },
                },
            ],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
        }
        googleGenerateContent.mockResolvedValue(malformedGoogleResponse)

        await expect(callStructuredVlm({
            provider: 'Google',
            modelVersion: 'gemini-2.5-flash-image',
            natsService: {} as any,
            ...baseArgs,
            inferenceCapabilities: {
                ...GOOGLE_LEVEL_CAPABILITIES,
                thinkingMode: 'google-budget',
            },
        })).rejects.toThrow('Google returned non-JSON output')
    })

    it('throws unsupported provider errors through the public dispatcher', async () => {
        await expect(callStructuredVlm({
            provider: 'AWS' as any,
            modelVersion: 'x',
            natsService: {} as any,
            ...baseArgs,
        })).rejects.toThrow('Unsupported analysis provider')
    })
})
