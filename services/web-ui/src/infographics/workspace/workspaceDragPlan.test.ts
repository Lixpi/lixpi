import { describe, it, expect, vi } from 'vitest'
import type { CanvasNode, ContextRegionCanvasNode, ImageCanvasNode, DocumentCanvasNode } from '@lixpi/constants'

import { computeWorkspaceDragPlan } from '$src/infographics/workspace/workspaceDragPlan.ts'
import type { AnchoredImageEntry } from '$src/infographics/workspace/anchoredImageManager.ts'

// =============================================================================
// HELPERS
// =============================================================================

function makeRegion(overrides: Partial<ContextRegionCanvasNode> & { nodeId: string }): ContextRegionCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'contextRegion',
        referenceId: overrides.referenceId ?? `thread-${overrides.nodeId}`,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 320, height: 240 },
        ...overrides,
    }
}

function makeImage(overrides: Partial<ImageCanvasNode> & { nodeId: string }): ImageCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'image',
        fileId: overrides.fileId ?? `file-${overrides.nodeId}`,
        workspaceId: overrides.workspaceId ?? 'workspace-1',
        src: overrides.src ?? `/api/images/workspace-1/file-${overrides.nodeId}`,
        aspectRatio: overrides.aspectRatio ?? 1,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 120, height: 120 },
        ...overrides,
    }
}

function makeDocument(overrides: Partial<DocumentCanvasNode> & { nodeId: string }): DocumentCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'document',
        referenceId: overrides.referenceId ?? `doc-${overrides.nodeId}`,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 240, height: 180 },
        ...overrides,
    }
}

function makeAnchor(imageNodeId: string, threadNodeId: string): AnchoredImageEntry {
    return {
        imageNodeId,
        threadNodeId,
        threadReferenceId: `thread-${threadNodeId}`,
        responseMessageId: `response-${imageNodeId}`,
        imageHeight: 120,
    }
}

function plan(overrides: {
    nodes: CanvasNode[]
    primaryNodeId: string
    selectedNodeIds?: Set<string>
    anchoredNodeIds?: Set<string>
    anchorsByThreadId?: Map<string, AnchoredImageEntry[]>
}) {
    const anchoredNodeIds = overrides.anchoredNodeIds ?? new Set<string>()
    const anchorsByThreadId = overrides.anchorsByThreadId ?? new Map<string, AnchoredImageEntry[]>()

    return computeWorkspaceDragPlan({
        nodes: overrides.nodes,
        primaryNodeId: overrides.primaryNodeId,
        selectedNodeIds: overrides.selectedNodeIds ?? new Set<string>(),
        resolveSelectionTargetNodeId: (nodeId) => nodeId,
        isAnchoredImageNode: (nodeId) => anchoredNodeIds.has(nodeId),
        getAnchorsForThread: (threadNodeId) => anchorsByThreadId.get(threadNodeId) ?? [],
    })
}

// =============================================================================
// CONTEXT REGION DRAG PLANNING
// =============================================================================

describe('computeWorkspaceDragPlan — context region drags', () => {
    it('ignores stale selection from another activated context region', () => {
        const regionA = makeRegion({ nodeId: 'region-a' })
        const regionB = makeRegion({ nodeId: 'region-b' })

        const result = plan({
            nodes: [regionA, regionB],
            primaryNodeId: 'region-b',
            selectedNodeIds: new Set(['region-a']),
        })

        expect(result.resolvedNodeId).toBe('region-b')
        expect(result.draggedNodeIds).toEqual(['region-b'])
    })

    it('moves only the context region and its real parented descendants', () => {
        const region = makeRegion({ nodeId: 'region-1' })
        const childImage = makeImage({ nodeId: 'child-image', parentId: 'region-1', position: { x: 48, y: 64 } })
        const connectedImage = makeImage({ nodeId: 'connected-image', position: { x: 800, y: 100 } })

        const result = plan({
            nodes: [region, childImage, connectedImage],
            primaryNodeId: 'region-1',
        })

        expect(result.draggedNodeIds).toEqual(['region-1', 'child-image'])
        expect(result.draggedNodeIds).not.toContain('connected-image')
    })

    it('does not move anchored/generated output images with context regions', () => {
        const region = makeRegion({ nodeId: 'region-1' })
        const outputImage = makeImage({ nodeId: 'output-image', position: { x: 640, y: 100 } })
        const anchorsByThreadId = new Map([
            ['region-1', [makeAnchor('output-image', 'region-1')]],
        ])

        const result = plan({
            nodes: [region, outputImage],
            primaryNodeId: 'region-1',
            anchorsByThreadId,
        })

        expect(result.moveAnchoredImageIds).toEqual([])
        expect(result.draggedNodeIds).toEqual(['region-1'])
    })

    it('does not move generated output images even if stale parentId says they are region children', () => {
        const region = makeRegion({ nodeId: 'region-1', referenceId: 'thread-1' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            parentId: 'region-1',
            position: { x: 96, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-1',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                revisedPrompt: 'prompt',
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [region, generatedOutput],
            primaryNodeId: 'region-1',
        })

        expect(result.draggedNodeIds).toEqual(['region-1'])
    })

    it('does not let active-region selection pull edge-connected generated outputs into the drag set', () => {
        const activeRegion = makeRegion({ nodeId: 'active-region', referenceId: 'thread-active' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            position: { x: 720, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-active',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [activeRegion, generatedOutput],
            primaryNodeId: 'active-region',
            selectedNodeIds: new Set(['active-region', 'generated-output']),
        })

        expect(result.draggedNodeIds).toEqual(['active-region'])
        expect(result.moveAnchoredImageIds).toEqual([])
        expect(result.allowCollisionResolution).toBe(false)
    })

    it('moves every selected context region as one group', () => {
        const regionA = makeRegion({ nodeId: 'region-a' })
        const regionB = makeRegion({ nodeId: 'region-b' })

        const result = plan({
            nodes: [regionA, regionB],
            primaryNodeId: 'region-b',
            selectedNodeIds: new Set(['region-a', 'region-b']),
        })

        expect(result.resolvedNodeId).toBe('region-b')
        expect(result.draggedNodeIds).toEqual(['region-a', 'region-b'])
        expect(result.moveAnchoredImageIds).toEqual([])
        expect(result.allowProximityConnection).toBe(false)
        expect(result.allowCollisionResolution).toBe(false)
    })

    it('moves selected regions with their real children but not unrelated leaves', () => {
        const regionA = makeRegion({ nodeId: 'region-a' })
        const regionB = makeRegion({ nodeId: 'region-b' })
        const childA = makeImage({ nodeId: 'child-a', parentId: 'region-a', position: { x: 48, y: 72 } })
        const childB = makeImage({ nodeId: 'child-b', parentId: 'region-b', position: { x: 64, y: 80 } })
        const unrelatedLeaf = makeImage({ nodeId: 'unrelated-leaf', position: { x: 900, y: 240 } })

        const result = plan({
            nodes: [regionA, childA, regionB, childB, unrelatedLeaf],
            primaryNodeId: 'region-a',
            selectedNodeIds: new Set(['region-a', 'region-b']),
        })

        expect(result.draggedNodeIds).toEqual(['region-a', 'region-b', 'child-b', 'child-a'])
        expect(result.draggedNodeIds).not.toContain('unrelated-leaf')
        expect(result.moveAnchoredImageIds).toEqual([])
    })

    it('moves mixed selected groups that include a context region without pulling generated outputs', () => {
        const region = makeRegion({ nodeId: 'region-1', referenceId: 'thread-1' })
        const document = makeDocument({ nodeId: 'doc-1' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            position: { x: 760, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-1',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [region, document, generatedOutput],
            primaryNodeId: 'region-1',
            selectedNodeIds: new Set(['region-1', 'doc-1', 'generated-output']),
        })

        expect(result.draggedNodeIds).toEqual(['region-1', 'doc-1'])
        expect(result.draggedNodeIds).not.toContain('generated-output')
        expect(result.moveAnchoredImageIds).toEqual([])
        expect(result.allowCollisionResolution).toBe(false)
    })

    it('disables global collision resolution for context region release', () => {
        const result = plan({
            nodes: [makeRegion({ nodeId: 'region-1' })],
            primaryNodeId: 'region-1',
        })

        expect(result.isContextRegionDrag).toBe(true)
        expect(result.allowProximityConnection).toBe(false)
        expect(result.allowCollisionResolution).toBe(false)
    })
})

// =============================================================================
// NON-REGION DRAG PLANNING
// =============================================================================

describe('computeWorkspaceDragPlan — non-region drags', () => {
    it('keeps legacy anchored images coupled to non-region selected nodes', () => {
        const doc = makeDocument({ nodeId: 'doc-1' })
        const image = makeImage({ nodeId: 'anchored-image' })
        const anchorsByThreadId = new Map([
            ['doc-1', [makeAnchor('anchored-image', 'doc-1')]],
        ])

        const result = plan({
            nodes: [doc, image],
            primaryNodeId: 'doc-1',
            anchorsByThreadId,
        })

        expect(result.draggedNodeIds).toEqual(['doc-1'])
        expect(result.moveAnchoredImageIds).toEqual(['anchored-image'])
        expect(result.allowProximityConnection).toBe(true)
        expect(result.allowCollisionResolution).toBe(true)
    })

    it('filters anchored images out of selected drag sets', () => {
        const doc = makeDocument({ nodeId: 'doc-1' })
        const anchoredImage = makeImage({ nodeId: 'anchored-image' })

        const result = plan({
            nodes: [doc, anchoredImage],
            primaryNodeId: 'doc-1',
            selectedNodeIds: new Set(['doc-1', 'anchored-image']),
            anchoredNodeIds: new Set(['anchored-image']),
        })

        expect(result.draggedNodeIds).toEqual(['doc-1'])
    })

    it('uses the injected selection target resolver for anchored-image drag starts', () => {
        const doc = makeDocument({ nodeId: 'doc-1' })
        const anchoredImage = makeImage({ nodeId: 'anchored-image' })
        const resolveSelectionTargetNodeId = vi.fn((nodeId: string) => nodeId === 'anchored-image' ? 'doc-1' : nodeId)

        const result = computeWorkspaceDragPlan({
            nodes: [doc, anchoredImage],
            primaryNodeId: 'anchored-image',
            selectedNodeIds: new Set<string>(),
            resolveSelectionTargetNodeId,
            isAnchoredImageNode: (nodeId) => nodeId === 'anchored-image',
            getAnchorsForThread: () => [],
        })

        expect(resolveSelectionTargetNodeId).toHaveBeenCalledWith('anchored-image')
        expect(result.resolvedNodeId).toBe('doc-1')
        expect(result.draggedNodeIds).toEqual(['doc-1'])
    })
})