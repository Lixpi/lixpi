'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    parseProseMirrorJsonContent,
    collectProseMirrorText,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    collectResponseTextById,
    buildGeneratedMediaTurnProjectionFromThreadContent,
    getGeneratedImageTurnInfoFromThreadContent,
} from '@lixpi/prosemirror/shared/generated-media-turn-projection'
import type {
    ImageGenerationTrace,
    VideoGenerationTrace,
} from '@lixpi/constants'

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

describe('parseProseMirrorJsonContent', () => {
    it('parses valid JSON strings into ProseMirror JSON objects', () => {
        const content = parseProseMirrorJsonContent('{"type":"doc","content":[{"type":"text","text":"hello"}]}')

        expect(content).toEqual({
            type: 'doc',
            content: [{ type: 'text', text: 'hello' }],
        })
    })

    it('returns null for malformed JSON or unsupported input shapes', () => {
        expect(parseProseMirrorJsonContent('{not valid json}')).toBeNull()
        expect(parseProseMirrorJsonContent(123)).toBeNull()
        expect(parseProseMirrorJsonContent(null)).toBeNull()
    })
})

describe('collectProseMirrorText', () => {
    it('concatenates nested text and preserves hard-break markers', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'First line' },
                        { type: 'hard_break' },
                        { type: 'text', text: 'Second line' },
                        { type: 'text', text: 'No space' },
                    ],
                },
            ],
        }

        expect(collectProseMirrorText(content)).toBe('First line\nSecond lineNo space')
    })

    it('uses revised prompt for generated image nodes and respects excluded node types', () => {
        const imageNode = {
            type: 'aiGeneratedImage',
            attrs: { revisedPrompt: 'Image brief' },
            content: [{ type: 'text', text: 'Should be ignored' }],
        }
        const plainTextNode = { type: 'text', text: 'Keep me' }

        expect(collectProseMirrorText({
            type: 'doc',
            content: [imageNode, plainTextNode],
        } as any)).toBe('Image briefKeep me')

        expect(collectProseMirrorText({
            type: 'doc',
            content: [imageNode, plainTextNode],
        } as any, { excludedNodeTypes: ['aiGeneratedImage'] })).toBe('Keep me')
    })
})

describe('collectResponseTextById', () => {
    it('maps each response id to the preceding user text and response content', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First prompt' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First answer' }] }],
                        },
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second prompt' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-2' },
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second answer' }] }],
                        },
                    ],
                },
            ],
        }

        const responseTextById = collectResponseTextById(content)
        expect(responseTextById).toEqual({
            'response-1': 'First prompt\nFirst answer',
            'response-2': 'Second prompt\nSecond answer',
        })
    })
})

describe('buildGeneratedMediaTurnProjectionFromThreadContent', () => {
    it('builds a projection from matching locator and strips non-matching media nodes', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prompt from user' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1', aiProvider: 'OpenAI' },
                            content: [
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: 'OpenAI:gpt-4.1', reasoningRunId: 'run-1' },
                                    content: [
                                        {
                                            type: 'aiCollapsibleBlock',
                                            attrs: { imageGenerationTrace: createTrace() },
                                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Generated prompt text' }] }],
                                        },
                                        {
                                            type: 'aiGeneratedImage',
                                            attrs: { mediaRunId: 'run-1', mediaType: 'image', fileId: 'file-1' },
                                        },
                                        {
                                            type: 'aiGeneratedImage',
                                            attrs: { mediaRunId: 'run-2', mediaType: 'image', fileId: 'file-2' },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(content, {
            responseMessageId: 'response-1',
            mediaRunId: 'run-2',
        }, {
            limitToLocatorMedia: true,
            forceGenerationDetailsOpen: true,
            lineageProjectionScope: 'media-run',
        })

        expect(projection).not.toBeNull()
        expect(projection?.source).toBe('thread-content')
        expect(projection?.threadId).toBe('thread-1')

        // projection.content is the doc node; its only child is the aiChatThread
        // node (index 0), whose content is [userMessage, responseMessage].
        const responseMessage = projection?.content?.content?.[0]?.content?.[1]
        const projectionImageRunIds = (responseMessage?.content?.[0]?.content ?? [])
            .filter((node: any) => node?.type === 'aiGeneratedImage')
            .map((node: any) => node?.attrs?.mediaRunId)
        expect(projectionImageRunIds).toEqual(['run-2'])
    })

    it('falls back to latest matching response when no locator response id is specified', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-3' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only prompt' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-2' },
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Fallback answer' }] },
                                { type: 'aiGeneratedImage', attrs: { mediaRunId: 'latest-media' } },
                            ],
                        },
                    ],
                },
            ],
        }

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(content, {})

        expect(projection).toBeNull()
    })

    it('returns null when parsing fails', () => {
        const projection = buildGeneratedMediaTurnProjectionFromThreadContent('not-json', {})

        expect(projection).toBeNull()
    })
})

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

    it('prefers reasoningRunId over reasoningModelId when the same model appears twice', () => {
        const firstTrace = { ...createTrace(), toolPrompt: 'First run prompt' }
        const secondTrace = { ...createTrace(), toolPrompt: 'Second run prompt' }
        const sharedModelId = 'Google:gemini-flash-latest'
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'make two variants' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: sharedModelId, reasoningRunId: 'run-first' },
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'First run reply.' }] },
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: firstTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First run prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'first thumb', mediaRunId: 'media-first' } },
                                    ],
                                },
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: sharedModelId, reasoningRunId: 'run-second' },
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'Second run reply.' }] },
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: secondTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second run prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'second thumb', mediaRunId: 'media-second' } },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }

        const turnInfo = getGeneratedImageTurnInfoFromThreadContent(content, {
            responseMessageId: 'response-1',
            reasoningModelId: sharedModelId,
            reasoningRunId: 'run-second',
        })

        expect(turnInfo?.imageGenerationTrace).toBe(secondTrace)
        expect(turnInfo?.imageGenerationPromptText).toBe('Second run prompt text.')
        expect(turnInfo?.responseText).toBe('Second run reply.')
    })

    it('uses mediaRunId to resolve the exact section when run metadata only exists on the media node', () => {
        const firstTrace = { ...createTrace(), toolPrompt: 'First media prompt' }
        const secondTrace = { ...createTrace(), toolPrompt: 'Second media prompt' }
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'render both images' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: 'Anthropic:claude-sonnet-4-6' },
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'Claude media reply.' }] },
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: firstTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First media prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'first thumb', mediaRunId: 'media-first' } },
                                    ],
                                },
                                {
                                    type: 'aiReasoningSection',
                                    attrs: { reasoningModelId: 'Google:gemini-flash-latest' },
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'Gemini media reply.' }] },
                                        { type: 'aiCollapsibleBlock', attrs: { imageGenerationTrace: secondTrace }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second media prompt text.' }] }] },
                                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'second thumb', mediaRunId: 'media-second' } },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }

        const turnInfo = getGeneratedImageTurnInfoFromThreadContent(content, {
            responseMessageId: 'response-1',
            mediaRunId: 'media-second',
        })

        expect(turnInfo?.imageGenerationTrace).toBe(secondTrace)
        expect(turnInfo?.imageGenerationPromptText).toBe('Second media prompt text.')
        expect(turnInfo?.responseText).toBe('Gemini media reply.')
    })
})

describe('buildGeneratedMediaTurnProjectionFromThreadContent — projection filtering and metadata edge cases', () => {
    it('can override threadId from options when source metadata has no threadId', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prompt one' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Answer one' }] }],
                        },
                    ],
                },
            ],
        }

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(
            content,
            { responseMessageId: 'response-1' },
            { threadId: 'thread-override' },
        )

        expect(projection?.threadId).toBe('thread-override')
    })

    it('returns null when no threadId can be resolved', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prompt one' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1' },
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Answer one' }] }],
                        },
                    ],
                },
            ],
        }

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(content, { responseMessageId: 'response-1' })
        expect(projection).toBeNull()
    })

    it('filters media nodes to a specific assetId when limitToLocatorMedia is enabled', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Generate two files' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1', aiProvider: 'OpenAI' },
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Here are both images.' }] },
                                {
                                    type: 'aiCollapsibleBlock',
                                    attrs: {
                                        imageGenerationTrace: createTrace(),
                                    },
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Trace prompt.' }] }],
                                },
                                { type: 'aiGeneratedImage', attrs: { assetId: 'file-a', mediaType: 'image', mediaRunId: 'run-a' } },
                                { type: 'aiGeneratedImage', attrs: { assetId: 'file-b', mediaType: 'image', mediaRunId: 'run-b' } },
                            ],
                        },
                    ],
                },
            ],
        }

        const allMediaProjection = buildGeneratedMediaTurnProjectionFromThreadContent(
            content,
            { responseMessageId: 'response-1' },
            { limitToLocatorMedia: false },
        )
        const filteredProjection = buildGeneratedMediaTurnProjectionFromThreadContent(
            content,
            { responseMessageId: 'response-1', assetId: 'file-b', mediaType: 'image' },
            { limitToLocatorMedia: true },
        )

        const collectMediaFileIds = (root: any) => {
            const files: any[] = []
            function walk(node: any) {
                if (node?.type === 'aiGeneratedImage' || node?.type === 'aiGeneratedVideo') {
                    files.push(node.attrs?.assetId)
                    return
                }
                ;(node?.content ?? []).forEach((child: any) => walk(child))
            }
            walk(root)
            return files
        }

        expect(collectMediaFileIds(allMediaProjection?.content)).toHaveLength(2)
        expect(collectMediaFileIds(filteredProjection?.content)).toEqual(['file-b'])
    })
})

describe('getGeneratedImageTurnInfoFromThreadContent — locator edge cases', () => {
    it('resolves media by assetId and variantIndex', () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-1' },
                    content: [
                        {
                            type: 'aiUserMessage',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create multiple variants' }] }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: { id: 'response-1', aiProvider: 'OpenAI' },
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Candidate text.' }] },
                                {
                                    type: 'aiCollapsibleBlock',
                                    attrs: {
                                        imageGenerationTrace: createTrace(),
                                    },
                                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Seed prompt one.' }] }],
                                },
                                { type: 'aiGeneratedImage', attrs: { assetId: 'file-a', variantIndex: 1, mediaType: 'image', mediaRunId: 'run-a', revisedPrompt: 'variant one' } },
                                { type: 'aiGeneratedImage', attrs: { assetId: 'file-a', variantIndex: 2, mediaType: 'image', mediaRunId: 'run-b', revisedPrompt: 'variant two' } },
                            ],
                        },
                    ],
                },
            ],
        }

        const exactMatch = getGeneratedImageTurnInfoFromThreadContent(content, {
            responseMessageId: 'response-1',
            assetId: 'file-a',
            variantIndex: '2',
        })

        const noMatch = getGeneratedImageTurnInfoFromThreadContent(content, {
            responseMessageId: 'response-1',
            assetId: 'file-a',
            variantIndex: '9',
        })

        expect(exactMatch?.imageGenerationTrace).toBeTruthy()
        expect(exactMatch?.responseText).toBe('Candidate text.')
        expect(exactMatch?.userPromptText).toBe('Create multiple variants')
        expect(noMatch).toBeNull()
    })
})
