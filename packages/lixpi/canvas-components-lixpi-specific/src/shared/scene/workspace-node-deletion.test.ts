import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceNodeDeletion,
    type WorkspaceNodeDeletionPorts,
} from './workspace-node-deletion.ts'

function image(nodeId = 'image', generated = false): ImageCanvasNode {
    return {
        nodeId,
        type: 'image',
        assetId: nodeId,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 100 },
        ...(generated ? { generatedBy: { conversationAssetId: 'thread', responseId: 'response', aiModel: 'test:model', revisedPrompt: 'prompt', generationRequestId: 'request' } } : {}),
    }
}
function operation(): OperationStatusCanvasNode {
    return { nodeId: 'operation', type: 'operationStatus', operation: 'media-generation', status: 'failed', title: 'Failed', message: 'Generation failed', generationRequestId: 'request', requestRevision: 7, outputNodeId: 'image', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 }, createdAt: 1, updatedAt: 1 }
}
function marker(): CanvasNode {
    return { nodeId: 'marker', type: 'branchOrigin', branchId: 'branch', generationRequestId: 'request', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 60 }, temporary: true }
}
function setup(nodes: CanvasNode[] = [image()]) {
    let state: CanvasState | null = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope = { workspaceId: 'workspace', sceneKey: 'scene' }
    const ports: WorkspaceNodeDeletionPorts = {
        readScope: () => scope,
        readState: () => state,
        getAsset: () => undefined,
        clearSelection: vi.fn(),
        resolveTree: (nodes, edges) => ({ nodes, edges }),
        rejectOutput: vi.fn(async () => 'not-found' as const),
        getRequest: vi.fn(async () => ({ request: { revision: 9 } })),
        cancelRequest: vi.fn(async () => undefined),
        removeOperation: vi.fn(),
        detachAsset: vi.fn(async request => request.canvasState),
        commitTransient: vi.fn(next => {
            state = next
        }),
        commit: vi.fn(next => {
            state = next
        }),
        removeContextChips: vi.fn(),
        reportError: vi.fn(),
        warn: vi.fn(),
    }
    const owner = new WorkspaceNodeDeletion(ports)
    return {
        owner,
        ports,
        setScope: (value: typeof scope) => {
            scope = value
        },
        setState: (value: CanvasState | null) => {
            state = value
        },
        get state() {
            return state!
        },
    }
}

describe('WorkspaceNodeDeletion', () => {
    it('detaches an Asset and every pruned marker while dropping incident edges', async () => {
        const media = image('image', true)
        media.generatedBy = { ...media.generatedBy!, branchId: 'branch', generationRequestId: 'canvas-request' }
        const fixture = setup([media, marker(), image('retained')])
        fixture.setState({
            ...fixture.state,
            aiChatPanel: { isOpen: false, topLevelMode: 'aiThreads', contextChips: ['image', 'marker', 'retained'] },
            edges: [{ edgeId: 'edge', sourceNodeId: 'marker', targetNodeId: 'image' }],
        })
        fixture.ports.resolveTree = (nodes, edges) => ({ nodes: nodes.filter(node => node.nodeId !== 'marker'), edges })
        await fixture.owner.deleteCanvasNodes(new Set(['image']))
        expect(fixture.ports.detachAsset).toHaveBeenCalledWith(expect.objectContaining({ removedNodeIds: ['image', 'marker'] }))
        expect(fixture.state.nodes.map(node => node.nodeId)).toEqual(['retained'])
        expect(fixture.state.edges).toEqual([])
        expect(fixture.state.aiChatPanel!.contextChips).toEqual(['retained'])
        expect(fixture.ports.removeContextChips).toHaveBeenCalledWith(['image', 'marker'])
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })

    it('finishes local removal when the Asset no longer exists', async () => {
        const fixture = setup()
        fixture.ports.detachAsset = async () => {
            throw new Error('NOT_FOUND')
        }
        await fixture.owner.deleteCanvasNodes(new Set(['image']))
        expect(fixture.state.nodes).toEqual([])
        expect(fixture.ports.commit).toHaveBeenCalledOnce()
        expect(fixture.ports.warn).toHaveBeenCalledOnce()
        expect(fixture.ports.reportError).not.toHaveBeenCalled()
    })

    it('continues deleting other selected nodes after one detach fails', async () => {
        const fixture = setup([image('blocked'), image('allowed')])
        fixture.ports.detachAsset = async request => {
            if (request.nodeId === 'blocked') throw new Error('DENIED')
            return request.canvasState
        }
        await fixture.owner.deleteCanvasNodes(new Set(['blocked', 'allowed']))
        expect(fixture.state.nodes.map(node => node.nodeId)).toEqual(['blocked'])
        expect(fixture.ports.reportError).toHaveBeenCalledTimes(2)
    })

    it('uses authoritative lineage rejection before considering local removal', async () => {
        const fixture = setup([marker()])
        fixture.ports.rejectOutput = vi.fn(async () => 'applied' as const)
        await fixture.owner.deleteCanvasNodes(new Set(['marker']))
        expect(fixture.ports.rejectOutput).toHaveBeenCalledWith('branch-lineage', 'marker')
        expect(fixture.ports.detachAsset).not.toHaveBeenCalled()
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })

    it('removes an orphan marker when authoritative review cannot own it', async () => {
        const fixture = setup([marker()])
        await fixture.owner.deleteCanvasNodes(new Set(['marker']))
        expect(fixture.ports.rejectOutput).toHaveBeenCalledWith('branch-lineage', 'marker')
        expect(fixture.state.nodes).toEqual([])
        expect(fixture.ports.commit).toHaveBeenCalledOnce()
    })

    it('cancels unfinished media using an operation revision without fetching', async () => {
        const fixture = setup([image('image', true), operation()])
        await fixture.owner.deleteCanvasNodes(new Set(['image']))
        expect(fixture.ports.cancelRequest).toHaveBeenCalledWith({ workspaceId: 'workspace', generationRequestId: 'request', requestRevision: 7 })
        expect(fixture.ports.getRequest).not.toHaveBeenCalled()
        expect(fixture.ports.detachAsset).not.toHaveBeenCalled()
        expect(fixture.ports.removeOperation).toHaveBeenCalledWith('operation', 'media-generation')
    })

    it('fetches the request revision when no operation survived', async () => {
        const fixture = setup([image('image', true)])
        await fixture.owner.deleteCanvasNodes(new Set(['image']))
        expect(fixture.ports.getRequest).toHaveBeenCalledWith({ workspaceId: 'workspace', generationRequestId: 'request' })
        expect(fixture.ports.cancelRequest).toHaveBeenCalledWith({ workspaceId: 'workspace', generationRequestId: 'request', requestRevision: 9 })
        expect(fixture.ports.detachAsset).not.toHaveBeenCalled()
    })

    it('cancels operation nodes before removing their presentation', async () => {
        const fixture = setup([operation()])
        const pending = Promise.withResolvers<unknown>()
        fixture.ports.cancelRequest = vi.fn(() => pending.promise)
        const deleting = fixture.owner.deleteCanvasNodes(new Set(['operation']))
        expect(fixture.ports.removeOperation).not.toHaveBeenCalled()
        pending.resolve(undefined)
        await deleting
        expect(fixture.ports.removeOperation).toHaveBeenCalledWith('operation', 'media-generation')
    })

    it('does not publish an accepted detach into a replaced scene or delete its other nodes', async () => {
        const fixture = setup([image(), image('other')])
        const pending = Promise.withResolvers<CanvasState>()
        fixture.ports.detachAsset = vi.fn(() => pending.promise)
        const deleting = fixture.owner.deleteCanvasNodes(new Set(['image', 'other']))
        await Promise.resolve()
        fixture.setScope({ workspaceId: 'replacement', sceneKey: 'replacement' })
        pending.resolve({ ...fixture.state, nodes: [] })
        await deleting
        expect(fixture.ports.commitTransient).not.toHaveBeenCalled()
        expect(fixture.ports.detachAsset).toHaveBeenCalledOnce()
        expect(fixture.ports.removeContextChips).not.toHaveBeenCalled()
    })

    it('does not send cancellation after an obsolete request lookup completes', async () => {
        const fixture = setup([image('image', true)])
        const pending = Promise.withResolvers<{ request: { revision: number } }>()
        fixture.ports.getRequest = () => pending.promise
        const deleting = fixture.owner.deleteCanvasNodes(new Set(['image']))
        fixture.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' })
        pending.resolve({ request: { revision: 8 } })
        await deleting
        expect(fixture.ports.cancelRequest).not.toHaveBeenCalled()
        expect(fixture.ports.detachAsset).not.toHaveBeenCalled()
    })

    it('allows a replacement scene to delete without an old completion unlocking it', async () => {
        const fixture = setup()
        const first = Promise.withResolvers<CanvasState>()
        const second = Promise.withResolvers<CanvasState>()
        fixture.ports.detachAsset = vi.fn()
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise)
        const obsolete = fixture.owner.deleteCanvasNodes(new Set(['image']))
        await Promise.resolve()
        fixture.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' })
        const current = fixture.owner.deleteCanvasNodes(new Set(['image']))
        await Promise.resolve()
        first.resolve({ ...fixture.state, nodes: [] })
        await obsolete
        await fixture.owner.deleteCanvasNodes(new Set(['image']))
        expect(fixture.ports.detachAsset).toHaveBeenCalledTimes(2)
        second.resolve({ ...fixture.state, nodes: [] })
        await current
        expect(fixture.ports.commitTransient).toHaveBeenCalledOnce()
    })

    it('keeps independent owners and rejects callbacks and new work after destruction', async () => {
        const first = setup()
        const second = setup()
        const pending = Promise.withResolvers<CanvasState>()
        first.ports.detachAsset = () => pending.promise
        const deleting = first.owner.deleteCanvasNodes(new Set(['image']))
        await Promise.resolve()
        first.owner.destroy()
        pending.resolve({ ...first.state, nodes: [] })
        await deleting
        await first.owner.deleteCanvasNodes(new Set(['image']))
        await second.owner.deleteCanvasNodes(new Set(['image']))
        expect(first.ports.commitTransient).not.toHaveBeenCalled()
        expect(first.ports.clearSelection).toHaveBeenCalledOnce()
        expect(second.state.nodes).toEqual([])
    })
})
