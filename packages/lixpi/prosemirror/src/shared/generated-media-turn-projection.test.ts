'use strict'

import { describe, expect, it } from 'vitest'

import {
    buildBranchMarkerTurnProjectionFromThreadContent,
} from './generated-media-turn-projection.ts'
import {
    collectProseMirrorText,
    type ProseMirrorJsonNode,
} from './thread-doc.ts'

function paragraph(text: string): ProseMirrorJsonNode {
    return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function userMessage(text: string): ProseMirrorJsonNode {
    return { type: 'aiUserMessage', content: [paragraph(text)] }
}

function responseMessage(attrs: Record<string, any>, content: ProseMirrorJsonNode[]): ProseMirrorJsonNode {
    return { type: 'aiResponseMessage', attrs, content }
}

function reasoningSection(attrs: Record<string, any>, text: string): ProseMirrorJsonNode {
    return { type: 'aiReasoningSection', attrs, content: [paragraph(text)] }
}

describe('buildBranchMarkerTurnProjectionFromThreadContent', () => {
    it('projects the marker own reasoning response instead of the latest thread response', () => {
        const content: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread-1' },
                content: [
                    userMessage('draw a goat'),
                    responseMessage(
                        { id: 'response-1', generationRequestId: 'request-1' },
                        [reasoningSection({
                            generationRequestId: 'request-1',
                            reasoningRunId: 'reasoning-1',
                            branchForkNodeId: 'fork-1',
                        }, 'First reasoning response that belongs on the branch marker.')],
                    ),
                    userMessage('draw a boat'),
                    responseMessage(
                        { id: 'response-2', generationRequestId: 'request-2' },
                        [reasoningSection({
                            generationRequestId: 'request-2',
                            reasoningRunId: 'reasoning-2',
                            branchForkNodeId: 'fork-2',
                        }, 'Wrong latest response that must not be shown.')],
                    ),
                ],
            }],
        }

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(content, {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            markerNodeId: 'fork-1',
            markerNodeAttr: 'branchForkNodeId',
        }, {
            threadId: 'thread-1',
            forceGenerationDetailsOpen: true,
            lineageProjectionScope: 'branch-fork',
            allowLatestTurnFallback: false,
        })

        const text = collectProseMirrorText(projection?.content).trim()
        expect(text).toContain('draw a goat')
        expect(text).toContain('First reasoning response that belongs on the branch marker.')
        expect(text).not.toContain('draw a boat')
        expect(text).not.toContain('Wrong latest response that must not be shown.')
    })

    it('allows latest-turn fallback only for preflight active markers', () => {
        const content: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread-1' },
                content: [
                    userMessage('draw a goat'),
                    responseMessage(
                        { id: 'response-1', generationRequestId: 'request-1' },
                        [reasoningSection({ generationRequestId: 'request-1' }, 'Live response text.')],
                    ),
                ],
            }],
        }

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(content, {
            generationRequestId: 'request-pending',
            markerNodeId: 'fork-pending',
            markerNodeAttr: 'branchForkNodeId',
        }, {
            threadId: 'thread-1',
            allowLatestTurnFallback: true,
        })

        expect(collectProseMirrorText(projection?.content).trim()).toContain('Live response text.')
    })

    it('preserves the submitted Capability badge at its original inline position', () => {
        const submittedUserMessage: ProseMirrorJsonNode = {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Create ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'capability-module',
                            moduleId: 'action-timeline',
                            displayName: 'Action Timeline',
                        },
                    },
                    { type: 'text', text: ' 15s duration with 2s gaps.' },
                ],
            }],
        }
        const content: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread-1' },
                content: [
                    submittedUserMessage,
                    responseMessage(
                        { id: 'response-1', generationRequestId: 'request-1' },
                        [reasoningSection({
                            generationRequestId: 'request-1',
                            reasoningRunId: 'reasoning-1',
                            branchForkNodeId: 'fork-1',
                        }, 'Building the Action Timeline.')],
                    ),
                ],
            }],
        }

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(content, {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            markerNodeId: 'fork-1',
            markerNodeAttr: 'branchForkNodeId',
        }, {
            threadId: 'thread-1',
            lineageProjectionScope: 'branch-fork',
        })
        const projectedThread = projection?.content.content?.[0]
        const projectedUserMessage = projectedThread?.content?.find((node) => node.type === 'aiUserMessage')

        expect(projectedUserMessage).toEqual(submittedUserMessage)
        expect(projectedUserMessage?.content?.[0]?.content?.map((node) => (
            node.type === 'prompt_reference' ? node.attrs?.displayName : node.text
        ))).toEqual(['Create ', 'Action Timeline', ' 15s duration with 2s gaps.'])
        expect(collectProseMirrorText(projection?.content)).toContain('Building the Action Timeline.')
    })

    it('projects an in-flight Capability turn without leaking the previous response', () => {
        const submittedUserMessage: ProseMirrorJsonNode = {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Create ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'capability-module',
                            moduleId: 'action-timeline',
                            displayName: 'Action Timeline',
                        },
                    },
                    { type: 'text', text: ' 15s duration with 2s gaps.' },
                ],
            }],
        }
        const content: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread-1' },
                content: [
                    userMessage('Previous request'),
                    responseMessage(
                        { id: 'response-previous', generationRequestId: 'request-previous' },
                        [paragraph('Previous response that must not appear.')],
                    ),
                    submittedUserMessage,
                ],
            }],
        }

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(content, {
            generationRequestId: 'request-capability',
            markerNodeId: 'fork-capability',
            markerNodeAttr: 'branchForkNodeId',
        }, {
            threadId: 'thread-1',
            lineageProjectionScope: 'branch-fork',
            allowLatestTurnFallback: true,
        })
        const projectedThread = projection?.content.content?.[0]

        expect(projectedThread?.content).toEqual([submittedUserMessage])
        expect(collectProseMirrorText(projection?.content)).not.toContain('Previous response that must not appear.')
    })
})
