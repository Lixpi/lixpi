import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    CanvasState,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
} from '@lixpi/constants'
import type { BranchMarkerNode } from '../branch-tree-layout/generated-media-rebalance.ts'
import { WorkspaceGenerationPlacements } from './workspace-generation-placements.ts'
import {
    WorkspaceGenerationSettlement,
    type WorkspaceGenerationSettlementPorts,
} from './workspace-generation-settlement.ts'

const run: MediaGenerationRunMeta = {
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request',
    reasoningRunId: 'reasoning',
    reasoningModelId: 'provider:reasoning',
    reasoningIndex: 0,
    mediaRunId: 'media',
}

function marker(nodeId: string, generationRequestId = 'request', threadId = 'thread'): BranchMarkerNode {
    return {
        type: 'branchLine',
        nodeId,
        generationRequestId,
        conversationAssetId: threadId,
        branchId: 'branch',
        position: { x: 10, y: 20 },
        dimensions: { width: 100, height: 60 },
        temporary: true,
        pendingState: { phase: 'preflight', promptText: 'prompt', reasoningIndex: 0 },
    }
}

function setup(nodes: CanvasNode[] = []) {
    let state: CanvasState = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let scope: { workspaceId: string; sceneKey: string } | null = { workspaceId: 'workspace', sceneKey: 'scene' }
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const ports: WorkspaceGenerationSettlementPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        placements,
        lineage: {
            getUniqueLineageAssignmentsForMarkers: plan => plan.runAssignments,
            buildGenerationRunFromLineageAssignment: (plan, assignment) => ({ ...run, generationRequestId: plan.generationRequestId, mediaRunId: assignment.mediaRunId }),
        },
        handoff: {
            resolvePendingBranchMarkerWithLineagePlan: vi.fn(),
            clearPendingBranchMarkerStateForRun: vi.fn(),
            forgetPendingBranchMarkerRecordForRun: vi.fn(),
            stripPendingBranchMarkerState: node => {
                const { pendingState, ...settled } = node
                return settled
            },
        },
        preflight: { insertPendingBranchMarkersFromLineagePlan: vi.fn() },
        setReferences: vi.fn(),
        clearReferences: vi.fn(),
        scheduleConversationRefresh: vi.fn(),
        refreshConversation: vi.fn(),
        settleConversation: vi.fn(),
        scheduleTeardown: vi.fn(),
        cleanup: vi.fn(ids => {
            for (const id of ids) {
                placements.deletePendingBranchMarkerAliasesForNodeId(id)
                placements.phases.delete(id)
            }
        }),
        commit: vi.fn(value => {
            state = value
        }),
        syncMedia: vi.fn(),
        liveGeometry: vi.fn(node => ({ ...node, position: { x: 30, y: 40 }, dimensions: { width: 240, height: 80 } })),
        resizeMarker: vi.fn(node => ({ ...node, position: { x: 50, y: 60 }, dimensions: { width: 300, height: 90 } })),
        isManuallyPositioned: vi.fn(() => false),
        syncMarker: vi.fn(),
        log: vi.fn(),
    }
    return {
        owner: new WorkspaceGenerationSettlement(ports),
        ports,
        placements,
        read: () => state,
        setScope: (value: typeof scope) => {
            scope = value
        },
        setState: (value: CanvasState) => {
            state = value
        },
        seed: (keys = ['media']) => {
            placements.placements.set('thread', { promptText: 'prompt', createdAt: 1 })
            placements.placements.set('thread:request', { promptText: 'prompt', createdAt: 1, activeRunKeys: new Set(keys) })
        },
    }
}

function plan(): MediaBranchLineagePlan {
    return {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId: 'request',
        branchId: 'branch',
        promptText: 'prompt',
        referenceAssetIds: [],
        referenceNodeIds: ['reference'],
        sourceContextNodeIds: [],
        createdAt: 1,
        branchForks: [],
        branchLines: [],
        runAssignments: [{
            generationRequestId: 'request',
            branchId: 'branch',
            assetId: 'output',
            branchLineNodeId: 'line',
            reasoningRunId: 'reasoning',
            mediaRunId: 'media',
            reasoningModelId: 'provider:reasoning',
            promptText: 'prompt',
            referenceAssetIds: [],
            referenceNodeIds: ['reference'],
            sourceContextNodeIds: [],
            createdAt: 1,
        }],
    }
}

describe('workspace generation settlement', () => {
    it('replaces a reasoning run with its media run while retaining other active siblings', () => {
        const view = setup()
        view.seed(['reasoning', 'sibling'])
        view.owner.registerGeneratedMediaRun('thread', run)
        view.owner.registerGeneratedMediaRun('thread', run)
        expect([...view.placements.placements.get('thread:request')!.activeRunKeys!]).toEqual(['sibling', 'media'])
        expect(view.ports.settleConversation).not.toHaveBeenCalled()
    })

    it('keeps shared placement and references until the last media run completes', () => {
        const view = setup()
        view.seed(['media', 'sibling', 'reasoning'])
        view.owner.finishGeneratedMediaRun('thread', run)
        expect([...view.placements.placements.get('thread:request')!.activeRunKeys!]).toEqual(['sibling'])
        expect(view.placements.placements.has('thread')).toBe(true)
        expect(view.ports.clearReferences).not.toHaveBeenCalled()
        expect(view.ports.handoff.clearPendingBranchMarkerStateForRun).toHaveBeenCalledWith('thread', run)
        expect(view.ports.scheduleTeardown).not.toHaveBeenCalled()
    })

    it('removes late preflight nodes and incident edges when the last run completes', () => {
        const view = setup([marker('late', 'thread'), marker('other', 'other-request', 'other-thread')])
        view.seed()
        view.setState({ ...view.read(), edges: [{ edgeId: 'edge', sourceNodeId: 'late', targetNodeId: 'other' }] })
        view.placements.markers.set('thread:reasoning-index:0', { nodeId: 'late', placementKey: 'thread', threadId: 'thread' })
        view.owner.finishGeneratedMediaRun('thread', run)
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['other'])
        expect(view.read().edges).toEqual([])
        expect(view.placements.placements.size).toBe(0)
        expect(view.placements.markers.size).toBe(0)
        expect(view.ports.clearReferences).toHaveBeenCalledWith('thread:request')
        expect(view.ports.clearReferences).toHaveBeenCalledWith('thread')
        expect(view.ports.syncMedia).toHaveBeenCalledWith(view.read())
        expect(view.ports.settleConversation).toHaveBeenCalledWith('thread')
        expect(view.ports.scheduleTeardown).toHaveBeenCalledWith('thread')
    })

    it('settles an unversioned failed run without retaining a hidden conversation editor', () => {
        const view = setup()
        view.placements.placements.set('thread', { promptText: 'prompt', createdAt: 1 })
        view.owner.finishFailedGeneratedMediaRun('thread')
        expect(view.placements.placements.size).toBe(0)
        expect(view.ports.settleConversation).toHaveBeenCalledOnce()
        expect(view.ports.scheduleTeardown).toHaveBeenCalledOnce()
    })

    it('settles only the completed run while leaving its request and siblings active', () => {
        const view = setup()
        view.seed(['media', 'sibling'])
        view.owner.settleMediaGenerationRun('thread', run)
        expect(view.ports.handoff.forgetPendingBranchMarkerRecordForRun).toHaveBeenCalledWith('thread', run)
        expect(view.placements.placements.has('thread:request')).toBe(true)
        expect(view.ports.settleConversation).not.toHaveBeenCalled()
    })

    it('preserves live geometry when request settlement explicitly requires it', () => {
        const view = setup([marker('line'), marker('other', 'other-request')])
        view.placements.phases.set('line', 'planned-awaiting-media')
        view.owner.settleBranchMarkersForGenerationRequest('request', { preserveGeometry: true })
        expect(view.read().nodes[0]).toMatchObject({ position: { x: 30, y: 40 }, dimensions: { width: 240, height: 80 } })
        expect((view.read().nodes[0] as BranchMarkerNode).pendingState).toBeUndefined()
        expect((view.read().nodes[1] as BranchMarkerNode).pendingState).toBeDefined()
        expect(view.ports.resizeMarker).not.toHaveBeenCalled()
        expect(view.placements.phases.has('line')).toBe(false)
    })

    it('resizes settled content without moving a manually positioned marker', () => {
        const view = setup([marker('line')])
        vi.mocked(view.ports.isManuallyPositioned).mockReturnValue(true)
        view.owner.settleBranchMarkersForGenerationRequest('request')
        expect(view.read().nodes[0]).toMatchObject({ position: { x: 30, y: 40 }, dimensions: { width: 300, height: 90 } })
    })

    it('refreshes a settled marker that still has a tracked progress phase without committing geometry', () => {
        const node = marker('line')
        delete node.pendingState
        const view = setup([node])
        view.placements.phases.set('line', 'planned-awaiting-media')
        view.owner.settleBranchMarkersForGenerationRequest('request')
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.syncMarker).toHaveBeenCalledWith(node)
        expect(view.placements.phases.size).toBe(0)
    })

    it('sweeps unrecorded preflight markers without removing tracked markers or another conversation', () => {
        const view = setup([marker('orphan'), marker('tracked'), marker('other', 'request', 'other-thread')])
        view.placements.markers.set('thread', { nodeId: 'tracked', placementKey: 'thread', threadId: 'thread' })
        view.owner.cleanupOrphanPreflightMarkersForThread('thread')
        expect(view.read().nodes.map(node => node.nodeId)).toEqual(['tracked', 'other'])
        expect(view.ports.cleanup).toHaveBeenCalledWith(['orphan'])
    })

    it('applies lineage references but waits for API marker geometry before handoff', () => {
        const view = setup()
        const lineage = plan()
        view.owner.applyMediaBranchLineagePlan('thread', lineage, run)
        expect(view.placements.placements.get('thread:request')?.lineagePlan).toBe(lineage)
        expect(view.ports.setReferences).toHaveBeenCalledWith('thread:request', ['reference'])
        expect(view.ports.preflight.insertPendingBranchMarkersFromLineagePlan).toHaveBeenCalledWith('thread', lineage, run)
        expect(view.ports.handoff.resolvePendingBranchMarkerWithLineagePlan).not.toHaveBeenCalled()
    })

    it('reuses the API regeneration parent without inserting a new preflight marker', () => {
        const view = setup()
        const lineage = plan()
        lineage.regenerationTarget = { branchId: 'branch', lineageParentNodeId: 'line', lineageParentType: 'branchLine' }
        view.owner.applyMediaBranchLineagePlan('thread', lineage, run)
        expect(view.ports.preflight.insertPendingBranchMarkersFromLineagePlan).not.toHaveBeenCalled()
        expect(view.ports.handoff.resolvePendingBranchMarkerWithLineagePlan).toHaveBeenCalledWith('thread', run)
    })

    it('settles every planned run and removes the request and initial placement aliases', () => {
        const view = setup([marker('late', 'thread')])
        view.seed(['media', 'sibling'])
        const lineage = plan()
        lineage.runAssignments.push({ ...lineage.runAssignments[0], mediaRunId: 'sibling', branchLineNodeId: 'sibling-marker' })
        view.placements.placements.get('thread:request')!.lineagePlan = lineage
        view.owner.settleMediaGenerationRequest('thread', 'request', run, { preserveGeometry: true })
        expect(view.ports.handoff.clearPendingBranchMarkerStateForRun).toHaveBeenCalledWith('thread', expect.objectContaining({ mediaRunId: 'sibling' }), { preserveGeometry: true })
        expect(view.placements.placements.size).toBe(0)
        expect(view.read().nodes).toEqual([])
        expect(view.ports.scheduleTeardown).toHaveBeenCalledOnce()
    })

    it('stops publication when cleanup replaces the scene', () => {
        const view = setup([marker('late', 'thread')])
        view.seed()
        vi.mocked(view.ports.cleanup).mockImplementation(() => view.setScope({ workspaceId: 'other', sceneKey: 'other' }))
        view.owner.finishGeneratedMediaRun('thread', run)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.syncMedia).not.toHaveBeenCalled()
        expect(view.ports.settleConversation).not.toHaveBeenCalled()
    })

    it('does not render prepared markers or settle an editor after a reentrant commit replaces the scene', () => {
        const view = setup([marker('line')])
        view.seed()
        vi.mocked(view.ports.commit).mockImplementation(() => view.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' }))
        view.owner.settleMediaGenerationRequest('thread', 'request', run)
        expect(view.ports.syncMarker).not.toHaveBeenCalled()
        expect(view.ports.syncMedia).not.toHaveBeenCalled()
        expect(view.ports.settleConversation).not.toHaveBeenCalled()
    })

    it('ignores all settlement work when its renderer is closed', () => {
        const view = setup([marker('line')])
        view.seed()
        view.setScope(null)
        view.owner.finishGeneratedMediaRun('thread', run)
        view.owner.settleMediaGenerationRequest('thread', 'request', run)
        view.owner.clearPendingGeneratedMediaPlacementsForThread('thread')
        expect(view.placements.placements.size).toBe(2)
        expect(view.ports.commit).not.toHaveBeenCalled()
        expect(view.ports.settleConversation).not.toHaveBeenCalled()
    })

    it('keeps placement cleanup local to one conversation and one canvas instance', () => {
        const first = setup([marker('line')])
        const second = setup([marker('line')])
        first.seed()
        second.seed()
        first.placements.placements.set('thread-other:request', { promptText: 'other', createdAt: 1 })
        first.owner.clearPendingGeneratedMediaPlacementsForThread('thread')
        expect([...first.placements.placements.keys()]).toEqual(['thread-other:request'])
        expect(second.placements.placements.size).toBe(2)
        expect(second.ports.clearReferences).not.toHaveBeenCalled()
    })
})
