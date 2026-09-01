import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    LoadingStatus,
    type CanvasAiChatPanelState,
    type CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceCanvasRendering,
    type WorkspaceCanvasRenderingPorts,
} from './workspace-canvas-rendering.ts'

const canvasState = (): CanvasState => ({
    nodes: [{
        nodeId: 'image-1',
        type: 'image',
        assetId: 'asset-1',
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 100 },
    }],
    edges: [],
    viewport: { x: 10, y: 20, zoom: 1 },
})

function setup() {
    let workspaceId = 'first'
    let renderedWorkspaceId: string | null = 'first'
    let state: CanvasState | null = null
    let keys = { nodeStructure: '', visual: '', documents: '', threads: '' }
    const renderNodes = vi.fn()
    const releaseWorkspaceResources = vi.fn()
    const clearWorkspaceRuntime = vi.fn()
    const createComposer = vi.fn()
    const ports: WorkspaceCanvasRenderingPorts = {
        getWorkspaceId: () => workspaceId,
        setWorkspaceId: value => {
            workspaceId = value
        },
        getRenderedWorkspaceId: () => renderedWorkspaceId,
        setRenderedWorkspaceId: value => {
            renderedWorkspaceId = value
        },
        getLoadingStatus: () => LoadingStatus.success,
        setLoadingVisible: vi.fn(),
        getPendingVisualCommit: () => null,
        setPendingVisualCommit: vi.fn(),
        getState: () => state,
        setState: value => {
            state = value
        },
        setDocuments: vi.fn(),
        setThreads: vi.fn(),
        getPanelState: () => ({ isOpen: false, topLevelMode: 'aiThreads', contextChips: [] } as CanvasAiChatPanelState),
        getKeys: () => keys,
        setKeys: value => {
            keys = { ...keys, ...value }
        },
        getLiveViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        isViewportLocked: () => false,
        syncPanZoom: vi.fn(),
        syncViewportInteraction: vi.fn(),
        applyViewport: vi.fn(),
        resetStaleMediaAnalysis: value => ({ state: value, changed: false }),
        preserveActiveMedia: value => value,
        mergeThreads: threads => threads,
        getDocumentsKey: documents => documents.map(document => document.documentId).join(','),
        getThreadsKey: threads => threads.map(thread => thread.threadId).join(','),
        clearWorkspaceRuntime,
        releaseWorkspaceResources,
        publishState: vi.fn(),
        syncPanelState: vi.fn(),
        clearVisualContent: vi.fn(),
        renderNodes,
        syncDocuments: vi.fn(),
        syncMarkers: vi.fn(),
        hasPanelElement: () => false,
        isPanelClosing: () => false,
        renderDetails: vi.fn(),
        destroyPanel: vi.fn(),
        refreshMarkerThreads: vi.fn(),
        hasConnections: () => false,
        syncNodeGeometry: vi.fn(),
        syncCanvasLayer: vi.fn(),
        scheduleEdges: vi.fn(),
        syncMedia: vi.fn(),
        syncChrome: vi.fn(),
        updateChromeLayout: vi.fn(),
        reattachRuns: vi.fn(),
        createComposer,
        markPersistedViewportApplied: vi.fn(),
        isDebugEnabled: () => false,
        debug: vi.fn(),
    }
    return {
        owner: new WorkspaceCanvasRendering(ports),
        renderNodes,
        releaseWorkspaceResources,
        clearWorkspaceRuntime,
        createComposer,
        getState: () => state,
        getWorkspaceId: () => workspaceId,
    }
}

describe('WorkspaceCanvasRendering', () => {
    it('renders a changed node structure while preserving the live viewport', () => {
        const fixture = setup()
        const state = canvasState()

        fixture.owner.render(state, [], [])

        expect(fixture.getState()).toEqual({
            ...state,
            viewport: { x: 0, y: 0, zoom: 1 },
        })
        expect(fixture.renderNodes).toHaveBeenCalledOnce()
        expect(fixture.releaseWorkspaceResources).not.toHaveBeenCalled()
    })

    it('releases workspace-scoped resources and clears runtime state on navigation', () => {
        const fixture = setup()

        fixture.owner.render(canvasState(), [], [], 'second')

        expect(fixture.getWorkspaceId()).toBe('second')
        expect(fixture.releaseWorkspaceResources).toHaveBeenCalledOnce()
        expect(fixture.clearWorkspaceRuntime).toHaveBeenCalledOnce()
        expect(fixture.createComposer).toHaveBeenCalledOnce()
    })
})
