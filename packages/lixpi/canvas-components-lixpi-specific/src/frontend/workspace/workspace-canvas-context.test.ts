// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasAiChatPanelState,
    type CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceCanvasContext,
    type WorkspaceCanvasContextPorts,
} from './workspace-canvas-context.ts'

describe('WorkspaceCanvasContext', () => {
    it('adds only eligible unique canvas nodes and persists removals', () => {
        const canvasState = {
            nodes: [
                { nodeId: 'image-1', type: 'image', assetId: 'asset-1', position: { x: 0, y: 0 }, dimensions: { width: 1, height: 1 } },
                { nodeId: 'branch-1', type: 'branchOrigin', position: { x: 0, y: 0 }, dimensions: { width: 1, height: 1 } },
            ],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
        } as CanvasState
        let panelState = { isOpen: false, topLevelMode: 'aiThreads', contextChips: [] } as CanvasAiChatPanelState
        const persistPanelState = vi.fn((state: CanvasAiChatPanelState) => {
            panelState = state
        })
        const owner = new WorkspaceCanvasContext({
            document,
            window,
            host: {
                assets: { read: vi.fn() },
                contextEnvironment: sources => ({
                    ...sources,
                    extractDocumentText: () => '',
                    getAssetRenditionPath: () => '',
                    prepareAuthorizedRenditionUrl: vi.fn(),
                }),
            },
            capabilityModuleCache: {},
            getPromptCatalog: vi.fn(),
            getDocuments: () => [],
            getThreads: () => [],
            getState: () => canvasState,
            getPanelState: () => panelState,
            persistPanelState,
            applyLocalPanelState: state => {
                panelState = state
            },
            findNode: nodeId => canvasState.nodes.find(node => node.nodeId === nodeId),
            getPreviewNode: vi.fn(),
        } as WorkspaceCanvasContextPorts)

        owner.add(['image-1', 'branch-1', 'image-1'])
        expect(panelState.contextChips).toEqual(['image-1'])

        owner.remove('image-1')
        expect(panelState.contextChips).toEqual([])
        expect(persistPanelState).toHaveBeenCalledTimes(2)
        owner.destroy()
    })
})
