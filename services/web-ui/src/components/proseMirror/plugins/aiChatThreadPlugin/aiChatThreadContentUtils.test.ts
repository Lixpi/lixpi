'use strict'

import { describe, expect, it } from 'vitest'

import {
    getGeneratedImageTurnInfoFromThreadContent,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadContentUtils.ts'
import type { ImageGenerationTrace } from '@lixpi/constants'

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
        expect(turnInfo?.imageGenerationPromptText).toBe('Prompt written in the response.')
    })
})
