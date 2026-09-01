import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceOperationStatusNodes,
    type WorkspaceOperationStatusNodesPorts,
} from './workspace-operation-status-nodes.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

const operation = (overrides: Partial<OperationStatusCanvasNode> = {}): OperationStatusCanvasNode => ({
    nodeId: 'operation-1',
    type: 'operationStatus',
    operation: 'media-generation',
    status: 'in-progress',
    title: 'Generating',
    message: 'Waiting',
    generationRequestId: 'request-1',
    position: { x: 100, y: 100 },
    dimensions: { width: 320, height: 100 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

const documentNode = (): DocumentCanvasNode => ({
    nodeId: 'document-1',
    type: 'document',
    referenceId: 'asset-document-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 300, height: 300 },
})

const image = (): ImageCanvasNode => ({
    nodeId: 'output-1',
    type: 'image',
    assetId: 'asset-image-1',
    position: { x: 500, y: 0 },
    dimensions: { width: 300, height: 300 },
})

function setup(initialState: CanvasState, overrides: Partial<WorkspaceOperationStatusNodesPorts> = {}) {
    let state = initialState
    const ports: WorkspaceOperationStatusNodesPorts = {
        host: {} as WorkspaceCanvasHost,
        shells: {} as WorkspaceOperationStatusNodesPorts['shells'],
        getWorkspaceId: () => 'workspace-1',
        getState: () => state,
        replaceState: vi.fn((nextState) => {
            state = nextState
        }),
        captureAdmission: () => () => true,
        commit: vi.fn((nextState) => {
            state = nextState
        }),
        commitTransient: vi.fn((nextState) => {
            state = nextState
        }),
        removeSelection: vi.fn(),
        rebalance: nodes => nodes,
        removeNodes: vi.fn(),
        pruneTrackers: vi.fn(),
        clearTransientImage: vi.fn(),
        syncNode: vi.fn(),
        syncGeometry: vi.fn(),
        syncMedia: vi.fn(),
        syncChrome: vi.fn(),
        syncMarkers: vi.fn(),
        syncConnections: vi.fn(),
        syncProgress: vi.fn(),
        ensureRecovery: vi.fn(),
        addContext: vi.fn(),
        getComposer: () => null,
        ...overrides,
    }
    return { owner: new WorkspaceOperationStatusNodes(ports), ports, getState: () => state }
}

describe('WorkspaceOperationStatusNodes', () => {
    it('removes a matching operation node, its incident edges and its selection', () => {
        const status = operation()
        const doc = documentNode()
        const fixture = setup({
            nodes: [status, doc],
            edges: [{ edgeId: 'edge-1', sourceNodeId: doc.nodeId, targetNodeId: status.nodeId }],
            viewport: { x: 0, y: 0, zoom: 1 },
        })

        const state = fixture.owner.remove(status.nodeId, 'media-generation')

        expect(state?.nodes).toEqual([doc])
        expect(state?.edges).toEqual([])
        expect(fixture.ports.commit).toHaveBeenCalledWith(state)
        expect(fixture.ports.removeSelection).toHaveBeenCalledWith(status.nodeId)
    })

    it('does not remove a node when the requested operation kind does not match', () => {
        const status = operation({ operation: 'upload' })
        const state = { nodes: [status], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        const fixture = setup(state)

        expect(fixture.owner.remove(status.nodeId, 'media-generation')).toBeNull()
        expect(fixture.getState()).toBe(state)
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })

    it('applies progress-only recovery without rebuilding mounted node content', () => {
        const initial = { nodes: [operation()], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        const updated = { ...initial, nodes: [operation({ message: 'Rendering' })] }
        const fixture = setup(initial)

        fixture.owner.applyProgress({ state: updated, changed: true, updatedNodeIds: ['operation-1'], removedNodeIds: [] })

        expect(fixture.getState()).toBe(updated)
        expect(fixture.ports.replaceState).toHaveBeenCalledWith(updated)
        expect(fixture.ports.syncProgress).toHaveBeenCalledWith(updated)
        expect(fixture.ports.commitTransient).not.toHaveBeenCalled()
    })

    it('reconciles recovery removals and replacement operation nodes through the supplied view ports', () => {
        const removed = documentNode()
        const output = image()
        const initial = {
            nodes: [removed, output],
            edges: [{ edgeId: 'edge-1', sourceNodeId: removed.nodeId, targetNodeId: output.nodeId }],
            viewport: { x: 0, y: 0, zoom: 1 },
        } satisfies CanvasState
        const replacement = operation({ nodeId: output.nodeId })
        const recovered = { nodes: [replacement], edges: [], viewport: initial.viewport } satisfies CanvasState
        const fixture = setup(initial, {
            rebalance: nodes => nodes.map(node => node.nodeId === output.nodeId ? { ...node, position: { x: 600, y: 20 } } : node),
        })

        fixture.owner.applyRecovery({
            state: recovered,
            changed: true,
            updatedNodeIds: [output.nodeId],
            removedNodeIds: [removed.nodeId],
        })

        expect(fixture.ports.removeNodes).toHaveBeenCalledWith([removed.nodeId])
        expect(fixture.ports.pruneTrackers).toHaveBeenCalledWith([removed.nodeId, output.nodeId])
        expect(fixture.ports.clearTransientImage).toHaveBeenCalledWith(removed.nodeId)
        expect(fixture.ports.removeSelection).toHaveBeenCalledWith(removed.nodeId)
        expect(fixture.ports.syncNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: output.nodeId }))
        expect(fixture.ports.syncGeometry).toHaveBeenCalledWith([
            expect.objectContaining({ nodeId: output.nodeId, position: { x: 600, y: 20 } }),
        ])
        expect(fixture.ports.syncMedia).toHaveBeenCalledWith(fixture.getState())
        expect(fixture.ports.syncChrome).toHaveBeenCalledOnce()
        expect(fixture.ports.syncMarkers).toHaveBeenCalledOnce()
        expect(fixture.ports.syncConnections).toHaveBeenCalledOnce()
    })
})
