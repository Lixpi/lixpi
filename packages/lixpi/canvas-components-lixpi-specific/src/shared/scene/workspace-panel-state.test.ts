import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CanvasAiChatPanelState,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    createDefaultAiChatPanelState,
    getAiChatPanelState,
    sanitizeContextChips,
    setAiChatPanelState,
} from './workspace-panel-state.ts'

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
    it('starts closed with an empty chip tray and no generated-output target', () => {
        expect(createDefaultAiChatPanelState()).toEqual({
            isOpen: false,
            topLevelMode: 'aiThreads',
            contextChips: [],
        })
    })

    it('does not migrate legacy tab and session-history fields into the panel state', () => {
        const state = getAiChatPanelState(makeCanvasState({
            lastActiveAiChatThreadId: 'thread-1',
            aiChatSidebarTabs: [{ tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'AI Chat' }],
            activeAiChatSidebarTabId: 'thread:thread-1',
            aiChatPanel: {
                ...createDefaultAiChatPanelState(),
                tabs: [{ tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'AI Chat' }],
                activeTabId: 'thread:thread-1',
                isSessionHistoryOpen: true,
            } as CanvasAiChatPanelState,
        }))

        expect(state.isOpen).toBe(false)
        expect(state).not.toHaveProperty('tabs')
        expect(state).not.toHaveProperty('activeTabId')
        expect(state).not.toHaveProperty('isSessionHistoryOpen')
    })

    it('preserves an open empty panel with no generated-output target', () => {
        const panel: CanvasAiChatPanelState = {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
        }
        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState(), panel))

        expect(state.isOpen).toBe(true)
        expect(state.generatedOutputDetailsTarget).toBeUndefined()
    })

    it('persists the separate Artifacts top-level mode', () => {
        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState(), {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
            topLevelMode: 'artifacts',
        }))

        expect(state.topLevelMode).toBe('artifacts')
    })

    it('persists a valid generated-output target across a set/get round-trip', () => {
        const nodes = [makeNode('image-a', 'image')]
        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState({ nodes }), {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
            generatedOutputDetailsTarget: { kind: 'output', nodeId: 'image-a' },
        }))

        expect(state.generatedOutputDetailsTarget).toEqual({ kind: 'output', nodeId: 'image-a' })
    })

    it('persists a valid branch-marker target', () => {
        const nodes = [makeNode('branch-a', 'branchLine')]
        const state = getAiChatPanelState(setAiChatPanelState(makeCanvasState({ nodes }), {
            ...createDefaultAiChatPanelState(),
            generatedOutputDetailsTarget: { kind: 'branch-marker', nodeId: 'branch-a' },
        }))

        expect(state.generatedOutputDetailsTarget).toEqual({ kind: 'branch-marker', nodeId: 'branch-a' })
    })

    it('drops generated-output targets whose node is missing or has the wrong kind', () => {
        const nodes = [makeNode('document-a', 'document'), makeNode('image-a', 'image')]

        expect(
            getAiChatPanelState(makeCanvasState({
                nodes,
                aiChatPanel: {
                    ...createDefaultAiChatPanelState(),
                    generatedOutputDetailsTarget: { kind: 'output', nodeId: 'document-a' },
                },
            })).generatedOutputDetailsTarget,
        ).toBeUndefined()

        expect(
            getAiChatPanelState(makeCanvasState({
                nodes,
                aiChatPanel: {
                    ...createDefaultAiChatPanelState(),
                    generatedOutputDetailsTarget: { kind: 'branch-marker', nodeId: 'image-a' },
                },
            })).generatedOutputDetailsTarget,
        ).toBeUndefined()
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

    it('setAiChatPanelState removes legacy top-level and nested tab state', () => {
        const legacyCanvasState = makeCanvasState({
            activeAiChatSidebarTabId: 'thread:thread-1',
            aiChatSidebarTabs: [{ tabId: 'thread:thread-1', type: 'thread', refId: 'thread-1', title: 'Thread 1' }],
        })

        const normalized = setAiChatPanelState(legacyCanvasState, {
            ...createDefaultAiChatPanelState(),
            isOpen: true,
            tabs: [{ tabId: 'thread:stale', type: 'thread', refId: 'stale', title: 'Stale' }],
            activeTabId: 'thread:stale',
            isSessionHistoryOpen: true,
        } as CanvasAiChatPanelState)

        expect(normalized.aiChatPanel).toMatchObject({ isOpen: true })
        expect(normalized.aiChatPanel).not.toHaveProperty('activeTabId')
        expect(normalized.aiChatPanel).not.toHaveProperty('tabs')
        expect(normalized.aiChatPanel).not.toHaveProperty('isSessionHistoryOpen')
        expect(normalized.aiChatSidebarTabs).toBeUndefined()
        expect(normalized.activeAiChatSidebarTabId).toBeUndefined()
    })

    it('preserves panel width when persisted width is provided and normalizes zero correctly', () => {
        const persisted = setAiChatPanelState(makeCanvasState(), {
            ...createDefaultAiChatPanelState(),
            width: 0,
        })

        expect(getAiChatPanelState(persisted).width).toBe(0)
    })
})
