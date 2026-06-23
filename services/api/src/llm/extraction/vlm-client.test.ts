'use strict'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { callStructuredVlm, type VlmCallArgs } from './vlm-client.ts'

const openAiCreate = vi.fn()
const anthropicStream = vi.fn()
const googleGenerateContent = vi.fn()
const googleGenerateContentStream = vi.fn()

vi.mock('openai', () => ({
    default: class {
        public chat = { completions: { create: openAiCreate } }
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
    },
}

const baseArgs: Omit<VlmCallArgs, 'provider' | 'modelVersion' | 'natsService'> = {
    systemPrompt: 'You are helping.',
    userMessages: [{ role: 'user', content: 'analyze this' }],
    schema,
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

const makeOpenAiToolCallChunk = (argument: string, model?: string) => ({
    ...(model ? { model } : {}),
    choices: [{ delta: { tool_calls: [{ function: { arguments: argument } }] } }],
})

describe('callStructuredVlm', () => {
    beforeEach(() => {
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
        process.env.OPENAI_API_KEY = 'test-openai-key'
        process.env.GOOGLE_API_KEY = 'test-google-key'
        vi.clearAllMocks()
    })

    it('dispatches to OpenAI and parses streamed function arguments', async () => {
        openAiCreate.mockResolvedValueOnce(makeAsyncStream([
            {
                ...makeOpenAiToolCallChunk('{"status":"'),
                usage: { prompt_tokens: 10, completion_tokens: 4 },
            },
            {
                ...makeOpenAiToolCallChunk('ok"}'),
                usage: { prompt_tokens: 11, completion_tokens: 8 },
            },
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
        expect(createRequest?.tool_choice).toMatchObject({ type: 'function', function: { name: 'extract' } })
    })

    it('retries and succeeds when OpenAI throws a transient error once', async () => {
        const headers = { get: vi.fn((key: string) => key === 'retry-after' ? '0' : undefined) }
        const transientError = { name: 'APIConnectionError', message: 'Connection error.', cause: { code: 'ECONNRESET', message: 'socket hang up' }, headers }

        openAiCreate
            .mockRejectedValueOnce(transientError)
            .mockResolvedValueOnce(makeAsyncStream([
                {
                    ...makeOpenAiToolCallChunk('{"status":"'),
                },
                makeOpenAiToolCallChunk('ok"}'),
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
            onTextChunk: (text) => chunks.push(text),
        })

        expect(googleGenerateContentStream).toHaveBeenCalledOnce()
        expect(googleGenerateContent).not.toHaveBeenCalled()
        expect(chunks.join('')).toContain('"ignore":true')
        expect(result.rawText).toBe('{"status":"ok"}')
        expect(result.rawText).not.toContain('"ignore":true')
        expect(result.parsed).toEqual({ status: 'ok' })
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
