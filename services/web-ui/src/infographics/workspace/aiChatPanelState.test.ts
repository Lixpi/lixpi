import { describe, expect, it } from 'vitest'
import type { CanvasAiChatPanelState, CanvasNode, CanvasState } from '@lixpi/constants'
import {
    createDefaultAiChatPanelState,
    getAiChatPanelState,
    sanitizeContextChips,
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
    it('starts closed with an empty chip tray and no tabs', () => {
        expect(createDefaultAiChatPanelState()).toEqual({
            isOpen: false,
            isSessionHistoryOpen: false,
            tabs: [],
            contextChips: [],
        })
    })

    it('does not migrate legacy tab fields into the panel state', () => {
        const state = getAiChatPanelState(makeCanvasState({
            lastActiveAiChatThreadId: 'thread-1',
            aiChatSidebarTabs: [{ tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'AI Chat' }],
            activeAiChatSidebarTabId: 'thread:thread-1',
        }))

        expect(state.isOpen).toBe(false)
        expect(state.tabs).toEqual([])
        expect(state.activeTabId).toBeUndefined()
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

    it('persists context chips across a set/get round-trip', () => {
        const nodes = [makeNode('image-a', 'image'), makeNode('document-b', 'document')]
        const persisted = setAiChatPanelState(makeCanvasState({ nodes }), {
            ...createDefaultAiChatPanelState(),
            contextChips: ['image-a', 'document-b'],
        })

        expect(getAiChatPanelState(persisted).contextChips).toEqual(['image-a', 'document-b'])
    })

    it('drops chips for deleted nodes and de-duplicates on read', () => {
        const nodes = [makeNode('image-a', 'image'), makeNode('thread-c', 'aiChatThread')]
        const state = getAiChatPanelState(makeCanvasState({
            nodes,
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                contextChips: ['image-a', 'image-a', 'thread-c', 'deleted-node', ''],
            },
        }))

        expect(state.contextChips).toEqual(['image-a', 'thread-c'])
    })

    it('sanitizeContextChips filters blanks, duplicates, and unknown nodes', () => {
        const nodes = [makeNode('a', 'image'), makeNode('b', 'document')]
        expect(sanitizeContextChips(['a', 'a', '', 'b', 'ghost'], nodes)).toEqual(['a', 'b'])
        expect(sanitizeContextChips(undefined, nodes)).toEqual([])
    })
})
