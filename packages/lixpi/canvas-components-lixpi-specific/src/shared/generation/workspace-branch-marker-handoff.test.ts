import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type CanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type MediaRunLineageAssignment,
} from '@lixpi/constants'
import { createLixpiCanvasSettings } from '../../frontend/settings/canvas-settings.ts'
import { WorkspaceGeometry } from '../branch-tree-layout/workspace-geometry.ts'
import { WorkspaceLineageProjection } from '../branch-tree-layout/workspace-lineage-projection.ts'
import {
    type BranchMarkerNode,
} from '../branch-tree-layout/generated-media-rebalance.ts'
import { WorkspaceGenerationPlacements } from './workspace-generation-placements.ts'
import {
    WorkspaceBranchMarkerHandoff,
    type WorkspaceBranchMarkerHandoffPorts,
} from './workspace-branch-marker-handoff.ts'

const assignment: MediaRunLineageAssignment = {
    assetId: 'output',
    generationRequestId: 'request',
    branchId: 'branch',
    reasoningRunId: 'reasoning',
    reasoningModelId: 'provider:reasoning',
    branchOriginNodeId: 'origin',
    branchForkNodeId: 'fork',
    referenceAssetIds: [],
    referenceNodeIds: [],
    sourceContextNodeIds: [],
    promptText: 'planned prompt',
    createdAt: 1,
}
const run: MediaGenerationRunMeta = { requestKind: 'media-generation-matrix', generationRequestId: 'request', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', reasoningIndex: 0, lineageAssignment: assignment }

function pending(nodeId = 'pending'): BranchLineCanvasNode {
    return { nodeId, type: 'branchLine', branchId: 'branch', generationRequestId: 'request', conversationAssetId: 'thread', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', reasoningIndex: 0, position: { x: 10, y: 20 }, dimensions: { width: 100, height: 60 }, temporary: true, pendingState: { phase: 'preflight', promptText: 'draft prompt', reasoningModelId: 'provider:reasoning', reasoningIndex: 0 } } as BranchLineCanvasNode
}
function setup(nodes: CanvasNode[] = [pending()]) {
    let state: CanvasState | null = { nodes, edges: [{ edgeId: 'old-edge', sourceNodeId: 'source', targetNodeId: 'pending' }], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    const settings = createLixpiCanvasSettings()
    const origin: BranchOriginCanvasNode = { nodeId: 'origin', type: 'branchOrigin', branchId: 'branch', generationRequestId: 'request', position: { x: 100, y: 50 }, dimensions: { width: 100, height: 60 }, temporary: true }
    const lineagePlan: MediaBranchLineagePlan = {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId: 'request',
        branchId: 'branch',
        promptText: 'planned prompt',
        referenceAssetIds: [],
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        createdAt: 1,
        branchOrigin: { nodeId: 'origin', generationRequestId: 'request', branchId: 'branch', provenance: { promptText: 'planned prompt' } as NonNullable<MediaBranchLineagePlan['branchOrigin']>['provenance'] },
        branchForks: [{ nodeId: 'fork', branchId: 'branch', generationRequestId: 'request', parentBranchNodeId: 'origin', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', reasoningIndex: 0, provenance: { promptText: 'planned prompt' } as MediaBranchLineagePlan['branchForks'][number]['provenance'] }],
        branchLines: [],
        runAssignments: [assignment],
    }
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    placements.setPendingGeneratedMediaPlacement('thread', run, { promptText: 'draft prompt', createdAt: 1, lineagePlan })
    const record = { nodeId: 'pending', threadId: 'thread', placementKey: 'thread:request', reasoningModelId: 'provider:reasoning', reasoningIndex: 0 }
    placements.setPendingBranchMarkerRecordAliases('thread', run, record)
    const geometry = new WorkspaceGeometry({ workspaceId: 'workspace', settings, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getPaneSize: () => ({ width: 1000, height: 800 }), getWorldPosition: node => node.position, getWorldRect: node => ({ ...node.position, ...node.dimensions }), getLiveDimensions: () => undefined, isPending: () => false })
    const lineage = new WorkspaceLineageProjection({ readCanvasState: () => state, placements, geometry, settings: settings.mediaBranchLineage, getWorldPosition: node => node.position, getWorldRect: node => ({ ...node.position, ...node.dimensions }), resizeMarker: node => node })
    const ports: WorkspaceBranchMarkerHandoffPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        placements,
        lineage,
        geometry,
        resizeMarker: vi.fn(node => node),
        liveGeometry: vi.fn(node => node),
        isManuallyPositioned: vi.fn(() => false),
        preservePreview: vi.fn((_, node) => node),
        cleanup: vi.fn(ids => {
            for (const id of ids) {
                placements.deletePendingBranchMarkerAliasesForNodeId(id)
                placements.phases.delete(id)
            }
        }),
        clearProjection: vi.fn(),
        commit: vi.fn(value => {
            state = value
        }),
        syncMarker: vi.fn(),
        refreshConversation: vi.fn(),
        hasElement: () => true,
        debugHandoff: vi.fn(),
        log: vi.fn(),
    }
    const owner = new WorkspaceBranchMarkerHandoff(ports)
    return {
        owner,
        ports,
        placements,
        lineagePlan,
        origin,
        record,
        read: () => state!,
        setState: (value: CanvasState | null) => {
            state = value
        },
        setScope: (value: typeof scope) => {
            scope = value
        },
    }
}

describe('workspace branch marker handoff', () => {
    it('promotes a preflight marker to the API identity and retires its aliases and incident edges', () => {
        const { owner, read, placements, ports } = setup()
        owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        expect(read().nodes.map(node => node.nodeId)).toEqual(['fork', 'origin'])
        const marker = read().nodes[0] as BranchMarkerNode
        expect(marker.pendingState).toMatchObject({ phase: 'planned', promptText: 'draft prompt' })
        expect(read().edges.map(edge => edge.edgeId)).toEqual(['edge-origin-fork'])
        expect(placements.getPendingBranchMarkerRecord('thread', run)?.nodeId).toBe('fork')
        expect([...placements.markers.values()].some(record => record.nodeId === 'pending')).toBe(false)
        expect(placements.phases.get('fork')).toBe('planned-awaiting-media')
        expect(ports.preservePreview).toHaveBeenCalledWith('pending', expect.objectContaining({ nodeId: 'fork' }))
        expect(ports.refreshConversation).toHaveBeenCalledWith('thread')
    })

    it('reinstalls an API-planned marker when a store update dropped the transient owner', () => {
        const { owner, ports, read, placements } = setup([])
        owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        expect(read().nodes.map(node => node.nodeId).sort()).toEqual(['fork', 'origin'])
        expect((read().nodes.find(node => node.nodeId === 'fork') as BranchMarkerNode).pendingState?.promptText).toBe('planned prompt')
        expect(placements.getPendingBranchMarkerRecord('thread', run)?.nodeId).toBe('fork')
        expect(ports.commit).toHaveBeenCalledOnce()
    })

    it('reuses an existing regeneration parent without replacing its geometry or topology', () => {
        const view = setup()
        view.lineagePlan.regenerationTarget = { branchId: 'branch', lineageParentNodeId: 'origin', lineageParentType: 'branchOrigin' }
        view.setState({ ...view.read(), nodes: [view.origin] })
        view.owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.syncMarker).toHaveBeenCalledWith(view.origin)
        expect(view.placements.phases.get('origin')).toBe('planned-awaiting-media')
    })

    it('reports a missing regeneration parent without inventing one', () => {
        const view = setup([])
        view.lineagePlan.regenerationTarget = { branchId: 'branch', lineageParentNodeId: 'missing', lineageParentType: 'branchOrigin' }
        view.owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.log).toHaveBeenCalledWith('error', expect.stringContaining('parent is missing'), expect.any(Object))
        expect(view.read().nodes).toEqual([])
    })

    it('preserves live dragged geometry when clearing pending state', () => {
        const view = setup()
        vi.mocked(view.ports.liveGeometry).mockImplementation(node => ({ ...node, position: { x: 200, y: 300 }, dimensions: { width: 150, height: 80 } }))
        view.owner.clearPendingBranchMarkerStateForRun('thread', run, { preserveGeometry: true })
        expect(view.read().nodes[0]).toMatchObject({ position: { x: 200, y: 300 }, dimensions: { width: 150, height: 80 } })
        expect((view.read().nodes[0] as BranchMarkerNode).pendingState).toBeUndefined()
        expect(view.ports.resizeMarker).not.toHaveBeenCalled()
        expect(view.ports.clearProjection).toHaveBeenCalledWith('pending')
    })

    it('retains a manually positioned marker while applying its resized content dimensions', () => {
        const view = setup()
        vi.mocked(view.ports.isManuallyPositioned).mockReturnValue(true)
        vi.mocked(view.ports.liveGeometry).mockImplementation(node => ({ ...node, position: { x: 200, y: 300 } }))
        vi.mocked(view.ports.resizeMarker).mockImplementation(node => ({ ...node, position: { x: 0, y: 0 }, dimensions: { width: 160, height: 90 } }))
        view.owner.clearPendingBranchMarkerStateForRun('thread', run)
        expect(view.read().nodes[0]).toMatchObject({ position: { x: 200, y: 300 }, dimensions: { width: 160, height: 90 } })
        expect(view.ports.syncMarker).toHaveBeenCalledWith(view.read().nodes[0])
    })

    it('removes only the pending owner and its edges when its run ends', () => {
        const view = setup([pending(), { ...pending('other'), generationRequestId: 'other-request', conversationAssetId: 'other' }])
        view.owner.removePendingBranchMarkerForRun('thread', run)
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['other'])
        expect(view.read().edges).toEqual([])
        expect(view.ports.cleanup).toHaveBeenCalledWith(['pending'])
    })

    it('does not remove a settled marker when forgetting its run record', () => {
        const node = { ...pending(), pendingState: undefined }
        const view = setup([node])
        view.owner.removePendingBranchMarkerForRun('thread', run)
        expect(view.read().nodes).toEqual([node])
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.placements.markers.size).toBe(0)
    })

    it('cleans up an orphan transient owner when no placement alias survives', () => {
        const node = { ...pending(), generationRequestId: 'thread', conversationAssetId: undefined }
        const view = setup([node])
        view.placements.markers.clear()
        view.owner.removePendingBranchMarkerForRun('thread', undefined)
        expect(view.read().nodes).toEqual([])
        expect(view.ports.cleanup).toHaveBeenCalledWith(['pending'])
    })

    it('stops promotion if cleanup replaces the workspace scope', () => {
        const view = setup()
        vi.mocked(view.ports.cleanup).mockImplementation(() => {
            view.placements.clear()
            view.setScope({ workspaceId: 'other', sceneKey: 'other-scene' })
        })
        view.owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.refreshConversation).not.toHaveBeenCalled()
        expect(view.placements.markers.size).toBe(0)
        expect(view.placements.phases.size).toBe(0)
    })

    it('suppresses post-commit content callbacks after scene replacement', () => {
        const view = setup()
        vi.mocked(view.ports.commit).mockImplementation(() => {
            view.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' })
        })
        view.owner.clearPendingBranchMarkerStateForRun('thread', run)
        expect(view.ports.commit).toHaveBeenCalledOnce()
        expect(view.ports.syncMarker).not.toHaveBeenCalled()
        expect(view.ports.refreshConversation).not.toHaveBeenCalled()
    })

    it('does not mutate a disposed scope', () => {
        const view = setup()
        view.setScope(null)
        view.owner.resolvePendingBranchMarkerWithLineagePlan('thread', run)
        view.owner.clearPendingBranchMarkerStateForRun('thread', run)
        view.owner.removePendingBranchMarkerForRun('thread', run)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.cleanup).not.toHaveBeenCalled()
        expect(view.placements.phases.size).toBe(0)
    })

    it('groups pending display metadata by API marker while preserving separate image and video selections', () => {
        const view = setup()
        const image = { ...assignment, mediaRunId: 'image-run', mediaModelId: 'provider:image', mediaType: 'image' as const }
        const video = { ...assignment, mediaRunId: 'video-run', mediaModelId: 'provider:video', mediaType: 'video' as const }
        view.lineagePlan.runAssignments = [image, video, image]
        const specs = view.owner.buildPendingBranchMarkerSpecsFromLineagePlan(view.lineagePlan)
        expect(specs).toHaveLength(1)
        expect(specs[0].pendingState).toMatchObject({ promptText: 'planned prompt', reasoningModelIds: ['provider:reasoning'], imageModelIds: ['provider:image'], videoModelIds: ['provider:video'] })
        expect(specs[0].generationRun?.lineageAssignment).toBe(image)
        expect(view.lineagePlan.runAssignments).toEqual([image, video, image])
    })

    it('keeps an empty lineage plan representable without fabricating provider selections', () => {
        const view = setup()
        view.lineagePlan.runAssignments = []
        const specs = view.owner.buildPendingBranchMarkerSpecsFromLineagePlan(view.lineagePlan)
        expect(specs).toEqual([{ pendingState: { phase: 'preflight', promptText: 'planned prompt', reasoningModelIds: [], imageModelIds: [], videoModelIds: [] } }])
    })
})
