import { describe, expect, it } from 'vitest'
import type { AiChatThread, CanvasState } from '@lixpi/constants'
import {
    hasCurrentWorkspaceThread,
    shouldAcceptGeneratedMediaEvent,
} from './generatedMediaEventWorkspaceGuard.ts'

function makeCanvasState(overrides: Partial<CanvasState> = {}): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        ...overrides,
    } as CanvasState
}

function makeThread(threadId: string): Pick<AiChatThread, 'threadId'> {
    return { threadId }
}

// =============================================================================
// GENERATED MEDIA EVENT WORKSPACE GUARD
// =============================================================================

describe('generated media event workspace guard', () => {
    it('accepts a thread loaded in the current workspace thread list', () => {
        expect(hasCurrentWorkspaceThread({
            threadId: 'thread-current',
            currentCanvasState: makeCanvasState(),
            currentAiChatThreads: [makeThread('thread-current')],
            workspaceId: 'workspace-1',
        })).toBe(true)
    })

    it('accepts a thread opened in the persisted AI chat panel tabs', () => {
        expect(hasCurrentWorkspaceThread({
            threadId: 'thread-tab',
            currentCanvasState: makeCanvasState({
                aiChatPanel: {
                    isOpen: true,
                    isSessionHistoryOpen: false,
                    tabs: [{ tabId: 'tab-1', type: 'thread', refId: 'thread-tab', title: 'Thread' }],
                    contextChips: [],
                },
            }),
            currentAiChatThreads: [],
            workspaceId: 'workspace-1',
        })).toBe(true)
    })

    it('accepts legacy canvas thread nodes', () => {
        expect(hasCurrentWorkspaceThread({
            threadId: 'legacy-thread',
            currentCanvasState: makeCanvasState({
                nodes: [{
                    nodeId: 'node-legacy-thread',
                    type: 'aiChatThread',
                    referenceId: 'legacy-thread',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 300, height: 200 },
                } as any],
            }),
            currentAiChatThreads: [],
            workspaceId: 'workspace-1',
        })).toBe(true)
    })

    it('rejects an event from another workspace even when the thread id is known locally', () => {
        expect(shouldAcceptGeneratedMediaEvent({
            threadId: 'thread-current',
            eventWorkspaceId: 'workspace-2',
            workspaceId: 'workspace-1',
            currentCanvasState: makeCanvasState(),
            currentAiChatThreads: [makeThread('thread-current')],
        })).toBe(false)
    })

    it('rejects a matching workspace event when the thread is not part of the current workspace', () => {
        expect(shouldAcceptGeneratedMediaEvent({
            threadId: 'thread-stale',
            eventWorkspaceId: 'workspace-1',
            workspaceId: 'workspace-1',
            currentCanvasState: makeCanvasState(),
            currentAiChatThreads: [makeThread('thread-current')],
        })).toBe(false)
    })

    it('accepts events without an explicit workspace id only for current workspace threads', () => {
        expect(shouldAcceptGeneratedMediaEvent({
            threadId: 'thread-current',
            workspaceId: 'workspace-1',
            currentCanvasState: makeCanvasState(),
            currentAiChatThreads: [makeThread('thread-current')],
        })).toBe(true)
    })
})
