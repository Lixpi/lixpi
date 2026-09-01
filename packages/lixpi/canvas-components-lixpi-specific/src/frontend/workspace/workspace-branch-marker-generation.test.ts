import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type BranchOriginCanvasNode,
    type CanvasState,
    type ImageCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceBranchMarkerGeneration,
    type WorkspaceBranchMarkerGenerationPorts,
} from './workspace-branch-marker-generation.ts'

const marker = (overrides: Partial<BranchOriginCanvasNode> = {}): BranchOriginCanvasNode => ({
    nodeId: 'marker-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    conversationAssetId: 'thread-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 80 },
    temporary: true,
    ...overrides,
})

const pendingImage = (): ImageCanvasNode => ({
    nodeId: 'image-1',
    type: 'image',
    assetId: 'asset-image-1',
    mediaGenerationPhase: 'pending-before-first-frame',
    position: { x: 400, y: 0 },
    dimensions: { width: 300, height: 300 },
    generatedBy: {
        conversationAssetId: 'thread-1',
        responseId: 'response-1',
        aiModel: 'image-model',
        revisedPrompt: 'draw it',
        generationRequestId: 'request-1',
        branchOriginNodeId: 'marker-1',
        mediaType: 'image',
    },
})

function setup(overrides: Partial<WorkspaceBranchMarkerGenerationPorts> = {}) {
    const source = marker()
    const image = pendingImage()
    let state: CanvasState = {
        nodes: [source, image],
        edges: [{ edgeId: 'edge-1', sourceNodeId: source.nodeId, targetNodeId: image.nodeId, sourceT: 0.5, targetT: 0.5 }],
        viewport: { x: 0, y: 0, zoom: 1 },
    }
    const ports: WorkspaceBranchMarkerGenerationPorts = {
        canAct: () => true,
        getState: () => state,
        getScene: () => ({ workspaceId: 'workspace-1', sceneKey: 'scene-1' }),
        isCurrentScene: () => true,
        imageTrackers: new Map([['run-1', {
            nodeId: image.nodeId,
            assetId: image.assetId,
            sourceNodeId: source.nodeId,
            placementKey: 'placement-1',
            hasReceivedFrame: false,
        }]]),
        videoTrackers: new Map(),
        isWaitingForFrame: node => node.nodeId === image.nodeId,
        pruneTrackers: vi.fn(),
        removeSelection: vi.fn(),
        commit: vi.fn((nextState) => {
            state = nextState
        }),
        removeNodes: vi.fn(),
        syncConnections: vi.fn(),
        cancelledRequests: new Set(),
        settleRequest: vi.fn(),
        clearPlacements: vi.fn(),
        settleMarkers: vi.fn(),
        settleConversation: vi.fn(),
        scheduleTeardown: vi.fn(),
        refreshMarkers: vi.fn(),
        stopConversation: vi.fn(async () => ({
            status: 'stopped' as const,
            canvasGeometry: { layoutRevision: 4, nodes: [] },
        })),
        applyGeometry: vi.fn(),
        refreshConversation: vi.fn(async () => undefined),
        reportError: vi.fn(),
        ...overrides,
    }
    return { owner: new WorkspaceBranchMarkerGeneration(ports), ports, source, image, getState: () => state }
}

describe('WorkspaceBranchMarkerGeneration', () => {
    it('removes active media immediately and settles a durable generation request before stopping transport', async () => {
        const fixture = setup()

        await fixture.owner.stop(fixture.source)

        expect(fixture.ports.cancelledRequests).toEqual(new Set(['request-1']))
        expect(fixture.ports.pruneTrackers).toHaveBeenCalledWith(new Set(['image-1']))
        expect(fixture.ports.removeSelection).toHaveBeenCalledWith('image-1')
        expect(fixture.getState().nodes.map(node => node.nodeId)).toEqual(['marker-1'])
        expect(fixture.getState().edges).toEqual([])
        expect(fixture.ports.removeNodes).toHaveBeenCalledWith(new Set(['image-1']))
        expect(fixture.ports.syncConnections).toHaveBeenCalledOnce()
        expect(fixture.ports.settleRequest).toHaveBeenCalledWith('thread-1', 'request-1', { preserveGeometry: true })
        expect(fixture.ports.stopConversation).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            generationRequestId: 'request-1',
        })
        expect(fixture.ports.applyGeometry).toHaveBeenCalledWith({ layoutRevision: 4, nodes: [] })
        expect(fixture.ports.refreshConversation).toHaveBeenCalledWith('thread-1')
    })

    it('settles temporary canvas request state without treating its local id as durable', async () => {
        const fixture = setup({ imageTrackers: new Map(), isWaitingForFrame: () => false })
        const source = marker({ generationRequestId: 'canvas-local-1' })

        await fixture.owner.stop(source)

        expect(fixture.ports.cancelledRequests).toEqual(new Set())
        expect(fixture.ports.clearPlacements).toHaveBeenCalledWith('thread-1')
        expect(fixture.ports.settleMarkers).toHaveBeenCalledWith('canvas-local-1', { preserveGeometry: true })
        expect(fixture.ports.settleConversation).toHaveBeenCalledWith('thread-1')
        expect(fixture.ports.scheduleTeardown).toHaveBeenCalledWith('thread-1')
        expect(fixture.ports.refreshMarkers).toHaveBeenCalledWith('thread-1')
    })

    it('drops late geometry and refresh work after the originating scene is replaced', async () => {
        const result = Promise.withResolvers<{ status: 'stopped'; canvasGeometry: { layoutRevision: number; nodes: [] } }>()
        let current = true
        const fixture = setup({
            stopConversation: () => result.promise,
            isCurrentScene: () => current,
        })

        const pending = fixture.owner.stop(fixture.source)
        current = false
        result.resolve({ status: 'stopped', canvasGeometry: { layoutRevision: 5, nodes: [] } })
        await pending

        expect(fixture.ports.applyGeometry).not.toHaveBeenCalled()
        expect(fixture.ports.refreshConversation).not.toHaveBeenCalled()
    })

    it('reports stop failures without restoring media removed from the local scene', async () => {
        const error = new Error('stop failed')
        const fixture = setup({
            stopConversation: vi.fn(async () => {
                throw error
            }),
        })

        await fixture.owner.stop(fixture.source)

        expect(fixture.getState().nodes.map(node => node.nodeId)).toEqual(['marker-1'])
        expect(fixture.ports.reportError).toHaveBeenCalledWith(
            '[CANVAS] failed to stop branch-marker generation',
            { nodeId: 'marker-1', threadId: 'thread-1', error },
        )
    })
})
