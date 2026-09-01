import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    Asset,
    CanvasNode,
    BranchForkCanvasNode,
    ImageCanvasNode,
    CapabilityArtifactCanvasNode,
    MediaBranchLineagePlan,
    MediaRunLineageAssignment,
} from '@lixpi/constants'
import type { GeneratedOutputCanvasNode } from '../canvas-node/generated-media-node.ts'
import {
    WorkspaceBranchActivity,
    getBranchMarkerPlacementKeys,
    lineagePlanReferencesBranchMarkerNode,
    type BranchActivityPlacement,
} from './workspace-branch-activity.ts'

const marker = { nodeId: 'fork', type: 'branchFork', conversationAssetId: 'thread', generationRequestId: 'request', reasoningRunId: 'reasoning', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } } as BranchForkCanvasNode
const media = (status = 'running'): ImageCanvasNode => ({ nodeId: 'output', type: 'image', assetId: 'asset', generationProgress: { status, generationRequestId: 'request' } } as ImageCanvasNode)
const plan = (assignment: Partial<MediaRunLineageAssignment>): MediaBranchLineagePlan => ({ branchForks: [], branchLines: [], runAssignments: [assignment] } as MediaBranchLineagePlan)
function fixture() {
    const nodes: CanvasNode[] = []
    const outputs: GeneratedOutputCanvasNode[] = []
    const assets = new Map<string, Asset>()
    const placements = new Map<string, BranchActivityPlacement>()
    let cancelled = false
    let started = false
    let pending = false
    const activity = new WorkspaceBranchActivity({
        getNodes: () => nodes,
        getOutputs: () => outputs,
        getAsset: id => assets.get(id),
        getPlacements: () => placements,
        isCancelled: () => cancelled,
        hasStartedMedia: () => started,
        isPending: () => pending,
    })
    return {
        activity,
        nodes,
        outputs,
        assets,
        placements,
        cancel: () => {
            cancelled = true
        },
        start: () => {
            started = true
        },
        pend: () => {
            pending = true
        },
    }
}

describe('WorkspaceBranchActivity', () => {
    it('keeps cancelled markers inactive even with persisted pending output', () => {
        const f = fixture()
        f.nodes.push(media())
        f.pend()
        f.cancel()
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(false)
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(false)
    })

    it('stops the marker-only pending state once media starts but retains group activity', () => {
        const f = fixture()
        f.pend()
        f.nodes.push(media())
        f.start()
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(false)
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(true)
    })

    it('recognizes pending markers before a lineage plan exists', () => {
        const f = fixture()
        f.placements.set('thread', { activeRunKeys: new Set(['request']) })
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(true)
        f.placements.clear()
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(false)
        f.pend()
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(true)
    })

    it('matches the active assignment to the marker instead of borrowing an unrelated active run', () => {
        const f = fixture()
        const activeRunKeys = new Set(['other'])
        f.placements.set('thread:request', { activeRunKeys, lineagePlan: plan({ branchForkNodeId: 'fork', mediaRunId: 'matching' }) })
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(false)
        activeRunKeys.add('matching')
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(true)
        f.placements.set('thread:request', { activeRunKeys, lineagePlan: plan({ branchForkNodeId: 'different', mediaRunId: 'matching' }) })
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(false)
    })

    it('matches reasoning identity before the persisted marker ID is attached', () => {
        const f = fixture()
        f.placements.set('thread', { activeRunKeys: new Set(['reasoning']), lineagePlan: plan({ reasoningRunId: 'reasoning' }) })
        expect(f.activity.isBranchMarkerGenerationActive(marker)).toBe(true)
    })

    it('restores activity from a pending output lineage assignment without generatedBy', () => {
        const f = fixture()
        const output = media()
        output.generationProgress!.generationRequestId = 'different-request'
        output.generationProgress!.lineageAssignment = { branchForkNodeId: 'fork' } as MediaRunLineageAssignment
        f.nodes.push(output)
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(true)
        expect(output.generatedBy).toBeUndefined()
    })

    it('restores activity from the shared authoritative request but ignores synthetic request IDs', () => {
        const f = fixture()
        f.nodes.push(media())
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(true)
        const synthetic = { ...marker, generationRequestId: 'canvas-request' }
        f.nodes[0] = { ...media(), generationProgress: { ...media().generationProgress!, generationRequestId: 'canvas-request' } }
        expect(f.activity.isBranchMarkerGenerationGroupActive(synthetic)).toBe(false)
    })

    it('ignores persisted active progress when the output has already been accepted', () => {
        const f = fixture()
        f.nodes.push(media())
        f.outputs.push(media())
        f.assets.set('asset', { generatedOutputReview: { status: 'accepted' } } as Asset)
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(false)
    })

    it('does not let a completed Artifact conclude a group that still has an active placement', () => {
        const f = fixture()
        f.outputs.push({ nodeId: 'artifact', type: 'capabilityArtifact', assetId: 'artifact' } as CapabilityArtifactCanvasNode)
        f.assets.set('artifact', { documents: { capabilityArtifact: {} } } as Asset)
        f.placements.set('thread:request', { activeRunKeys: new Set(['media']) })
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(true)
    })

    it('concludes a fully materialized media group before stale pending state', () => {
        const f = fixture()
        f.outputs.push({ ...media('completed'), mediaGenerationPhase: 'ready' })
        f.assets.set('asset', { media: { renditions: { original: { status: 'ready' } } } } as Asset)
        f.pend()
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(false)
    })

    it('does not borrow placements from another conversation', () => {
        const f = fixture()
        f.placements.set('other:request', { activeRunKeys: new Set(['media']), lineagePlan: plan({ branchForkNodeId: 'fork' }) })
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(false)
        f.placements.set('thread:request', { activeRunKeys: new Set(['media']), lineagePlan: plan({ branchForkNodeId: 'fork' }) })
        expect(f.activity.isBranchMarkerGenerationGroupActive(marker)).toBe(true)
    })

    it('derives placement keys without duplicating the conversation key', () => {
        expect(getBranchMarkerPlacementKeys(marker)).toEqual(['thread', 'thread:request'])
        expect(getBranchMarkerPlacementKeys({ ...marker, generationRequestId: 'thread' })).toEqual(['thread'])
        expect(getBranchMarkerPlacementKeys({ ...marker, conversationAssetId: '' })).toEqual([])
    })

    it('recognizes a regeneration target without fabricating marker assignments', () => {
        const lineage = { ...plan({}), regenerationTarget: { lineageParentNodeId: 'fork' } } as MediaBranchLineagePlan
        expect(lineagePlanReferencesBranchMarkerNode(lineage, marker)).toBe(true)
        expect(lineagePlanReferencesBranchMarkerNode(plan({}), marker)).toBe(false)
    })
})
