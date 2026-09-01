import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    CanvasState,
    CanvasGeometryUpdate,
    BranchLineCanvasNode,
    BranchForkCanvasNode,
} from '@lixpi/constants'
import { WorkspaceGenerationPlacements } from '../generation/workspace-generation-placements.ts'
import {
    WorkspaceApiCanvasGeometry,
    type WorkspaceApiCanvasGeometryPorts,
} from './workspace-api-canvas-geometry.ts'

function image(nodeId = 'image'): CanvasNode {
    return { type: 'image', nodeId, assetId: 'asset', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } }
}

function update(revision: number, x: number, nodeId = 'image'): CanvasGeometryUpdate {
    return { layoutRevision: revision, nodes: [{ nodeId, position: { x, y: 10 }, dimensions: { width: 100, height: 100 } }] }
}

function setup(nodes: CanvasNode[] = [image()]) {
    let state: CanvasState = { nodes, edges: [], viewport: { x: 20, y: 30, zoom: 2 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const ports: WorkspaceApiCanvasGeometryPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        placements,
        settlement: { resolvePendingBranchMarkersForLineagePlan: vi.fn(), cleanupOrphanPreflightMarkersForThread: vi.fn() },
        cleanupMarkers: vi.fn(ids => {
            for (const id of ids) placements.deletePendingBranchMarkerAliasesForNodeId(id)
        }),
        pruneTrackers: vi.fn(),
        commit: vi.fn(value => {
            state = value
        }),
        publishAuthoritative: vi.fn(),
        syncMedia: vi.fn(),
        syncGeneratingMedia: vi.fn(),
        appendNode: vi.fn(),
        syncOperationNode: vi.fn(),
        syncNodeGeometry: vi.fn(),
        preserveUntilAcknowledged: vi.fn(),
        log: vi.fn(),
    }
    return {
        owner: new WorkspaceApiCanvasGeometry(ports),
        ports,
        placements,
        read: () => state,
        setScope: (value: typeof scope) => {
            scope = value
        },
        setState: (value: CanvasState) => {
            state = value
        },
    }
}

function preflight(): BranchLineCanvasNode {
    return { type: 'branchLine', nodeId: 'preflight', generationRequestId: 'thread', branchId: 'branch', conversationAssetId: 'thread', position: { x: 1, y: 2 }, dimensions: { width: 100, height: 60 }, temporary: true, pendingState: { phase: 'preflight', promptText: 'prompt', reasoningModelId: 'provider:reasoning', reasoningIndex: 0 } }
}

function plannedFork(): BranchForkCanvasNode {
    return { type: 'branchFork', nodeId: 'fork', generationRequestId: 'request', branchId: 'branch', conversationAssetId: 'thread', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', reasoningIndex: 0, position: { x: 10, y: 20 }, dimensions: { width: 200, height: 80 }, temporary: true }
}

describe('workspace API canvas geometry', () => {
    it('applies authoritative geometry transiently, publishes its revision and preserves the local viewport', () => {
        const view = setup()
        view.owner.applyApiCanvasGeometry(update(5, 50))
        expect(view.read().nodes[0].position).toEqual({ x: 50, y: 10 })
        expect(view.read().viewport).toEqual({ x: 20, y: 30, zoom: 2 })
        expect(view.ports.commit).toHaveBeenCalledOnce()
        expect(view.ports.publishAuthoritative).toHaveBeenCalledWith({ canvasState: view.read(), layoutRevision: 5 })
        expect(view.ports.preserveUntilAcknowledged).toHaveBeenCalledWith(view.read())
    })

    it('ignores duplicate and lower revisions after a complete projection', () => {
        const view = setup()
        view.owner.applyApiCanvasGeometry(update(5, 50))
        view.owner.applyApiCanvasGeometry(update(5, 10))
        view.owner.applyApiCanvasGeometry(update(4, 20))
        expect(view.read().nodes[0].position.x).toBe(50)
        expect(view.ports.publishAuthoritative).toHaveBeenCalledOnce()
    })

    it('blocks lower revisions after an incomplete update but retries that revision when snapshots arrive', () => {
        const view = setup()
        view.owner.applyApiCanvasGeometry(update(8, 80, 'missing'))
        view.owner.applyApiCanvasGeometry(update(7, 70))
        expect(view.read().nodes[0].position.x).toBe(0)
        expect(view.ports.publishAuthoritative).not.toHaveBeenCalled()
        view.owner.applyApiCanvasGeometry({ ...update(8, 80, 'missing'), nodeSnapshots: [image('missing')] })
        expect(view.read().nodes.find(node => node.nodeId === 'missing')?.position.x).toBe(80)
        expect(view.ports.publishAuthoritative).toHaveBeenCalledWith({ canvasState: view.read(), layoutRevision: 8 })
    })

    it('accepts lower revisions after changing workspace or replacing its scene', () => {
        const view = setup()
        view.owner.applyApiCanvasGeometry(update(50, 50))
        view.setScope({ workspaceId: 'other', sceneKey: 'scene' })
        view.owner.applyApiCanvasGeometry(update(2, 2))
        view.setScope({ workspaceId: 'other', sceneKey: 'replacement' })
        view.owner.applyApiCanvasGeometry(update(1, 1))
        expect(view.read().nodes[0].position.x).toBe(1)
        expect(view.ports.publishAuthoritative).toHaveBeenCalledTimes(3)
    })

    it('hands preflight aliases to the API marker and removes incident preflight edges', () => {
        const view = setup([preflight(), image()])
        view.setState({ ...view.read(), edges: [{ edgeId: 'old', sourceNodeId: 'preflight', targetNodeId: 'image' }] })
        view.placements.markers.set('thread:reasoning-index:0', { nodeId: 'preflight', placementKey: 'thread', threadId: 'thread', reasoningIndex: 0 })
        const fork = plannedFork()
        view.owner.applyApiCanvasGeometry({ layoutRevision: 1, generationRequestId: 'request', nodes: [], nodeSnapshots: [fork] })
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['image', 'fork'])
        expect(view.read().edges).toEqual([])
        expect(view.placements.markers.get('thread:reasoning-index:0')?.nodeId).toBe('fork')
        expect(view.ports.cleanupMarkers).toHaveBeenCalledWith(['preflight'])
        expect(view.ports.appendNode).toHaveBeenCalledWith(fork)
    })

    it('leaves aliases and state unchanged when preparation is interrupted before cleanup', () => {
        const view = setup([preflight()])
        const record = { nodeId: 'preflight', placementKey: 'thread', threadId: 'thread', reasoningIndex: 0 }
        view.placements.markers.set('thread', record)
        vi.mocked(view.ports.log).mockImplementation(event => {
            if (event === 'received') view.setScope({ workspaceId: 'other', sceneKey: 'other' })
        })
        view.owner.applyApiCanvasGeometry({ layoutRevision: 1, generationRequestId: 'request', nodes: [], nodeSnapshots: [plannedFork()] })
        expect(view.placements.markers.get('thread')).toBe(record)
        expect(view.ports.cleanupMarkers).not.toHaveBeenCalled()
        expect(view.ports.commit).not.toHaveBeenCalled()
    })

    it('does not publish into a replacement scene after the commit callback navigates', () => {
        const view = setup()
        vi.mocked(view.ports.commit).mockImplementation(() => view.setScope({ workspaceId: 'other', sceneKey: 'other' }))
        view.owner.applyApiCanvasGeometry(update(1, 10))
        expect(view.ports.publishAuthoritative).not.toHaveBeenCalled()
        expect(view.ports.syncGeneratingMedia).not.toHaveBeenCalled()
        expect(view.ports.preserveUntilAcknowledged).not.toHaveBeenCalled()
    })

    it('allows a reentrant newer revision to finish without publishing the older result afterward', () => {
        const view = setup()
        vi.mocked(view.ports.commit).mockImplementation(value => {
            view.setState(value)
            if (value.nodes[0].position.x === 10) view.owner.applyApiCanvasGeometry(update(2, 20))
        })
        view.owner.applyApiCanvasGeometry(update(1, 10))
        expect(view.read().nodes[0].position.x).toBe(20)
        expect(view.ports.publishAuthoritative).toHaveBeenCalledOnce()
        expect(view.ports.publishAuthoritative).toHaveBeenCalledWith({ canvasState: view.read(), layoutRevision: 2 })
        expect(view.ports.preserveUntilAcknowledged).toHaveBeenCalledOnce()
    })

    it('synchronizes operation snapshots through their operation renderer and prunes deleted media trackers', () => {
        const view = setup()
        const failed: CanvasNode = { type: 'operationStatus', nodeId: 'failure', operation: 'upload', status: 'failed', message: 'failed', position: { x: 10, y: 20 }, dimensions: { width: 100, height: 80 }, createdAt: 1, updatedAt: 2 }
        view.owner.applyApiCanvasGeometry({ layoutRevision: 1, nodes: [], nodeSnapshots: [failed], removedNodeIds: ['image'] })
        expect(view.read().nodes[0].type).toBe('operationStatus')
        expect(view.ports.pruneTrackers).toHaveBeenCalledWith(['image'])
        expect(view.ports.syncOperationNode).toHaveBeenCalledWith(failed)
        expect(view.ports.appendNode).not.toHaveBeenCalled()
    })

    it('synchronizes every supported snapshot type without recreating document editors', () => {
        const kinds = ['branchOrigin', 'branchFork', 'branchLine', 'image', 'video', 'mediaDocument', 'audio', 'capabilityArtifact', 'document'] as const
        const nodes = kinds.map(type => ({ ...image(type), type }) as CanvasNode)
        const view = setup(nodes)
        view.owner.syncApiCanvasSnapshotNodesToDOM(nodes.map(node => node.nodeId))
        expect(vi.mocked(view.ports.appendNode).mock.calls.map(([node]) => node.type)).toEqual(kinds.slice(0, -1))
    })

    it('stops snapshot rendering when the first node callback replaces the scene', () => {
        const view = setup([image('first'), image('second')])
        vi.mocked(view.ports.appendNode).mockImplementation(() => view.setScope(null))
        view.owner.syncApiCanvasSnapshotNodesToDOM(['first', 'second'])
        expect(view.ports.appendNode).toHaveBeenCalledOnce()
    })

    it('publishes an already-matching authoritative revision without an unnecessary transient commit', () => {
        const view = setup()
        view.owner.applyApiCanvasGeometry({ layoutRevision: 1, nodes: [] })
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.publishAuthoritative).toHaveBeenCalledWith({ canvasState: view.read(), layoutRevision: 1 })
    })

    it('keeps revisions independent across canvases and rejects work after destruction', () => {
        const first = setup()
        const second = setup()
        first.owner.applyApiCanvasGeometry(update(100, 100))
        second.owner.applyApiCanvasGeometry(update(1, 1))
        first.owner.destroy()
        first.owner.clear()
        first.owner.applyApiCanvasGeometry(update(101, 101))
        first.owner.syncApiCanvasSnapshotNodesToDOM(['image'])
        expect(first.read().nodes[0].position.x).toBe(100)
        expect(second.read().nodes[0].position.x).toBe(1)
        expect(first.ports.publishAuthoritative).toHaveBeenCalledOnce()
    })
})
