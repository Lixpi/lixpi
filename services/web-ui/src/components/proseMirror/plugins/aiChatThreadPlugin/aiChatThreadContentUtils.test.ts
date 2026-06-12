'use strict'

import { describe, expect, it } from 'vitest'

import {
    getGeneratedImageTurnInfoFromThreadContent,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadContentUtils.ts'
import type { ImageGenerationTrace, VideoGenerationTrace } from '@lixpi/constants'

function createTrace(): ImageGenerationTrace {
    return {
        traceVersion: 'image-generation-trace-v1',
        chatModelProvider: 'Anthropic',
        chatModelId: 'claude-sonnet-4-6',
        imageModelProvider: 'OpenAI',
        imageModelId: 'gpt-image-1.5',
        imageSize: '1024x1024',
        toolPrompt: 'A detailed image prompt.',
        finalPrompt: 'A detailed image prompt with selected references.',
        promptWasChanged: true,
        referenceImages: [],
        excludedReferences: [],
    }
}

describe('aiChatThreadContentUtils', () => {
    it('extracts the user prompt, response text, and trace for a generated image response', () => {
        const trace = createTrace()
        const content = {
            type: 'doc',
            content: [
                { type: 'documentTitle', content: [{ type: 'text', text: 'Thread' }] },
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'make the scene cinematic' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1', aiProvider: 'Anthropic' },
                            content: [
                                {
                                    type: 'aiCollapsibleBlock',
                                    attrs: { imageGenerationTrace: trace },
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prompt written in the response.' }] }],
                                },
                                { type: 'paragraph', content: [{ type: 'text', text: 'Generated it.' }] },
                                { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'thumbnail prompt' } },
                            ],
                        },
                    ],
                },
            ],
        }

        const turnInfo = getGeneratedImageTurnInfoFromThreadContent(content, 'response-1')

        expect(turnInfo?.userPromptText).toBe('make the scene cinematic')
        expect(turnInfo?.responseText).toBe('Generated it.')
        expect(turnInfo?.responseProvider).toBe('Anthropic')
        expect(turnInfo?.imageGenerationTrace).toBe(trace)
        expect(turnInfo?.videoGenerationTrace).toBe(null)
        expect(turnInfo?.imageGenerationPromptText).toBe('Prompt written in the response.')
    })

    it('extracts the video generation trace from the response collapsible', () => {
        const videoTrace: VideoGenerationTrace = {
            traceVersion: 'video-generation-trace-v1',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.0-generate-001',
            aspectRatio: '16:9',
            resolution: '1080p',
            durationSeconds: 6,
            toolPrompt: 'A cinematic seaside clip.',
            finalPrompt: 'A cinematic seaside clip.',
            promptWasChanged: false,
            referenceImages: [],
            excludedReferences: [],
        }
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'animate the seaside' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-2', aiProvider: 'Google' },
                            content: [
                                {
                                    type: 'aiCollapsibleBlock',
                                    attrs: { videoGenerationTrace: videoTrace },
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Video prompt text.' }] }],
                                },
                                { type: 'paragraph', content: [{ type: 'text', text: 'Generated the clip.' }] },
                            ],
                        },
                    ],
                },
            ],
        }

        const turnInfo = getGeneratedImageTurnInfoFromThreadContent(content, 'response-2')

        expect(turnInfo?.videoGenerationTrace).toBe(videoTrace)
        expect(turnInfo?.imageGenerationTrace).toBe(null)
        expect(turnInfo?.imageGenerationPromptText).toBe('Video prompt text.')
    })

    it('resolves each model to its own section in a multi-model response (no history mixing)', () => {
        const claudeTrace = { ...createTrace(), toolPrompt: 'Claude prompt' }
        const geminiTrace = { ...createTrace(), imageModelId: 'gemini-2.5-flash-image', toolPrompt: 'Gemini prompt' }
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'swap the characters' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: 'Anthropic:claude-sonnet-4-6', reasoningRunId: 'run-0' },
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'Claude reply.' }] },
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: claudeTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claude prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'claude thumb' } },
                                    ],
                                },
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: 'Google:gemini-flash-latest', reasoningRunId: 'run-1' },
                                    content: [
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: geminiTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gemini prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'gemini thumb' } },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }

        const claudeInfo = getGeneratedImageTurnInfoFromThreadContent(content, 'response-1', 'Anthropic:claude-sonnet-4-6')
        expect(claudeInfo?.imageGenerationTrace).toBe(claudeTrace)
        expect(claudeInfo?.imageGenerationPromptText).toBe('Claude prompt text.')
        expect(claudeInfo?.responseText).toBe('Claude reply.')

        const geminiInfo = getGeneratedImageTurnInfoFromThreadContent(content, 'response-1', 'Google:gemini-flash-latest')
        expect(geminiInfo?.imageGenerationTrace).toBe(geminiTrace)
        expect(geminiInfo?.imageGenerationPromptText).toBe('Gemini prompt text.')
        // The Gemini section has no reply text; it must NOT borrow Claude's.
        expect(geminiInfo?.responseText).toBe('')
    })
})
