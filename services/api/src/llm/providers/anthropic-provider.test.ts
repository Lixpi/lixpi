'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { AiModelInferenceCapabilities } from '@lixpi/constants'

const debugTools = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => debugTools)

const anthropicMocks = vi.hoisted(() => ({
    stream: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn(function() {
        return {
            messages: {
                stream: anthropicMocks.stream,
            },
        }
    }),
}))

vi.mock('@anthropic-ai/bedrock-sdk', () => ({
    AnthropicBedrock: vi.fn(function() {
        return { messages: { stream: anthropicMocks.stream } }
    }),
}))

import { AnthropicProvider } from './anthropic-provider.ts'
import type { BaseProviderDeps } from './base-provider.ts'
import { CURRENT_MEDIA_PROVIDER_DEFINITIONS } from './current-media-provider-definitions.ts'

const ANTHROPIC_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const makeDeps = (): BaseProviderDeps => ({
    natsService: { publish: vi.fn() } as any,
    usageReporter: {} as any,
    runImageRouter: vi.fn(),
    runVideoRouter: vi.fn(),
    mediaProviderDefinition: CURRENT_MEDIA_PROVIDER_DEFINITIONS.Anthropic,
})

// Builds a fake Anthropic `messages.stream()` return value: an async-iterable
// of stream events plus a `finalMessage()` resolver, exactly as the SDK's
// MessageStream shape is consumed in streamImpl().
const makeAnthropicStream = (
    textChunks: string[],
    finalMessage: Record<string, any>,
) => ({
    [Symbol.asyncIterator]: async function*() {
        for (const text of textChunks) {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
        }
    },
    finalMessage: vi.fn(async () => finalMessage),
})

const setProviderPublishers = (provider: AnthropicProvider) => {
    const start = vi.fn()
    const end = vi.fn()
    const chunk = vi.fn()
    const error = vi.fn()
    ;(provider as any).streamPublisher = { start, end, chunk, error }
    ;(provider as any).abortController = new AbortController()
    return { start, end, chunk, error }
}

const makeState = (overrides: Record<string, any> = {}) => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    modelVersion: 'claude-sonnet-4-6',
    maxCompletionSize: 4096,
    aiModelMetaInfo: {
        provider: 'Anthropic',
        model: 'claude-sonnet-4-6',
        modelVersion: 'claude-sonnet-4-6',
        inferenceCapabilities: ANTHROPIC_INFERENCE_CAPABILITIES,
    },
    messages: [{ role: 'user', content: 'Describe a sunset over the ocean.' }],
    // Bypass capability-model-tool exposure so plain streaming tests don't
    // need to also mock the capability dispatcher.
    capabilityInvocationDepth: 1,
    ...overrides,
})

describe('AnthropicProvider', () => {
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    const previousBedrockFlags = {
        ANTHROPIC_USE_AWS_BEDROCK_INFERENCE: process.env.ANTHROPIC_USE_AWS_BEDROCK_INFERENCE,
        AWS_REGION: process.env.AWS_REGION,
    }

    beforeEach(() => {
        process.env.ANTHROPIC_API_KEY = 'test-key'
        delete process.env.ANTHROPIC_USE_AWS_BEDROCK_INFERENCE
        anthropicMocks.stream.mockReset()
    })

    afterEach(() => {
        if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
        else process.env.ANTHROPIC_API_KEY = previousApiKey
        for (const [key, value] of Object.entries(previousBedrockFlags)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        vi.restoreAllMocks()
    })

    // ===== construction =====
    describe('construction', () => {
        it('reports providerName Anthropic', () => {
            const provider = new AnthropicProvider('ws:thread:reasoning', makeDeps())
            expect(provider.providerName).toBe('Anthropic')
        })

        it('throws a clear error when ANTHROPIC_API_KEY is not configured', () => {
            delete process.env.ANTHROPIC_API_KEY
            expect(() => new AnthropicProvider('ws:thread:reasoning', makeDeps()))
                .toThrow('ANTHROPIC_API_KEY environment variable is required')
        })

        it('routes through AnthropicBedrock without requiring an API key when Bedrock is enabled', () => {
            delete process.env.ANTHROPIC_API_KEY
            process.env.ANTHROPIC_USE_AWS_BEDROCK_INFERENCE = 'true'
            process.env.AWS_REGION = 'us-east-1'
            expect(() => new AnthropicProvider('ws:thread:reasoning', makeDeps())).not.toThrow()
        })
    })

    // ===== plain text streaming =====
    describe('streamImpl — plain text streaming', () => {
        it('streams chunks, publishes them, and reports usage without any tool call', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            const publisherState = setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                ['The sun ', 'dips below the waves.'],
                {
                    id: 'msg_1',
                    content: [{ type: 'text', text: 'The sun dips below the waves.' }],
                    usage: { input_tokens: 12, output_tokens: 8 },
                },
            ))

            const result = await (provider as any).streamImpl(makeState())

            expect(publisherState.start).toHaveBeenCalledTimes(1)
            expect(publisherState.chunk).toHaveBeenNthCalledWith(1, 'The sun ')
            expect(publisherState.chunk).toHaveBeenNthCalledWith(2, 'dips below the waves.')
            expect(publisherState.error).not.toHaveBeenCalled()
            expect(publisherState.end).toHaveBeenCalledTimes(1)
            expect(result.error).toBeUndefined()
            expect(result.usage).toEqual({
                promptTokens: 12,
                promptAudioTokens: 0,
                promptCachedTokens: 0,
                completionTokens: 8,
                completionAudioTokens: 0,
                completionReasoningTokens: 0,
                totalTokens: 20,
            })
            expect(result.aiVendorRequestId).toBe('msg_1')
            expect(result.generatedImagePrompt).toBeUndefined()
            expect(result.generatedVideoPrompt).toBeUndefined()
        })

        it('does not attach image or video tools when neither media model is enabled', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                ['hello'],
                { id: 'msg_2', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 1, output_tokens: 1 } },
            ))

            await (provider as any).streamImpl(makeState())

            const streamArgs = anthropicMocks.stream.mock.calls[0]?.[0]
            expect(streamArgs.tools).toBeUndefined()
        })

        it('forwards effort with adaptive thinking and keeps tool choice automatic', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                ['hello'],
                { id: 'msg-adaptive', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 1, output_tokens: 1 } },
            ))

            await (provider as any).streamImpl(makeState({
                reasoningGenerationConfig: { reasoningEffort: 'max' },
                aiModelMetaInfo: {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    inferenceCapabilities: {
                        ...ANTHROPIC_INFERENCE_CAPABILITIES,
                        thinkingMode: 'anthropic-adaptive',
                        requiresAutoToolChoiceWithThinking: true,
                        supportsTemperature: false,
                    },
                },
                imageModelVersion: 'gpt-image-2',
                imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-2', modelVersion: 'gpt-image-2' },
                imageProviderName: 'OpenAI',
            }))

            const streamArgs = anthropicMocks.stream.mock.calls[0]?.[0]
            expect(streamArgs.output_config).toEqual({ effort: 'max' })
            expect(streamArgs.thinking).toEqual({ type: 'adaptive' })
            expect(streamArgs.tools).toHaveLength(1)
            expect(streamArgs.tool_choice).toBeUndefined()
            expect(streamArgs.temperature).toBeUndefined()
        })
    })

    // ===== image generation tool call =====
    describe('streamImpl — generate_image tool call', () => {
        it('extracts the image prompt and reference images, forcing the image tool when only image is enabled', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            const publisherState = setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                [],
                {
                    id: 'msg_3',
                    content: [{
                        type: 'tool_use',
                        id: 'tool_1',
                        name: 'generate_image',
                        input: { prompt: 'A red bicycle leaning on a brick wall.' },
                    }],
                    usage: { input_tokens: 5, output_tokens: 5 },
                },
            ))

            const result = await (provider as any).streamImpl(makeState({
                imageModelVersion: 'gpt-image-2',
                imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-2', modelVersion: 'gpt-image-2' },
                imageProviderName: 'OpenAI',
            }))

            const streamArgs = anthropicMocks.stream.mock.calls[0]?.[0]
            expect(streamArgs.tool_choice).toEqual({ type: 'tool', name: 'generate_image' })
            expect(result.generatedImagePrompt).toBe('A red bicycle leaning on a brick wall.')
            expect(result.generatedVideoPrompt).toBeUndefined()
            expect(publisherState.error).not.toHaveBeenCalled()
        })
    })

    // ===== video generation tool call =====
    describe('streamImpl — generate_video tool call', () => {
        it('extracts the video prompt and forces the video tool when only video is enabled', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            const publisherState = setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                [],
                {
                    id: 'msg_4',
                    content: [{
                        type: 'tool_use',
                        id: 'tool_2',
                        name: 'generate_video',
                        input: {
                            prompt: 'A drone shot rising over a foggy forest.',
                            negativePrompt: 'no subtitles',
                        },
                    }],
                    usage: { input_tokens: 5, output_tokens: 5 },
                },
            ))

            const result = await (provider as any).streamImpl(makeState({
                videoModelVersion: 'veo-3.1',
                videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1-generate-preview', modelVersion: 'veo-3.1' },
                videoProviderName: 'Google',
            }))

            const streamArgs = anthropicMocks.stream.mock.calls[0]?.[0]
            expect(streamArgs.tool_choice).toEqual({ type: 'tool', name: 'generate_video' })
            expect(result.generatedVideoPrompt).toBe('A drone shot rising over a foggy forest.')
            expect(result.generatedVideoNegativePrompt).toBe('no subtitles')
            expect(result.generatedImagePrompt).toBeUndefined()
            expect(publisherState.error).not.toHaveBeenCalled()
        })

        it('prefers the video call over an image call when both models are enabled and both calls are emitted', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                [],
                {
                    id: 'msg_5',
                    content: [
                        { type: 'tool_use', id: 'tool_3', name: 'generate_image', input: { prompt: 'image prompt' } },
                        { type: 'tool_use', id: 'tool_4', name: 'generate_video', input: { prompt: 'video prompt' } },
                    ],
                    usage: { input_tokens: 5, output_tokens: 5 },
                },
            ))

            const result = await (provider as any).streamImpl(makeState({
                imageModelVersion: 'gpt-image-2',
                imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-2', modelVersion: 'gpt-image-2' },
                imageProviderName: 'OpenAI',
                videoModelVersion: 'veo-3.1',
                videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1-generate-preview', modelVersion: 'veo-3.1' },
                videoProviderName: 'Google',
            }))

            expect(result.generatedVideoPrompt).toBe('video prompt')
            expect(result.generatedImagePrompt).toBeUndefined()
        })

        it('does not force a specific tool when both image and video models are enabled', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            setProviderPublishers(provider)

            anthropicMocks.stream.mockReturnValueOnce(makeAnthropicStream(
                ['no tool call here'],
                { id: 'msg_6', content: [{ type: 'text', text: 'no tool call here' }], usage: { input_tokens: 1, output_tokens: 1 } },
            ))

            await (provider as any).streamImpl(makeState({
                imageModelVersion: 'gpt-image-2',
                imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-2', modelVersion: 'gpt-image-2' },
                imageProviderName: 'OpenAI',
                videoModelVersion: 'veo-3.1',
                videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1-generate-preview', modelVersion: 'veo-3.1' },
                videoProviderName: 'Google',
            }))

            const streamArgs = anthropicMocks.stream.mock.calls[0]?.[0]
            expect(streamArgs.tool_choice).toBeUndefined()
        })
    })

    // ===== error handling =====
    describe('streamImpl — error handling', () => {
        it('captures a stream failure, publishes it, and does not throw', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            const publisherState = setProviderPublishers(provider)

            anthropicMocks.stream.mockImplementationOnce(() => {
                throw new Error('Anthropic API unreachable')
            })

            const result = await (provider as any).streamImpl(makeState())

            expect(result.error).toBe('Anthropic API unreachable')
            expect(publisherState.error).toHaveBeenCalledWith('Anthropic API unreachable')
            expect(publisherState.end).toHaveBeenCalledTimes(1)
            expect(debugTools.err).toHaveBeenCalled()
        })

        it('rejects unsupported message input kinds before any request is sent', async () => {
            const provider = new AnthropicProvider('ws-1:thread-1:reasoning', makeDeps())
            setProviderPublishers(provider)

            await expect((provider as any).streamImpl(makeState({
                aiModelMetaInfo: {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    inferenceCapabilities: undefined,
                },
            }))).rejects.toThrow('MODEL_INFERENCE_CAPABILITIES_REQUIRED')
            expect(anthropicMocks.stream).not.toHaveBeenCalled()
        })
    })
})
