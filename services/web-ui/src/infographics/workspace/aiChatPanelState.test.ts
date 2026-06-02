import { describe, expect, it } from 'vitest'
import type { CanvasAiChatPanelState, CanvasNode, CanvasState } from '@lixpi/constants'
import {
    createDefaultAiChatPanelState,
    getAiChatPanelState,
    getStandaloneContextNodeIds,
    setAiChatPanelState,
} from '$src/infographics/workspace/aiChatPanelState.ts'

function makeCanvasState(overrides: Partial<CanvasState> = {}): CanvasState {
    return {
        sourceContext: {} as CanvasState['sourceContext'],
        nodes: [],
        edges: [],
        ...overrides,
    }
}

function makeNode(nodeId: string, type: CanvasNode['type']): CanvasNode {
    return {
        nodeId,
        type,
        referenceId: nodeId,
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
    } as CanvasNode
}

describe('AI chat panel persisted state', () => {
    it('starts closed without creating tabs or domain state', () => {
        expect(createDefaultAiChatPanelState()).toEqual({
            isOpen: false,
            isSessionHistoryOpen: false,
            tabs: [],
            contextMode: 'followSelection',
            includeUpstreamContext: false,
            contextNodeIds: [],
        })
    })

    it('migrates a legacy active thread into an open tab', () => {
        const state = getAiChatPanelState(makeCanvasState({ lastActiveAiChatThreadId: 'thread-1' }))

        expect(state.isOpen).toBe(true)
        expect(state.activeTabId).toBe('thread:thread-1')
        expect(state.tabs).toEqual([
            { tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'AI Chat' },
        ])
    })

    it('preserves an open empty panel with no selected tab', () => {
        const panel: CanvasAiChatPanelState = {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
        }
        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState(), panel))

        expect(state.isOpen).toBe(true)
        expect(state.tabs).toEqual([])
        expect(state.activeTabId).toBeUndefined()
    })

    it('keeps session history closed by default and persists an explicit open state', () => {
        expect(getAiChatPanelState(makeCanvasState()).isSessionHistoryOpen).toBe(false)

        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState(), {
            ...createDefaultAiChatPanelState(),
            isSessionHistoryOpen: true,
        }))

        expect(state.isSessionHistoryOpen).toBe(true)
    })

    it('uses live selection in Follow Selection and pinned IDs in Pinned Context', () => {
        const nodes = [
            makeNode('image-a', 'image'),
            makeNode('document-b', 'document'),
            makeNode('thread-c', 'aiChatThread'),
        ]
        const follow = {
            ...createDefaultAiChatPanelState(),
            contextMode: 'followSelection' as const,
        }
        const pinned = {
            ...follow,
            contextMode: 'pinnedContext' as const,
            contextNodeIds: ['document-b', 'thread-c', 'missing'],
        }

        expect(getStandaloneContextNodeIds(follow, ['image-a', 'thread-c'], nodes)).toEqual(['image-a', 'thread-c'])
        expect(getStandaloneContextNodeIds(pinned, ['image-a'], nodes)).toEqual(['document-b', 'thread-c'])
    })
})
