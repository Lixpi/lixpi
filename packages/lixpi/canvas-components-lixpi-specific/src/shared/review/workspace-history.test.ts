import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CanvasNode,
    type ImageCanvasNode,
    type CapabilityArtifactCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
} from '@lixpi/constants'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    WorkspaceHistory,
    getBranchMarkerTurnDescriptor,
    getCapabilityArtifactTurnProjectionLocator,
    getGeneratedMediaProjectionLocator,
    type WorkspaceHistoryPorts,
} from './workspace-history.ts'

type Marker = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
const geometry = { position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } }
const media = (nodeId: string, generatedBy: Partial<NonNullable<ImageCanvasNode['generatedBy']>> = {}): ImageCanvasNode => ({
    ...geometry,
    nodeId,
    type: 'image',
    assetId: `asset-${nodeId}`,
    generatedBy: { conversationAssetId: 'thread', responseMessageId: 'response', promptText: 'fallback prompt', ...generatedBy },
} as ImageCanvasNode)
const marker = (type: Marker['type'], nodeId = type): Marker => ({ ...geometry, nodeId, type, conversationAssetId: 'thread' } as Marker)
const artifact = (generatedBy: Partial<NonNullable<CapabilityArtifactCanvasNode['generatedBy']>> = {}): CapabilityArtifactCanvasNode => ({
    ...geometry,
    nodeId: 'artifact',
    type: 'capabilityArtifact',
    assetId: 'artifact-asset',
    artifactTypeId: 'test',
    generatedBy: { conversationAssetId: 'thread', input: {}, ...generatedBy },
} as CapabilityArtifactCanvasNode)
function thread(turns: number): ProseMirrorJsonNode {
    return {
        type: 'doc',
        content: [{
            type: 'aiChatThread',
            attrs: { threadId: 'thread' },
            content: Array.from({ length: turns }, (_, index) => [
                { type: 'aiUserMessage', content: [{ type: 'paragraph', content: [{ type: 'text', text: `prompt-${index}` }] }] },
                { type: 'aiResponseMessage', attrs: { id: `response-${index}`, generationRequestId: `request-${index}` }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `response-${index}` }] }] },
            ]).flat(),
        }],
    }
}
function fixture(initialNodes: CanvasNode[] = []) {
    let nodes = initialNodes
    let content: unknown = thread(2)
    let provenance: unknown
    let active = false
    let groupActive = false
    let cancelled = false
    const ports: WorkspaceHistoryPorts = {
        getNodes: () => nodes,
        getThreadContent: () => content,
        getProvenanceContent: () => provenance,
        isBranchActive: () => active,
        isBranchGroupActive: () => groupActive,
        isBranchCancelled: () => cancelled,
    }
    return {
        history: new WorkspaceHistory(ports),
        setNodes: (value: CanvasNode[]) => {
            nodes = value
        },
        setContent: (value: unknown) => {
            content = value
        },
        setProvenance: (value: unknown) => {
            provenance = value
        },
        setActive: (value: boolean) => {
            active = value
        },
        setGroupActive: (value: boolean) => {
            groupActive = value
        },
        setCancelled: (value: boolean) => {
            cancelled = value
        },
    }
}

describe('WorkspaceHistory', () => {
    it('prefers immutable provenance while reading live conversation snapshots when it is absent', () => {
        const f = fixture()
        const node = media('one')
        const first = thread(1)
        const second = thread(2)
        f.setContent(first)
        expect(f.history.getGeneratedMediaHistoryContent(node)).toBe(first)
        f.setProvenance(second)
        expect(f.history.getGeneratedMediaHistoryContent(node)).toBe(second)
        f.setContent(null)
        expect(f.history.getGeneratedMediaHistoryContent(node)).toBe(second)
        f.setProvenance(undefined)
        expect(f.history.getGeneratedMediaHistoryContent(node)).toBeNull()
    })

    it('orders branch media by variant and creation time without sorting the source scene', () => {
        const late = media('late', { branchOriginNodeId: 'branchOrigin', variantIndex: 1, createdAt: 10 })
        const first = media('first', { branchOriginNodeId: 'branchOrigin', variantIndex: 0, createdAt: 20 })
        const early = media('early', { branchOriginNodeId: 'branchOrigin', variantIndex: 1, createdAt: 5 })
        const nodes = [late, first, media('other'), early]
        const f = fixture(nodes)
        expect(f.history.getBranchOriginGeneratedMediaNodes('branchOrigin')).toEqual([first, early, late])
        expect(f.history.getBranchMarkerMediaProjectionTarget(marker('branchOrigin'))).toEqual({ node: first, lineageProjectionScope: 'branch-origin', limitProjectionToSelectedMedia: false })
        expect(nodes[0]).toBe(late)
        f.setNodes([])
        expect(f.history.getBranchMarkerMediaProjectionTarget(marker('branchOrigin'))).toBeNull()
    })

    it('settles active persisted progress for a ready output without mutating its snapshot', () => {
        const f = fixture()
        const node = { ...media('one'), mediaGenerationPhase: 'ready', generationProgress: { status: 'running', mediaRunId: 'run' } } as ImageCanvasNode
        expect(f.history.getMediaGenerationTraceState(node)).toMatchObject({ status: 'completed', mediaRunId: 'run' })
        expect(node.generationProgress?.status).toBe('running')
        expect(f.history.getMediaGenerationTraceState({ ...node, mediaGenerationPhase: 'pending-before-first-frame' })).toBe(node.generationProgress)
        expect(f.history.getMediaGenerationTraceState({ ...node, generationProgress: undefined, generatedBy: undefined })).toBeNull()
    })

    it('limits a branch-line projection to its selected media and includes Artifact outputs separately', () => {
        const image = media('one', { branchLineNodeId: 'branchLine' })
        const item = artifact({ branchLineNodeId: 'branchLine' })
        const f = fixture([image, item])
        const line = marker('branchLine')
        expect(f.history.getBranchMarkerMediaProjectionTarget(line)?.limitProjectionToSelectedMedia).toBe(true)
        expect(f.history.getBranchMarkerGeneratedOutputNodes(line)).toEqual([image, item])
    })

    it('uses the closest valid lineage marker and rejects markers of the wrong kind', () => {
        const node = media('one', { branchLineNodeId: 'line', branchForkNodeId: 'fork', branchOriginNodeId: 'origin' })
        const fork = marker('branchFork', 'fork')
        const origin = marker('branchOrigin', 'origin')
        const f = fixture([marker('branchOrigin', 'line'), fork, origin])
        expect(f.history.getMediaNodeBranchMarkerProjectionTarget(node)).toEqual({ marker: fork, lineageProjectionScope: 'branch-fork' })
        f.setNodes([origin])
        expect(f.history.getMediaNodeBranchMarkerProjectionTarget(node)?.marker).toBe(origin)
        f.setNodes([])
        expect(f.history.getMediaNodeBranchMarkerProjectionTarget(node)).toBeNull()
    })

    it('can inspect pending media through its persisted lineage before generatedBy exists', () => {
        const line = marker('branchLine', 'line')
        const node = { ...media('one'), generatedBy: undefined, generationProgress: { lineageAssignment: { branchLineNodeId: 'line' } } } as ImageCanvasNode
        expect(fixture([line]).history.getMediaNodeBranchMarkerProjectionTarget(node)?.marker).toBe(line)
    })

    it('validates a details target against both node identity and kind', () => {
        const image = media('one')
        const origin = marker('branchOrigin')
        const f = fixture([image, origin])
        expect(f.history.resolveGeneratedOutputDetailsNode({ kind: 'branch-marker', nodeId: image.nodeId })).toBeNull()
        expect(f.history.resolveGeneratedOutputDetailsNode({ kind: 'output', nodeId: image.nodeId })).toBe(image)
        expect(f.history.resolveGeneratedOutputDetailsNode({ kind: 'output', nodeId: origin.nodeId })).toBeNull()
        expect(f.history.resolveGeneratedOutputDetailsNode(undefined)).toBeNull()
    })

    it('allows the latest-turn fallback only for active, pending, Artifact-backed or single-turn markers', () => {
        const f = fixture()
        const origin = marker('branchOrigin')
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(false)
        f.setActive(true)
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(true)
        f.setActive(false)
        f.setGroupActive(true)
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(true)
        f.setGroupActive(false)
        f.setNodes([artifact({ branchOriginNodeId: origin.nodeId })])
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(true)
        f.setNodes([])
        f.setContent(thread(1))
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(true)
        f.setContent(thread(0))
        expect(f.history.canUseLatestBranchMarkerTurnFallback(origin)).toBe(false)
    })

    it('never substitutes the latest conversation turn for an unmatched Artifact request', () => {
        const f = fixture()
        expect(f.history.buildCapabilityArtifactTurnProjectionContent(artifact({ generationRequestId: 'missing' }))).toBeNull()
        expect(f.history.getGeneratedOutputUserMessageText(artifact({ generationRequestId: 'missing', input: { prompt: 'sealed input' } }))).toBe('sealed input')
    })

    it('keeps synthetic request IDs out of persisted marker descriptors and preserves pending reasoning identity', () => {
        const node = { ...marker('branchFork'), generationRequestId: 'canvas-temporary', reasoningModelId: 'old:model', reasoningRunId: 'run', pendingState: { reasoningModelId: 'selected:model', reasoningIndex: 0 } } as BranchForkCanvasNode
        expect(getBranchMarkerTurnDescriptor(node)).toEqual({ reasoningRunId: 'run', reasoningModelId: 'selected:model', reasoningIndex: 0, markerNodeId: 'branchFork', markerNodeAttr: 'branchForkNodeId' })
    })

    it('uses Artifact lineage from the nearest assigned marker and retains media variant zero', () => {
        const item = artifact({ branchLineNodeId: 'line', branchForkNodeId: 'fork', branchOriginNodeId: 'origin' })
        expect(getCapabilityArtifactTurnProjectionLocator(item)).toMatchObject({ lineageProjectionScope: 'media-run', descriptor: { markerNodeId: 'line', markerNodeAttr: 'branchLineNodeId' } })
        expect(getGeneratedMediaProjectionLocator(media('one', { variantIndex: 0 }))?.variantIndex).toBe(0)
        expect(getGeneratedMediaProjectionLocator({ ...media('one'), generatedBy: undefined })).toBeNull()
    })
})
