import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasNode,
    type CanvasState,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type MediaBranchLineagePlan,
    type MediaRunLineageAssignment,
    type MediaGenerationRunMeta,
    type ImageCanvasNode,
} from '@lixpi/constants'
import { createLixpiCanvasSettings } from '../../frontend/settings/canvas-settings.ts'
import { WorkspaceGenerationPlacements } from '../generation/workspace-generation-placements.ts'
import { WorkspaceGeometry } from './workspace-geometry.ts'
import { WorkspaceLineageProjection } from './workspace-lineage-projection.ts'
import {
    type BranchMarkerNode,
} from './generated-media-rebalance.ts'

function assignment(patch: Partial<MediaRunLineageAssignment> = {}): MediaRunLineageAssignment {
    return { assetId: 'output', generationRequestId: 'request', branchId: 'branch', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', referenceAssetIds: [], referenceNodeIds: [], sourceContextNodeIds: [], promptText: 'prompt', createdAt: 1, ...patch }
}
function run(value = assignment()): MediaGenerationRunMeta {
    return { requestKind: 'media-generation-matrix', generationRequestId: 'request', reasoningRunId: 'reasoning', reasoningModelId: 'provider:reasoning', reasoningIndex: 0, lineageAssignment: value }
}
function plan(patch: Partial<MediaBranchLineagePlan> = {}): MediaBranchLineagePlan {
    return { planVersion: 'media-branch-lineage-v1', generationRequestId: 'request', branchId: 'branch', promptText: 'prompt', referenceAssetIds: [], referenceNodeIds: [], sourceContextNodeIds: [], branchForks: [], branchLines: [], runAssignments: [], createdAt: 1, ...patch }
}
function image(nodeId: string, patch: Partial<ImageCanvasNode> = {}): ImageCanvasNode {
    return { nodeId, type: 'image', assetId: nodeId, position: { x: 10, y: 20 }, dimensions: { width: 200, height: 100 }, ...patch }
}
function origin(nodeId = 'origin'): BranchOriginCanvasNode {
    return { nodeId, type: 'branchOrigin', branchId: 'branch', generationRequestId: 'request', position: { x: 50, y: 70 }, dimensions: { width: 100, height: 60 }, temporary: true }
}
function fork(nodeId: string, reasoningIndex: number, parentBranchNodeId?: string): MediaBranchLineagePlan['branchForks'][number] {
    return { nodeId, generationRequestId: 'request', branchId: 'branch', reasoningRunId: `reasoning-${reasoningIndex}`, reasoningModelId: 'provider:reasoning', reasoningIndex, ...(parentBranchNodeId ? { parentBranchNodeId } : {}), promptFingerprint: 'fingerprint', provenance: { promptText: 'fork prompt' } as MediaBranchLineagePlan['branchForks'][number]['provenance'] }
}
function setup(nodes: CanvasNode[] = [], lineagePlan = plan()) {
    let state: CanvasState | null = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const settings = createLixpiCanvasSettings()
    const pending = new Set<string>()
    const positions = new Map<string, { x: number; y: number }>()
    const getWorldPosition = (node: CanvasNode) => positions.get(node.nodeId) ?? node.position
    const getWorldRect = (node: CanvasNode) => ({ ...getWorldPosition(node), ...node.dimensions })
    const geometry = new WorkspaceGeometry({ workspaceId: 'workspace', settings, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getPaneSize: () => ({ width: 1000, height: 800 }), getWorldPosition, getWorldRect, getLiveDimensions: () => undefined, isPending: nodeId => pending.has(nodeId) })
    const placements = new WorkspaceGenerationPlacements({ readCanvasState: () => state, hasStartedMedia: () => false })
    const placement = { createdAt: 1, promptText: 'prompt', lineagePlan, referenceNodeIds: [] as string[] }
    placements.setPendingGeneratedMediaPlacement('thread', run(), placement)
    const resizeMarker = vi.fn(<Node extends BranchMarkerNode>(node: Node): Node => node)
    const owner = new WorkspaceLineageProjection({ readCanvasState: () => state, placements, geometry, settings: settings.mediaBranchLineage, getWorldPosition, getWorldRect, resizeMarker })
    return {
        owner,
        placement,
        placements,
        settings,
        pending,
        positions,
        resizeMarker,
        setState: (value: CanvasState | null) => {
            state = value
        },
    }
}

describe('workspace lineage projection', () => {
    it('uses API parent precedence without guessing from connected or nearby media', () => {
        const nodes = ['explicit', 'line', 'fork', 'parent', 'origin'].map(id => image(id))
        const { owner } = setup(nodes)
        const lineage = assignment({ lineageParentNodeId: 'explicit', branchLineNodeId: 'line', branchForkNodeId: 'fork', parentMediaNodeId: 'parent', branchOriginNodeId: 'origin' })
        expect(owner.getGeneratedMediaEdgeSourceNode(run(lineage))).toBe(nodes[0])
        expect(owner.getGeneratedMediaEdgeSourceNode(run({ ...lineage, lineageParentNodeId: 'missing' }))).toBeUndefined()
        expect(owner.getGeneratedMediaEdgeSourceNode(run(assignment()))).toBeUndefined()
    })

    it('resolves a declared parent from pending markers when it is not mounted yet', () => {
        const { owner } = setup()
        const pending = origin()
        expect(owner.getGeneratedMediaEdgeSourceNode(run(assignment({ branchOriginNodeId: pending.nodeId })), [pending])).toBe(pending)
    })

    it('filters media references without changing order or repeating placements', () => {
        const video = { ...image('video'), type: 'video' as const }
        const { owner } = setup([origin(), image('one'), video])
        expect(owner.getExistingMediaNodeIds(['missing', 'origin', 'video', 'one', 'video', null])).toEqual(['video', 'one'])
        expect(owner.getFirstExistingMediaNodeId(['origin', undefined, 'video', 'one'])).toBe('video')
    })

    it('deduplicates marker and edge insertion without mutating existing collections', () => {
        const { owner } = setup()
        const parent = origin()
        const child = { ...origin('child'), type: 'branchFork', parentBranchNodeId: parent.nodeId } as BranchForkCanvasNode
        const nodes = [parent]
        expect(owner.addBranchLineageMarkerNodesIfMissing(nodes, parent, child, child, undefined)).toEqual([parent, child])
        expect(nodes).toEqual([parent])
        expect(owner.createBranchMarkerEdge({ ...child, parentBranchNodeId: undefined })).toBeUndefined()
        const edges = owner.addBranchMarkerEdgeIfMissing([], child)
        expect(edges).toEqual([{ edgeId: 'edge-origin-child', sourceNodeId: 'origin', targetNodeId: 'child', sourceHandle: 'right', targetHandle: 'left' }])
        expect(owner.addBranchMarkerEdgeIfMissing(edges, child)).toBe(edges)
    })

    it('does not create an origin or fork without its declared API plan', () => {
        const { owner } = setup()
        const generationRun = run(assignment({ branchOriginNodeId: 'origin', branchForkNodeId: 'fork' }))
        expect(owner.ensureBranchOriginForGeneratedMedia('thread', generationRun, 200)).toBeUndefined()
        expect(owner.ensureBranchForkForGeneratedMedia('thread', generationRun, undefined)).toBeUndefined()
    })

    it('retains mounted origin and fork geometry during API handoff', () => {
        const existingOrigin = origin()
        const existingFork = { ...origin('fork'), type: 'branchFork' } as BranchForkCanvasNode
        const lineage = plan({ branchOrigin: { nodeId: 'origin', generationRequestId: 'request', branchId: 'branch', provenance: { promptText: 'origin' } as NonNullable<MediaBranchLineagePlan['branchOrigin']>['provenance'] }, branchForks: [fork('fork', 0)] })
        const { owner, resizeMarker } = setup([existingOrigin, existingFork], lineage)
        const generationRun = run(assignment({ branchOriginNodeId: 'origin', branchForkNodeId: 'fork' }))
        expect(owner.ensureBranchOriginForGeneratedMedia('thread', generationRun, 200)).toBe(existingOrigin)
        expect(owner.ensureBranchForkForGeneratedMedia('thread', generationRun, existingOrigin)).toBe(existingFork)
        expect(resizeMarker).not.toHaveBeenCalled()
    })

    it('constructs the declared root fork with its reasoning identity and provenance', () => {
        const planned = fork('fork', 2)
        const { owner, resizeMarker } = setup([], plan({ branchForks: [planned] }))
        const result = owner.ensureBranchForkForGeneratedMedia('thread', run(assignment({ branchForkNodeId: 'fork' })), undefined)!
        expect(result).toMatchObject({ nodeId: 'fork', type: 'branchFork', conversationAssetId: 'thread', reasoningRunId: 'reasoning-2', reasoningIndex: 2, promptFingerprint: 'fingerprint', provenance: planned.provenance, temporary: true })
        expect(result.parentBranchNodeId).toBeUndefined()
        expect(Number.isFinite(result.position.x) && Number.isFinite(result.position.y)).toBe(true)
        expect(resizeMarker).toHaveBeenCalledWith(result)
    })

    it('requires a continuation parent and replaces only preflight line geometry', () => {
        const parent = image('parent')
        const planned = { ...fork('line', 0, 'parent'), parentBranchNodeId: 'parent', mediaRunId: 'media', mediaModelId: 'provider:media', mediaType: 'video' as const } as MediaBranchLineagePlan['branchLines'][number]
        const lineage = plan({ branchLines: [planned] })
        const generationRun = run(assignment({ branchLineNodeId: 'line' }))
        const missing = setup([], lineage)
        expect(missing.owner.ensureBranchLineForGeneratedMedia('thread', generationRun, undefined)).toBeUndefined()
        const preflight = { ...origin('line'), type: 'branchLine', parentBranchNodeId: 'parent', pendingState: { phase: 'preflight', promptText: 'prompt' } } as BranchLineCanvasNode
        const { owner, setState } = setup([parent, preflight], lineage)
        const result = owner.ensureBranchLineForGeneratedMedia('thread', generationRun, undefined)!
        expect(result).not.toBe(preflight)
        expect(result).toMatchObject({ parentBranchNodeId: 'parent', mediaRunId: 'media', mediaModelId: 'provider:media', mediaType: 'video' })
        expect(result.pendingState).toBeUndefined()
        setState({ nodes: [parent, result], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
        expect(owner.ensureBranchLineForGeneratedMedia('thread', generationRun, undefined)).toBe(result)
    })

    it('orders sibling slots by API reasoning index and stable marker identity', () => {
        const forks = [fork('z', 1, 'parent'), fork('a', 0, 'parent'), fork('other', 0, 'other-parent')]
        const assignments = [assignment({ branchForkNodeId: 'z' }), assignment({ branchForkNodeId: 'a' }), assignment({ branchForkNodeId: 'z', mediaRunId: 'another-media' }), assignment({ branchForkNodeId: 'other' })]
        const { owner } = setup([], plan({ branchForks: forks, runAssignments: assignments }))
        expect(owner.getPlannedBranchMarkerSiblingSlot('thread', run(), 'parent', 'a')).toEqual({ index: 0, count: 2 })
        expect(owner.getPlannedBranchMarkerSiblingSlot('thread', run(), 'parent', 'z')).toEqual({ index: 1, count: 2 })
        expect(owner.getPlannedBranchMarkerSiblingSlot('thread', run(), 'parent', 'missing')).toBeUndefined()
        expect(owner.getUniqueLineageAssignmentsForMarkers(plan({ runAssignments: assignments }))).toEqual([assignments[0], assignments[1], assignments[3]])
    })

    it('separates root siblings around their shared anchor using configured clearance', () => {
        const { owner, settings } = setup([], plan({ branchForks: [fork('b', 1), fork('a', 0), fork('child', 0, 'parent')] }))
        const firstSlot = owner.getPlannedRootBranchForkSiblingSlot('thread', run(), 'a')!
        const lastSlot = owner.getPlannedRootBranchForkSiblingSlot('thread', run(), 'b')!
        const first = owner.getRootBranchMarkerPositionBeforeGeneratedMedia('thread', run(), { width: 100, height: 60 }, 200, firstSlot)
        const last = owner.getRootBranchMarkerPositionBeforeGeneratedMedia('thread', run(), { width: 100, height: 60 }, 200, lastSlot)
        expect(first.x).toBe(last.x)
        expect(last.y - first.y).toBe(60 + settings.mediaBranchLineage.nodeGap)
        expect(owner.getPlannedRootBranchForkSiblingSlot('thread', run(), 'child')).toBeUndefined()
    })

    it('uses world geometry for explicit media references and excludes document references', () => {
        const first = image('one')
        const second = image('two')
        const { owner, placement, positions } = setup([first, second, { ...image('document'), type: 'document' }])
        positions.set('one', { x: 100, y: 200 })
        positions.set('two', { x: 400, y: 500 })
        placement.referenceNodeIds = ['one', 'document', 'missing', 'two']
        expect(owner.getReferenceGroupRectForGeneratedMedia('thread', run())).toEqual({ x: 100, y: 200, width: 500, height: 400 })
        expect(owner.getReferenceBranchRootMarkerPositionForGeneratedMedia('thread', run(), { width: 100, height: 60 }, 200, 80)?.x).toBeGreaterThan(600)
    })

    it('places continuation markers against compact pending-media anchors', () => {
        const parent = image('parent', { dimensions: { width: 400, height: 100 } })
        const { owner, pending } = setup([parent])
        const dimensions = { width: 100, height: 60 }
        const full = owner.getPendingBranchMarkerPositionBeforeGeneratedMedia(parent, dimensions)
        pending.add(parent.nodeId)
        const compact = owner.getPendingBranchMarkerPositionBeforeGeneratedMedia(parent, dimensions)
        expect(compact.x).toBeLessThan(full.x)
        const first = owner.getPendingBranchMarkerPositionBeforeGeneratedMedia(parent, dimensions, { index: 0, count: 2 })
        const second = owner.getPendingBranchMarkerPositionBeforeGeneratedMedia(parent, dimensions, { index: 1, count: 2 })
        expect(first.y).toBeLessThan(second.y)
    })

    it('keeps output ordering shared across generated images and videos', () => {
        const source = origin()
        const first = image('first', { generatedBy: { createdAt: 1 } as ImageCanvasNode['generatedBy'] })
        const second = { ...image('second', { generatedBy: { createdAt: 2 } as ImageCanvasNode['generatedBy'] }), type: 'video' as const }
        const unrelated = image('unrelated', { generatedBy: { createdAt: 3 } as ImageCanvasNode['generatedBy'] })
        const { owner } = setup()
        const outputs = owner.getGeneratedMediaOutputs(source, [first, second, unrelated], [owner.createGeneratedImageEdge(source, first.nodeId), owner.createGeneratedImageEdge(source, second.nodeId)])
        expect(outputs).toEqual([first, second])
        expect(owner.getMostRecentGeneratedMediaOutput(outputs)).toBe(second)
        expect(outputs).toEqual([first, second])
    })

    it('projects run metadata without inventing a missing reasoning model', () => {
        const { owner } = setup()
        const planned = plan({ branchForks: [fork('fork', 3)] })
        const lineage = assignment({ branchForkNodeId: 'fork', mediaRunId: 'media', mediaModelId: 'provider:media', mediaType: 'image' })
        expect(owner.buildGenerationRunFromLineageAssignment(planned, lineage)).toMatchObject({ reasoningIndex: 3, lineageAssignment: lineage, mediaRunId: 'media', mediaModelId: 'provider:media' })
        expect(owner.buildGenerationRunFromLineageAssignment(planned, { ...lineage, reasoningModelId: undefined })).toBeUndefined()
        expect(owner.getLineageAssignmentReasoningIndex(plan(), assignment({ reasoningRunId: undefined }))).toBe(0)
    })

    it('reads replacement scenes without retaining references from another instance', () => {
        const first = setup([image('one')])
        const second = setup([image('two')])
        first.placement.referenceNodeIds = ['one']
        first.setState(null)
        first.placements.clear()
        expect(first.owner.findCanvasNodeById('one')).toBeUndefined()
        expect(first.owner.getReferenceGroupRectForGeneratedMedia('thread', run())).toBeUndefined()
        expect(second.owner.findCanvasNodeById('two')?.nodeId).toBe('two')
    })
})
