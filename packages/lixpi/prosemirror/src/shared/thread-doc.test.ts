import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    collectProseMirrorText,
    collectProseMirrorPromptReferences,
    findAiChatThreadContentNode,
    findBranchMarkerResponseSection,
    getBranchMarkerConversationPreviewFromThreadContent,
    getBranchMarkerTurnMessages,
    getLatestThreadTurnMessages,
    parseProseMirrorJsonContent,
    type ProseMirrorJsonNode,
} from './thread-doc.ts'

function text(value: string): ProseMirrorJsonNode {
    return { type: 'paragraph', content: [{ type: 'text', text: value }] }
}

function userMessage(value: string): ProseMirrorJsonNode {
    return { type: 'aiUserMessage', content: [text(value)] }
}

function responseMessage(attrs: Record<string, any>, sections: ProseMirrorJsonNode[] = [], body: ProseMirrorJsonNode[] = []): ProseMirrorJsonNode {
    return { type: 'aiResponseMessage', attrs, content: [...sections, ...body] }
}

function reasoningSection(attrs: Record<string, any>, value: string): ProseMirrorJsonNode {
    return { type: 'aiReasoningSection', attrs, content: [text(value)] }
}

const threadDoc: ProseMirrorJsonNode = {
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'thread-1' },
        content: [
            userMessage('draw a watercolor'),
            responseMessage(
                { id: 'resp-1', generationRequestId: 'req-1' },
                [reasoningSection({ reasoningRunId: 'run-1', generationRequestId: 'req-1' }, 'watercolor response')],
            ),
            userMessage('create an oil painting'),
            responseMessage(
                { id: 'resp-2', generationRequestId: 'req-2' },
                [reasoningSection({ reasoningRunId: 'run-2', generationRequestId: 'req-2' }, 'oil painting response')],
            ),
        ],
    }],
}

describe('findAiChatThreadContentNode', () => {
    it('finds the thread node by id', () => {
        const thread = findAiChatThreadContentNode(threadDoc, 'thread-1')
        expect(thread?.attrs?.threadId).toBe('thread-1')
        expect(findAiChatThreadContentNode(threadDoc, 'missing')).toBeNull()
    })
})

describe('getBranchMarkerTurnMessages', () => {
    const threadNode = findAiChatThreadContentNode(threadDoc, 'thread-1')!

    it('pairs a marker with its own turn by generationRequestId, not the latest turn', () => {
        const turn = getBranchMarkerTurnMessages(threadNode, { generationRequestId: 'req-1' })
        expect(collectProseMirrorText(turn?.userMessage ?? undefined).trim()).toBe('draw a watercolor')
        expect(turn?.responseMessage.attrs?.id).toBe('resp-1')
    })

    it('pairs by exact section locator when the response message lacks the request id', () => {
        const turn = getBranchMarkerTurnMessages(threadNode, { reasoningRunId: 'run-1' })
        expect(turn?.responseMessage.attrs?.id).toBe('resp-1')
    })

    it('returns null for a turn that is not in the document yet (preflight)', () => {
        expect(getBranchMarkerTurnMessages(threadNode, { generationRequestId: 'req-preflight' })).toBeNull()
    })

    it('never matches a sectionless response as a fallback container', () => {
        const sectionlessThread: ProseMirrorJsonNode = {
            type: 'aiChatThread',
            attrs: { threadId: 'thread-2' },
            content: [
                userMessage('first'),
                responseMessage({ id: 'resp-a' }, [], [text('sectionless body')]),
            ],
        }
        expect(getBranchMarkerTurnMessages(sectionlessThread, { reasoningRunId: 'run-x' })).toBeNull()
    })

    it('prefers the newest matching turn when a locator matches multiple turns', () => {
        const duplicatedThread: ProseMirrorJsonNode = {
            type: 'aiChatThread',
            attrs: { threadId: 'thread-3' },
            content: [
                userMessage('first'),
                responseMessage({ id: 'resp-a' }, [reasoningSection({ reasoningModelId: 'ModelA' }, 'a')]),
                userMessage('second'),
                responseMessage({ id: 'resp-b' }, [reasoningSection({ reasoningModelId: 'ModelA' }, 'b')]),
            ],
        }
        const turn = getBranchMarkerTurnMessages(duplicatedThread, { reasoningModelId: 'ModelA' })
        expect(turn?.responseMessage.attrs?.id).toBe('resp-b')
    })
})

describe('findBranchMarkerResponseSection', () => {
    const response = responseMessage(
        { id: 'resp-1' },
        [
            reasoningSection({ reasoningRunId: 'run-1', reasoningModelId: 'ModelA', reasoningIndex: 0, branchForkNodeId: 'fork-1' }, 'a'),
            reasoningSection({ reasoningRunId: 'run-2', reasoningModelId: 'ModelA', reasoningIndex: 1 }, 'b'),
        ],
    )

    it('matches by reasoningRunId first', () => {
        expect(findBranchMarkerResponseSection(response, { reasoningRunId: 'run-2' })?.attrs?.reasoningRunId).toBe('run-2')
    })

    it('matches by marker node attr', () => {
        const section = findBranchMarkerResponseSection(response, { markerNodeId: 'fork-1', markerNodeAttr: 'branchForkNodeId' })
        expect(section?.attrs?.reasoningRunId).toBe('run-1')
    })

    it('disambiguates same model by reasoningIndex', () => {
        const section = findBranchMarkerResponseSection(response, { reasoningModelId: 'modela', reasoningIndex: 1 })
        expect(section?.attrs?.reasoningRunId).toBe('run-2')
    })

    it('returns null instead of a whole-node fallback when nothing matches', () => {
        expect(findBranchMarkerResponseSection(response, { reasoningRunId: 'run-404' })).toBeNull()
        expect(findBranchMarkerResponseSection(responseMessage({ id: 'no-sections' }), { reasoningRunId: 'run-1' })).toBeNull()
    })
})

describe('getBranchMarkerConversationPreviewFromThreadContent', () => {
    function previewFor(sectionContent: ProseMirrorJsonNode[]): ReturnType<typeof getBranchMarkerConversationPreviewFromThreadContent> {
        return getBranchMarkerConversationPreviewFromThreadContent(
            {
                type: 'doc',
                content: [{
                    type: 'aiChatThread',
                    attrs: { threadId: 'thread-preview' },
                    content: [
                        userMessage('create a character design sheet'),
                        responseMessage(
                            { generationRequestId: 'request-preview' },
                            [{
                                type: 'aiReasoningSection',
                                attrs: {
                                    generationRequestId: 'request-preview',
                                    reasoningRunId: 'request-preview:reasoning:0',
                                },
                                content: sectionContent,
                            }],
                        ),
                    ],
                }],
            },
            'thread-preview',
            {
                generationRequestId: 'request-preview',
                reasoningRunId: 'request-preview:reasoning:0',
            },
        )
    }

    it('keeps a reasoning response when the model emits only a collapsible block', () => {
        const preview = previewFor([{
            type: 'aiCollapsibleBlock',
            attrs: { isStreaming: false },
            content: [text('Use the reference image to create a consistent character sheet.')],
        }])

        expect(preview?.responseText).toBe('Use the reference image to create a consistent character sheet.')
        expect(preview?.phase).toBe('done')
    })

    it('keeps collapsible-only reasoning visible while that block is still streaming', () => {
        const preview = previewFor([{
            type: 'aiCollapsibleBlock',
            attrs: { isStreaming: true },
            content: [text('Building the generation prompt from the reference.')],
        }])

        expect(preview?.responseText).toBe('Building the generation prompt from the reference.')
        expect(preview?.phase).toBe('enhancement')
        expect(preview?.isReceiving).toBe(true)
        expect(preview?.streamIsReceiving).toBe(true)
    })

    it('prefers the conversational response over collapsible generation details', () => {
        const preview = previewFor([
            text('I will create that character sheet.'),
            {
                type: 'aiCollapsibleBlock',
                attrs: { isStreaming: false },
                content: [text('Long generated prompt details.')],
            },
        ])

        expect(preview?.responseText).toBe('I will create that character sheet.')
    })

    it('does not mistake generated media metadata for a reasoning response', () => {
        const preview = previewFor([{
            type: 'aiGeneratedImage',
            attrs: { revisedPrompt: 'Internal generated image prompt.' },
        }])

        expect(preview?.responseText).toBe('')
    })

    it('keeps the submitted Capability badge metadata paired with the marker turn', () => {
        const content: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread-capability' },
                content: [{
                    type: 'aiUserMessage',
                    content: [{
                        type: 'paragraph',
                        content: [
                            {
                                type: 'prompt_reference',
                                attrs: {
                                    referenceType: 'capability-module',
                                    moduleId: 'action-timeline',
                                    displayName: 'Action Timeline',
                                },
                            },
                            { type: 'text', text: ' Create 15 seconds with 2-second segments.' },
                        ],
                    }],
                }],
            }],
        }

        const preview = getBranchMarkerConversationPreviewFromThreadContent(
            content,
            'thread-capability',
            { generationRequestId: 'pending-request' },
            { generationActive: true },
        )

        expect(preview?.userText).toBe('Create 15 seconds with 2-second segments.')
        expect(
            preview?.userMessage.content?.[0]?.content?.map((node) => (
                node.type === 'prompt_reference' ? node.attrs?.displayName : node.text
            )),
        ).toEqual(['Action Timeline', ' Create 15 seconds with 2-second segments.'])
        expect(preview?.promptReferences).toEqual([{
            referenceType: 'capability-module',
            moduleId: 'action-timeline',
            displayName: 'Action Timeline',
        }])
        expect(collectProseMirrorPromptReferences(content)).toEqual(preview?.promptReferences)
    })
})

describe('getLatestThreadTurnMessages', () => {
    it('returns the last user and response messages', () => {
        const threadNode = findAiChatThreadContentNode(threadDoc, 'thread-1')!
        const { userMessage: latestUser, responseMessage: latestResponse } = getLatestThreadTurnMessages(threadNode)
        expect(collectProseMirrorText(latestUser ?? undefined).trim()).toBe('create an oil painting')
        expect(latestResponse?.attrs?.id).toBe('resp-2')
    })

    it('does not pair a user-only latest turn with the previous turn response', () => {
        const threadNode: ProseMirrorJsonNode = {
            type: 'aiChatThread',
            attrs: { threadId: 'thread-capability' },
            content: [
                {
                    type: 'aiUserMessage',
                    content: [text('Previous request')],
                },
                responseMessage({ id: 'resp-previous' }, [], [text('Previous response')]),
                {
                    type: 'aiUserMessage',
                    content: [text('Create an Action Timeline')],
                },
            ],
        }

        const latestTurn = getLatestThreadTurnMessages(threadNode)

        expect(collectProseMirrorText(latestTurn.userMessage ?? undefined).trim()).toBe('Create an Action Timeline')
        expect(latestTurn.responseMessage).toBeNull()
    })
})

describe('parseProseMirrorJsonContent', () => {
    it('parses strings, passes objects through, rejects garbage', () => {
        expect(parseProseMirrorJsonContent('{"type":"doc"}')).toEqual({ type: 'doc' })
        expect(parseProseMirrorJsonContent({ type: 'doc' })).toEqual({ type: 'doc' })
        expect(parseProseMirrorJsonContent('not json')).toBeNull()
        expect(parseProseMirrorJsonContent(null)).toBeNull()
    })
})
