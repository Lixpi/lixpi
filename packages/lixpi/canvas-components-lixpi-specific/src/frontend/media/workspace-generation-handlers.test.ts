import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    CanvasState,
    ImageCanvasNode,
    MediaGenerationRunMeta,
    MediaRunLineageAssignment,
} from '@lixpi/constants'
import {
    CanvasGenerationEvents,
    type CanvasMediaSegment,
} from '../../shared/generation/canvas-generation-events.ts'
import { WorkspaceGenerationPlacements } from '../../shared/generation/workspace-generation-placements.ts'
import { WorkspaceMediaTrackers } from '../../shared/generation/workspace-media-trackers.ts'
import { applyCanvasGeometryUpdateToState } from '../../shared/canvas-node/canvas-geometry-update.ts'
import { getPendingGeneratedMediaNodeId } from '../../shared/branch-tree-layout/pending-media-node-id.ts'
import {
    WorkspaceGenerationHandlers,
    type WorkspaceGenerationHandlersPorts,
} from './workspace-generation-handlers.ts'

const assignment: MediaRunLineageAssignment = {
    assetId: 'asset',
    generationRequestId: 'request',
    branchId: 'branch',
    reasoningRunId: 'reasoning',
    reasoningModelId: 'provider:reasoning',
    mediaRunId: 'media',
    mediaType: 'image',
    mediaModelId: 'provider:image',
    branchLineNodeId: 'line',
    lineageParentNodeId: 'line',
    referenceAssetIds: [],
    referenceNodeIds: [],
    sourceContextNodeIds: [],
    promptText: 'prompt',
    createdAt: 1,
}
const run: MediaGenerationRunMeta = {
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request',
    reasoningRunId: 'reasoning',
    reasoningModelId: 'provider:reasoning',
    reasoningIndex: 0,
    mediaRunId: 'media',
    mediaType: 'image',
    mediaModelId: 'provider:image',
    lineageAssignment: assignment,
}
const nodeId = getPendingGeneratedMediaNodeId(assignment)
const owners: WorkspaceGenerationHandlers[] = []
const ownedEvents: CanvasGenerationEvents[] = []
const callbackErrors: unknown[] = []
afterEach(async () => {
    await Promise.resolve()
    for (const owner of owners.splice(0)) owner.destroy()
    for (const events of ownedEvents.splice(0)) events.destroy()
    expect(callbackErrors.splice(0)).toEqual([])
})
function image(): ImageCanvasNode {
    return { type: 'image', nodeId, assetId: 'asset', position: { x: 10, y: 20 }, dimensions: { width: 300, height: 200 }, mediaGenerationPhase: 'pending-before-first-frame', generatedBy: { ...assignment, conversationAssetId: 'thread', responseId: 'response', aiModel: 'provider:reasoning', revisedPrompt: 'prompt' } }
}
function event(type: string, overrides: Partial<CanvasMediaSegment> = {}): CanvasMediaSegment {
    return { type, workspaceId: 'workspace', conversationAssetId: 'thread', generationRun: run, ...overrides }
}
function setup(nodes: CanvasNode[] = [], sharedEvents?: CanvasGenerationEvents) {
    const events = sharedEvents ?? new CanvasGenerationEvents(error => callbackErrors.push(error))
    if (!sharedEvents) ownedEvents.push(events)
    let state: CanvasState = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    const order: string[] = []
    const finalizing = new Set<string>()
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const trackers = new WorkspaceMediaTrackers({ readScope: () => scope, readCanvasState: () => state, placements, hasDecodedFrame: () => false, hasReadyOriginal: () => false, forgetDecodedFrame: () => {}, clearCompletion: () => {}, debug: () => {} })
    const ports: WorkspaceGenerationHandlersPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        readThreads: () => [{ threadId: 'thread' }],
        placements,
        trackers,
        settlement: { applyMediaBranchLineagePlan: vi.fn(), settleMediaGenerationRun: vi.fn(), settleMediaGenerationRequest: vi.fn(), registerGeneratedMediaRun: vi.fn(), finishGeneratedMediaRun: vi.fn(), finishFailedGeneratedMediaRun: vi.fn() },
        handoff: { removePendingBranchMarkerForRun: vi.fn(), clearPendingBranchMarkerStateForRun: vi.fn(), resolvePendingBranchMarkerWithLineagePlan: vi.fn() },
        lineage: {
            getExistingMediaNodeIds: ids => [...ids].filter((id): id is string => Boolean(id && state.nodes.some(node => node.nodeId === id))),
            ensureBranchOriginForGeneratedMedia: () => undefined,
            ensureBranchMarkerForGeneratedMedia: () => ({ branchForkNode: undefined, branchLineNode: undefined, markerNode: undefined }),
            getGeneratedMediaEdgeSourceNode: () => undefined,
            getNextGeneratedMediaPosition: () => ({ x: 0, y: 0 }),
            addBranchLineageMarkerNodesIfMissing: nodes => nodes,
            addBranchMarkerEdgeIfMissing: edges => edges,
            createGeneratedImageEdge: (source, target) => ({ edgeId: 'edge', sourceNodeId: source.nodeId, targetNodeId: target }),
        },
        geometry: { getGeneratedMediaInsertionSize: () => 300 },
        apiGeometry: {
            applyApiCanvasGeometry: vi.fn(update => {
                state = applyCanvasGeometryUpdateToState(state, update).state
            }),
        },
        recovery: { revision: () => 1 },
        analysis: { refreshCompleted: vi.fn(async () => {}) },
        visuals: {
            isFinalizing: id => finalizing.has(id),
            keepCompletion: vi.fn((_, __, node) => {
                finalizing.add(node.nodeId)
            }),
        },
        refreshAsset: vi.fn(async () => {}),
        reloadWorkspace: vi.fn(async () => {}),
        applyCapabilityRunEventToBranchMarkers: vi.fn(),
        handleWorkspaceContextResolution: vi.fn(),
        setGeneratingReferenceNodeIds: vi.fn(),
        clearGeneratingReferenceNodeIds: vi.fn(),
        clearGeneratingReferencesAfterPromptHandoff: vi.fn(),
        clearGeneratingReferencesOnFirstPixels: vi.fn(),
        settleDetachedCanvasRun: vi.fn(),
        scheduleDetachedCanvasRunTeardown: vi.fn(),
        applyMediaOperationRecoveryResult: vi.fn(),
        syncGeneratingMediaNodes: vi.fn(() => {
            order.push('outlines')
        }),
        syncCanvasMediaLayer: vi.fn(() => {
            order.push('media')
        }),
        syncCanvasNodeDomGeometry: vi.fn(() => {
            order.push('geometry')
        }),
        setTransientImageSource: vi.fn(() => {
            order.push('pixels')
        }),
        renderNow: vi.fn(() => {
            order.push('render')
        }),
        removeSelection: vi.fn(),
        rebalanceGeneratedMediaTrees: vi.fn(nodes => nodes),
        commitTransientCanvasStatePreservingEditors: vi.fn(value => {
            state = value
        }),
        appendCanvasNodeToDOM: vi.fn(),
        appendBranchMarkerNodeToDOM: vi.fn(),
        hasNodeElement: () => true,
        debugLoggingEnabled: false,
        debugGeneratedMediaLifecycle: vi.fn(),
        log: vi.fn(),
    }
    const owner = new WorkspaceGenerationHandlers(events, ports)
    owners.push(owner)
    return {
        owner,
        ports,
        events,
        trackers,
        placements,
        order,
        read: () => state,
        setScope: (value: typeof scope) => {
            scope = value
        },
    }
}

describe('workspace generation handlers', () => {
    it('rejects another workspace before applying geometry or creating trackers', () => {
        const view = setup()
        view.events.route(event('image_partial', { workspaceId: 'other', imageUrl: 'frame', canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [image()] } }))
        expect(view.ports.apiGeometry.applyApiCanvasGeometry).not.toHaveBeenCalled()
        expect(view.ports.settlement.registerGeneratedMediaRun).not.toHaveBeenCalled()
        expect(view.trackers.images.size).toBe(0)
    })

    it('rejects an unknown conversation in the active workspace', () => {
        const view = setup()
        view.events.route(event('image_generation_trace', { conversationAssetId: 'other' }))
        expect(view.ports.settlement.registerGeneratedMediaRun).not.toHaveBeenCalled()
    })

    it('publishes first-frame outline state before pixels and then synchronizes geometry and rendering', () => {
        const view = setup()
        view.events.route(event('image_partial', { imageUrl: 'frame', assetId: 'asset', canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [image()] } }))
        expect(view.trackers.images.get('media')).toMatchObject({ nodeId, hasReceivedFrame: true })
        expect(view.order).toEqual(['outlines', 'pixels', 'media', 'geometry', 'render'])
        expect(view.ports.clearGeneratingReferencesOnFirstPixels).toHaveBeenCalledWith('thread', run)
        expect(view.ports.rebalanceGeneratedMediaTrees).not.toHaveBeenCalled()
    })

    it('refuses partial media without API geometry rather than inventing canvas topology', () => {
        const view = setup()
        view.events.route(event('image_partial', { imageUrl: 'frame', assetId: 'asset' }))
        expect(view.trackers.images.size).toBe(0)
        expect(view.ports.commitTransientCanvasStatePreservingEditors).not.toHaveBeenCalled()
        expect(view.ports.log).toHaveBeenCalledWith('error', expect.stringContaining('missing image partial geometry'), expect.any(Object))
    })

    it('handles an empty partial as a heartbeat without creating a placeholder', () => {
        const view = setup()
        view.events.route(event('image_partial'))
        expect(view.ports.syncGeneratingMediaNodes).toHaveBeenCalledOnce()
        expect(view.ports.commitTransientCanvasStatePreservingEditors).not.toHaveBeenCalled()
        expect(view.trackers.images.size).toBe(0)
    })

    it('keeps completion visuals through final texture handoff and refreshes the completed Asset', () => {
        const view = setup([image()])
        view.trackers.rememberPartialImageTrackerForNode('thread', run, image())
        view.events.route(event('image_complete', { assetId: 'asset', canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [{ ...image(), mediaGenerationPhase: 'ready' }] } }))
        expect(view.ports.visuals.keepCompletion).toHaveBeenCalledOnce()
        expect(view.ports.setTransientImageSource).toHaveBeenCalledWith(nodeId, null)
        expect(view.ports.appendCanvasNodeToDOM).toHaveBeenCalledWith(view.read().nodes[0])
        expect(view.ports.settlement.finishGeneratedMediaRun).toHaveBeenCalledWith('thread', run)
        expect(view.ports.analysis.refreshCompleted).toHaveBeenCalledWith(view.read().nodes[0])
    })

    it('can complete an already materialized image without replaying its geometry', () => {
        const view = setup([image()])
        view.events.route(event('image_complete', { assetId: 'asset' }))
        expect(view.ports.apiGeometry.applyApiCanvasGeometry).not.toHaveBeenCalled()
        expect(view.ports.settlement.finishGeneratedMediaRun).toHaveBeenCalledWith('thread', run)
        expect(view.ports.reloadWorkspace).not.toHaveBeenCalled()
    })

    it('reloads the originating workspace when completion has no geometry or existing final node', () => {
        const view = setup()
        view.events.route(event('image_complete', { assetId: 'asset' }))
        expect(view.ports.reloadWorkspace).toHaveBeenCalledWith('workspace')
        expect(view.ports.commitTransientCanvasStatePreservingEditors).not.toHaveBeenCalled()
        expect(view.ports.settlement.finishGeneratedMediaRun).not.toHaveBeenCalled()
    })

    it('waits for API geometry before installing a video tracker', () => {
        const view = setup()
        const videoRun = { ...run, mediaType: 'video' as const, lineageAssignment: { ...assignment, mediaType: 'video' as const } }
        view.events.route(event('video_pending', { generationRun: videoRun }))
        expect(view.trackers.videos.size).toBe(0)
        const videoNodeId = getPendingGeneratedMediaNodeId(videoRun.lineageAssignment)
        const video = { ...image(), nodeId: videoNodeId, type: 'video' } as CanvasNode
        view.events.route(event('video_pending', { generationRun: videoRun, canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [video] } }))
        expect(view.trackers.videos.get('media')?.nodeId).toBe(videoNodeId)
        expect(view.ports.appendCanvasNodeToDOM).toHaveBeenCalledWith(video)
    })

    it('permits cancelled-request removal geometry while rejecting its late additions', () => {
        const view = setup([image()])
        view.placements.cancelledRequests.add('request')
        const canvasGeometry = { layoutRevision: 1, generationRequestId: 'request', nodes: [] }
        view.events.route(event('canvas_geometry_resolved', { canvasGeometry }))
        expect(view.ports.apiGeometry.applyApiCanvasGeometry).not.toHaveBeenCalled()
        view.events.route(event('canvas_geometry_resolved', { canvasGeometry: { ...canvasGeometry, removedNodeIds: [nodeId] } }))
        expect(view.read().nodes).toEqual([])
    })

    it('settles only a skipped matrix child and waits for request completion to settle siblings', () => {
        const view = setup()
        view.events.route(event('media_generation_skipped', { generationRequestId: 'request' }))
        expect(view.ports.settlement.settleMediaGenerationRun).toHaveBeenCalledWith('thread', run)
        expect(view.ports.settlement.settleMediaGenerationRequest).not.toHaveBeenCalled()
        view.events.route(event('media_generation_request_complete', { generationRequestId: 'request' }))
        expect(view.ports.settlement.settleMediaGenerationRequest).toHaveBeenCalledWith('thread', 'request', run)
    })

    it('does not attach pixels after outline publication replaces the scene', () => {
        const view = setup()
        vi.mocked(view.ports.syncGeneratingMediaNodes).mockImplementation(() => view.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' }))
        view.events.route(event('image_partial', { imageUrl: 'frame', canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [image()] } }))
        expect(view.ports.setTransientImageSource).not.toHaveBeenCalled()
        expect(view.ports.renderNow).not.toHaveBeenCalled()
    })

    it('stops tracker and node mutation when API geometry changes the workspace', () => {
        const view = setup()
        vi.mocked(view.ports.apiGeometry.applyApiCanvasGeometry).mockImplementation(() => view.setScope({ workspaceId: 'other', sceneKey: 'other' }))
        view.events.route(event('image_partial', { imageUrl: 'frame', canvasGeometry: { layoutRevision: 1, nodes: [], nodeSnapshots: [image()] } }))
        expect(view.trackers.images.size).toBe(0)
        expect(view.ports.appendCanvasNodeToDOM).not.toHaveBeenCalled()
    })

    it('removes its own subscriptions without interrupting another canvas sharing the event source', () => {
        const events = new CanvasGenerationEvents(() => {})
        const first = setup([], events)
        const second = setup([], events)
        first.owner.destroy()
        first.owner.destroy()
        events.route(event('image_generation_trace'))
        expect(first.ports.settlement.registerGeneratedMediaRun).not.toHaveBeenCalled()
        expect(second.ports.settlement.registerGeneratedMediaRun).toHaveBeenCalledOnce()
        second.owner.destroy()
        events.destroy()
    })
})
