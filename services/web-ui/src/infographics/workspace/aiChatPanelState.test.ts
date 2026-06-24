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

    it('persists only valid tabs and resolves active tab fallback', () => {
        const tabs = [
            { tabId: 'thread:thread-a', type: 'thread' as const, refId: 'thread-a', title: 'Thread A' },
            { tabId: 'bad:thread-b', type: 'bad' as 'thread', refId: 'thread-b', title: 'Bad' },
            { tabId: 'extraction:extraction-a', type: 'extraction', refId: 'extraction-a', title: 'Extraction A' },
            { tabId: 'thread:thread-a', type: 'thread' as const, refId: 'thread-a', title: 'Duplicate' },
            { tabId: 'missing-ref', type: 'thread' as const, refId: '', title: 'Missing' },
            { tabId: 'extraction:extraction-b', type: 'extraction', refId: 'extraction-b', title: 'Extraction B' },
        ]

        const state = getAiChatPanelState(makeCanvasState({
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs,
                activeTabId: 'missing-tab',
            },
            nodes: [makeNode('node-1', 'document')],
        }))

        expect(state.tabs).toEqual([
            { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'Thread A' },
            { tabId: 'extraction:extraction-a', type: 'extraction', refId: 'extraction-a', title: 'Extraction A' },
            { tabId: 'extraction:extraction-b', type: 'extraction', refId: 'extraction-b', title: 'Extraction B' },
        ])
        expect(state.activeTabId).toBe('thread:thread-a')
    })

    it('supports extraction tab ids in persisted panel state', () => {
        const state = getAiChatPanelState(makeCanvasState({
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs: [{ tabId: 'extraction:new', type: 'extraction', refId: 'new', title: 'Extract Feature' }],
            },
        }))

        expect(state.tabs[0]).toEqual({ tabId: 'extraction:new', type: 'extraction', refId: 'new', title: 'Extract Feature' })
        expect(state.activeTabId).toBe('extraction:new')
    })

    it('sanitizeContextChips filters blanks, duplicates, and unknown nodes', () => {
        const nodes = [makeNode('a', 'image'), makeNode('b', 'document')]
        expect(sanitizeContextChips(['a', 'a', '', 'b', 'ghost'], nodes)).toEqual(['a', 'b'])
        expect(sanitizeContextChips(undefined, nodes)).toEqual([])
    })

    it('setAiChatPanelState replaces the legacy active tab id with the normalized active tab', () => {
        const legacyCanvasState = makeCanvasState({
            activeAiChatSidebarTabId: 'extraction:extraction-1',
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs: [
                    { tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'Thread 1' },
                    { tabId: 'extraction:extraction-1', type: 'extraction', refId: 'extraction-1', title: 'Extraction 1' },
                ],
                activeTabId: 'extraction:extraction-1',
            },
        })

        const normalized = setAiChatPanelState(legacyCanvasState, {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
            tabs: [{ tabId: 'thread:thread-2', type: 'thread', refId: 'thread-2', title: 'Thread 2' }],
            activeTabId: 'thread:thread-2',
        })

        expect(normalized.aiChatPanel).toMatchObject({
            isOpen: true,
            activeTabId: 'thread:thread-2',
        })
        expect(normalized.aiChatSidebarTabs).toEqual([
            { tabId: 'thread:thread-2', type: 'thread', refId: 'thread-2', title: 'Thread 2' },
        ])
        expect(normalized.activeAiChatSidebarTabId).toBe('thread:thread-2')
    })

    it('setAiChatPanelState removes stale legacy active tab id when no tab remains active', () => {
        const normalized = setAiChatPanelState(makeCanvasState({
            activeAiChatSidebarTabId: 'thread:stale',
        }), createDefaultAiChatPanelState())

        expect(normalized.aiChatPanel.activeTabId).toBeUndefined()
        expect(normalized.aiChatSidebarTabs).toEqual([])
        expect(normalized.activeAiChatSidebarTabId).toBeUndefined()
    })

    it('preserves panel width when persisted width is provided and normalizes zero correctly', () => {
        const state = makeCanvasState()
        const persisted = setAiChatPanelState(state, {
            ...createDefaultAiChatPanelState(),
            width: 0,
        })

        expect(getAiChatPanelState(persisted).width).toBe(0)
    })

    it('rejects unknown tabs and preserves valid ones in insertion order', () => {
        const state = getAiChatPanelState(makeCanvasState({
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs: [
                    { tabId: '', type: 'thread', refId: 'a', title: 'Blank' },
                    { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'A' },
                    { tabId: 'extraction:extract-a', type: 'extraction', refId: 'extract-a', title: 'Extraction A' },
                    { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'Duplicate' },
                ],
            },
        }))

        expect(state.tabs).toEqual([
            { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'A' },
            { tabId: 'extraction:extract-a', type: 'extraction', refId: 'extract-a', title: 'Extraction A' },
        ])
    })

    it('deduplicates tabs in persisted state and drops unsupported types', () => {
        const state = getAiChatPanelState(makeCanvasState({
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs: [
                    { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'A' },
                    { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'A Duplicate' },
                    { tabId: 'bad:thread-b', type: 'bad' as 'thread', refId: 'thread-b', title: 'Bad' } as any,
                ],
            },
        }))

        expect(state.tabs).toEqual([
            { tabId: 'thread:thread-a', type: 'thread', refId: 'thread-a', title: 'A' },
        ])
    })
})
