'use strict'

import { describe, expect, it } from 'vitest'

import {
    collectProseMirrorText,
    findAiChatThreadContentNode,
    findBranchMarkerResponseSection,
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

describe('getLatestThreadTurnMessages', () => {
    it('returns the last user and response messages', () => {
        const threadNode = findAiChatThreadContentNode(threadDoc, 'thread-1')!
        const { userMessage: latestUser, responseMessage: latestResponse } = getLatestThreadTurnMessages(threadNode)
        expect(collectProseMirrorText(latestUser ?? undefined).trim()).toBe('create an oil painting')
        expect(latestResponse?.attrs?.id).toBe('resp-2')
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
