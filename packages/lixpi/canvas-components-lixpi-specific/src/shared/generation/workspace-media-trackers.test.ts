import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'
import { WorkspaceGenerationPlacements } from './workspace-generation-placements.ts'
import {
    WorkspaceMediaTrackers,
    type WorkspaceMediaTrackersPorts,
} from './workspace-media-trackers.ts'

const run: MediaGenerationRunMeta = {
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request',
    mediaRunId: 'media',
    reasoningRunId: 'reasoning',
    reasoningIndex: 0,
    reasoningModelId: 'provider:reasoning',
}

function image(nodeId = 'image'): ImageCanvasNode {
    return { type: 'image', nodeId, assetId: 'asset', position: { x: 10, y: 20 }, dimensions: { width: 300, height: 200 }, generatedBy: { conversationAssetId: 'thread', generationRequestId: 'request', mediaRunId: 'media', reasoningRunId: 'reasoning', mediaModelId: 'provider:image', branchLineNodeId: 'line' } as ImageCanvasNode['generatedBy'] }
}

function setup(nodes: CanvasNode[] = [image()]) {
    let state: CanvasState | null = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const ports: WorkspaceMediaTrackersPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        placements,
        hasDecodedFrame: vi.fn(() => false),
        hasReadyOriginal: vi.fn(() => false),
        forgetDecodedFrame: vi.fn(),
        clearCompletion: vi.fn(),
        debug: vi.fn(),
    }
    return {
        owner: new WorkspaceMediaTrackers(ports),
        ports,
        read: () => state!,
        setState: (value: CanvasState | null) => {
            state = value
        },
        setScope: (value: typeof scope) => {
            scope = value
        },
    }
}

describe('workspace media trackers', () => {
    it('matches media identity only within the requested media type and conversation', () => {
        const { owner } = setup()
        expect(owner.findGeneratedMediaNodeForRun('image', 'thread', run)?.nodeId).toBe('image')
        expect(owner.findGeneratedMediaNodeForRun('video', 'thread', run)).toBeUndefined()
        expect(owner.findGeneratedMediaNodeForRun('image', 'other', run)).toBeUndefined()
        expect(owner.findGeneratedMediaNodeForRun('image', 'thread')).toBeUndefined()
    })

    it('falls back to request, reasoning and media model when no media run ID was supplied', () => {
        const { owner } = setup()
        const fallback = { ...run, mediaRunId: undefined, mediaModelId: 'provider:image' }
        expect(owner.generatedMediaNodeMatchesGenerationRun(image(), 'image', 'thread', fallback)).toBe(true)
        expect(owner.generatedMediaNodeMatchesGenerationRun(image(), 'image', 'thread', { ...fallback, generationRequestId: 'other' })).toBe(false)
        expect(owner.generatedMediaNodeMatchesGenerationRun(image(), 'image', 'thread', { ...fallback, reasoningRunId: 'other' })).toBe(false)
        expect(owner.generatedMediaNodeMatchesGenerationRun(image(), 'image', 'thread', { ...fallback, mediaModelId: 'provider:other' })).toBe(false)
    })

    it('records source parent, placement identity and decoded image readiness while retiring a stale run alias', () => {
        const view = setup()
        view.setState({ ...view.read(), edges: [{ edgeId: 'edge', sourceNodeId: 'line', targetNodeId: 'image' }] })
        vi.mocked(view.ports.hasDecodedFrame).mockReturnValue(true)
        view.owner.rememberPartialImageTrackerForNode('thread', { ...run, mediaRunId: 'old' }, image())
        const tracker = view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        expect(tracker).toEqual({ nodeId: 'image', assetId: 'asset', sourceNodeId: 'line', placementKey: 'thread:request', hasReceivedFrame: true })
        expect([...view.owner.images.keys()]).toEqual(['media'])
        expect(view.ports.hasReadyOriginal).not.toHaveBeenCalled()
    })

    it('tracks image and video readiness independently using the original Asset rendition', () => {
        const view = setup()
        const video = { ...image('video'), type: 'video' } as VideoCanvasNode
        vi.mocked(view.ports.hasReadyOriginal).mockReturnValue(true)
        view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        view.owner.rememberVideoGenerationTrackerForNode('thread', run, video)
        expect(view.owner.images.get('media')?.hasReceivedFrame).toBe(true)
        expect(view.owner.videos.get('media')?.hasReceivedFrame).toBe(true)
        expect(view.owner.images.get('media')?.nodeId).toBe('image')
        expect(view.owner.videos.get('media')?.nodeId).toBe('video')
    })

    it('preserves an active output, its source node and edges while a delayed store snapshot catches up', () => {
        const view = setup([image(), { type: 'branchLine', nodeId: 'line', generationRequestId: 'request', branchId: 'branch', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 60 } }])
        const edge = { edgeId: 'edge', sourceNodeId: 'line', targetNodeId: 'image' }
        view.setState({ ...view.read(), edges: [edge] })
        view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        const incoming: CanvasState = { nodes: [], edges: [], viewport: { x: 20, y: 40, zoom: 2 } }
        const result = view.owner.preserveActiveGeneratedMediaTrackersInState(incoming)!
        expect(result.nodes.map(node => node.nodeId)).toEqual(['line', 'image'])
        expect(result.edges).toEqual([edge])
        expect(result.viewport).toBe(incoming.viewport)
        expect(incoming.nodes).toEqual([])
    })

    it.each(['node-id', 'asset-id', 'generated-by-run'] as const)('does not duplicate an output already represented by %s', reason => {
        const view = setup()
        const tracker = view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        const incomingNode = { ...image(reason === 'node-id' ? 'image' : 'replacement'), assetId: reason === 'generated-by-run' ? 'other-asset' : 'asset' }
        const incoming = { ...view.read(), nodes: [incomingNode] }
        expect(view.owner.findGeneratedMediaRunInState(incoming, image(), tracker)?.reason).toBe(reason)
        expect(view.owner.preserveActiveGeneratedMediaTrackersInState(incoming)).toBe(incoming)
    })

    it('does not fabricate a node after the current scene has removed it', () => {
        const view = setup()
        view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        const incoming = { ...view.read(), nodes: [] }
        view.setState(incoming)
        expect(view.owner.preserveActiveGeneratedMediaTrackersInState(incoming)).toBe(incoming)
        view.setState(null)
        expect(view.owner.preserveActiveGeneratedMediaTrackersInState(null)).toBeNull()
    })

    it('prunes all deleted-node aliases and completion visuals without touching surviving media', () => {
        const view = setup()
        const tracker = view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        view.owner.images.set('duplicate', tracker)
        view.owner.videos.set('video', { ...tracker, nodeId: 'survivor' })
        view.owner.pruneApiCanvasRemovedGeneratedMediaTrackers(['image', 'image'])
        expect(view.owner.images.size).toBe(0)
        expect(view.owner.videos.size).toBe(1)
        expect(view.ports.forgetDecodedFrame).toHaveBeenCalledOnce()
        expect(view.ports.clearCompletion).toHaveBeenCalledWith('image')
    })

    it('rejects a tracker prepared while its Asset readiness callback replaces the scene', () => {
        const view = setup()
        vi.mocked(view.ports.hasReadyOriginal).mockImplementation(() => {
            view.setScope({ workspaceId: 'other', sceneKey: 'other' })
            return true
        })
        view.owner.rememberPartialImageTrackerForNode('thread', run, image())
        expect(view.owner.images.size).toBe(0)
    })

    it('stops completion callbacks when pruning replaces the scene', () => {
        const view = setup()
        vi.mocked(view.ports.forgetDecodedFrame).mockImplementation(() => view.setScope(null))
        view.owner.pruneApiCanvasRemovedGeneratedMediaTrackers(['image', 'other'])
        expect(view.ports.forgetDecodedFrame).toHaveBeenCalledOnce()
        expect(view.ports.clearCompletion).not.toHaveBeenCalled()
    })

    it('clears each instance independently and keeps destruction terminal', () => {
        const first = setup()
        const second = setup()
        first.owner.rememberPartialImageTrackerForNode('thread', run, image())
        second.owner.rememberPartialImageTrackerForNode('thread', run, image())
        first.owner.destroy()
        first.owner.clear()
        first.owner.rememberPartialImageTrackerForNode('thread', run, image())
        expect(first.owner.images.size).toBe(0)
        expect(second.owner.images.size).toBe(1)
        expect(first.owner.findGeneratedMediaNodeForRun('image', 'thread', run)).toBeUndefined()
    })
})
