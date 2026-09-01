import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    BranchLineCanvasNode,
    CanvasNode,
    MediaGenerationRunMeta,
} from '@lixpi/constants'
import {
    WorkspaceGenerationPlacements,
    type PendingGeneratedImagePlacement,
} from './workspace-generation-placements.ts'

function marker(nodeId: string, reasoningIndex: number): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        conversationAssetId: 'thread',
        generationRequestId: 'request',
        branchId: 'branch',
        parentBranchNodeId: 'parent',
        reasoningRunId: `reasoning-${reasoningIndex}`,
        reasoningModelId: `provider:model-${reasoningIndex}`,
        reasoningIndex,
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 80 },
        pendingState: { phase: 'preflight', promptText: 'prompt', reasoningIndex, reasoningModelId: `provider:model-${reasoningIndex}` },
    } as BranchLineCanvasNode
}
const run = (values: Partial<MediaGenerationRunMeta> = {}): MediaGenerationRunMeta => ({ generationRequestId: 'request', ...values } as MediaGenerationRunMeta)
function setup(nodes: CanvasNode[] = []) {
    const started = new Set<string>()
    const owner = new WorkspaceGenerationPlacements({
        readCanvasState: () => ({ nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
        hasStartedMedia: id => started.has(id),
    })
    return { owner, started }
}

describe('workspace generation placements', () => {
    it('distinguishes request placement keys and prefers the media run identity', () => {
        const { owner } = setup()
        expect(owner.getGeneratedMediaPlacementKey('thread')).toBe('thread')
        expect(owner.getGeneratedMediaPlacementKey('thread', run())).toBe('thread:request')
        expect(owner.getGeneratedMediaRunKey('thread', run({ mediaRunId: 'media', reasoningRunId: 'reasoning' }))).toBe('media')
        expect(owner.getGeneratedMediaRunKey('thread', run({ reasoningRunId: 'reasoning' }))).toBe('reasoning')
    })

    it('copies run sets when a preflight thread placement is adopted by a request', () => {
        const { owner } = setup()
        const seed: PendingGeneratedImagePlacement = { promptText: 'prompt', createdAt: 1, activeRunKeys: new Set(['reasoning']), promptHandoffRunKeys: new Set(['handoff']) }
        owner.placements.set('thread', seed)
        const adopted = owner.ensurePendingGeneratedMediaPlacementForApiRun('thread', run())!
        adopted.activeRunKeys!.add('media')
        adopted.promptHandoffRunKeys!.clear()
        expect(seed.activeRunKeys).toEqual(new Set(['reasoning']))
        expect(seed.promptHandoffRunKeys).toEqual(new Set(['handoff']))
        expect(owner.ensurePendingGeneratedMediaPlacementForApiRun('thread', run())).toBe(adopted)
    })

    it('recovers a persisted marker by explicit lineage before fallback reasoning metadata', () => {
        const { owner } = setup([marker('one', 0), marker('two', 1)])
        const generationRun = run({ reasoningIndex: 0, lineageAssignment: { branchLineNodeId: 'two' } as MediaGenerationRunMeta['lineageAssignment'] })
        const record = owner.getPendingBranchMarkerRecord('thread', generationRun)
        expect(record?.nodeId).toBe('two')
        expect(owner.markers.get('thread:request:marker:two')?.nodeId).toBe('two')
    })

    it.each([
        { reasoningRunId: 'reasoning-1' },
        { reasoningIndex: 1 },
        { reasoningModelId: ' PROVIDER:MODEL-1 ' },
    ])('recovers a persisted marker by run metadata %o', values => {
        const { owner } = setup([marker('one', 0), marker('two', 1)])
        expect(owner.getPendingBranchMarkerRecord('thread', run(values as Partial<MediaGenerationRunMeta>))?.nodeId).toBe('two')
    })

    it('does not pick an arbitrary persisted marker when the request is ambiguous', () => {
        const { owner } = setup([marker('one', 0), marker('two', 1)])
        expect(owner.getPendingBranchMarkerRecord('thread', run())).toBeUndefined()
        expect(owner.markers.size).toBe(0)
    })

    it('ignores committed markers and markers for a different conversation during recovery', () => {
        const other = { ...marker('other', 0), conversationAssetId: 'other' }
        const committed = { ...marker('committed', 0), pendingState: undefined }
        const { owner } = setup([other, committed])
        expect(owner.recoverPendingBranchMarkerRecordFromCanvasState('thread', run())).toBeUndefined()
    })

    it('migrates matching preflight aliases without consuming a sibling reasoning slot', () => {
        const { owner } = setup()
        owner.markers.set('thread:reasoning-index:0', { nodeId: 'one', placementKey: 'thread', threadId: 'thread', reasoningIndex: 0 })
        owner.markers.set('thread:reasoning-index:1', { nodeId: 'two', placementKey: 'thread', threadId: 'thread', reasoningIndex: 1 })
        expect(owner.ensurePendingBranchMarkerRecordForApiRun('thread', run({ reasoningIndex: 1 }))?.nodeId).toBe('two')
        expect(owner.markers.get('thread:request:reasoning-index:1')?.nodeId).toBe('two')
        expect(owner.markers.get('thread:reasoning-index:0')?.nodeId).toBe('one')
    })

    it('removes only the requested placement or node aliases', () => {
        const { owner } = setup()
        const record = { nodeId: 'one', placementKey: 'thread:request', threadId: 'thread' }
        owner.markers.set('thread:request', record)
        owner.markers.set('thread:request:marker:one', record)
        owner.markers.set('thread:request-two', { ...record, nodeId: 'two' })
        owner.deletePendingBranchMarkerAliasesForPlacement('thread:request')
        expect([...owner.markers.keys()]).toEqual(['thread:request-two'])
        owner.deletePendingBranchMarkerAliasesForNodeId('two')
        expect(owner.markers.size).toBe(0)
    })

    it('gives cancellation and started media precedence over stale pending presentation', () => {
        const { owner, started } = setup()
        const value = marker('one', 0)
        expect(owner.isBranchMarkerPendingForUi(value)).toBe(true)
        started.add('one')
        expect(owner.getBranchMarkerUiPhase(value)).toBe('media-placeholder')
        expect(owner.isBranchMarkerPendingForUi(value)).toBe(false)
        owner.cancelledRequests.add('request')
        expect(owner.getBranchMarkerUiPhase(value)).toBeUndefined()
    })

    it('moves only tracked markers to the placeholder phase', () => {
        const { owner } = setup([marker('one', 0), marker('two', 1)])
        owner.phases.set('one', 'preflight')
        owner.markBranchMarkerRunMediaPlaceholderPhase('thread', run({ reasoningIndex: 0 }))
        expect(owner.phases.get('one')).toBe('media-placeholder')
        owner.markBranchMarkerRunMediaPlaceholderPhase('thread', run({ reasoningIndex: 1 }))
        expect(owner.phases.has('two')).toBe(false)
        owner.clearBranchMarkerUiPhasesForRun('thread', run({ reasoningIndex: 0 }))
        expect(owner.phases.size).toBe(0)
    })

    it('clears every transient map without affecting another canvas owner', () => {
        const first = setup().owner
        const second = setup().owner
        for (const owner of [first, second]) {
            owner.placements.set('thread', { promptText: 'prompt', createdAt: 1 })
            owner.markers.set('thread', { nodeId: 'one', placementKey: 'thread', threadId: 'thread' })
            owner.phases.set('one', 'preflight')
            owner.cancelledRequests.add('request')
        }
        first.clear()
        expect([first.placements.size, first.markers.size, first.phases.size, first.cancelledRequests.size]).toEqual([0, 0, 0, 0])
        expect([second.placements.size, second.markers.size, second.phases.size, second.cancelledRequests.size]).toEqual([1, 1, 1, 1])
    })

    it('clears a preserved marker phase through the API lineage parent even without a local record', () => {
        const { owner } = setup()
        owner.phases.set('parent', 'planned-awaiting-media')
        owner.phases.set('unrelated', 'preflight')
        owner.clearBranchMarkerUiPhasesForRun('thread', run({ lineageAssignment: { lineageParentNodeId: 'parent' } as MediaGenerationRunMeta['lineageAssignment'] }))
        expect([...owner.phases.keys()]).toEqual(['unrelated'])
    })
})
