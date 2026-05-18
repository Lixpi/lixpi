import { describe, expect, it } from 'vitest'
import type { CanvasNode, ContextRegionCanvasNode, ImageCanvasNode, WorkspaceEdge } from '@lixpi/constants'

import type { AnchoredImageEntry } from '$src/infographics/workspace/anchoredImageManager.ts'
import {
    canAdoptNodeIntoContextRegion,
    canUseLegacyAnchorForImage,
    filterValidAnchorsForThread,
    hasConnectorEdgeFromThreadToImage,
    isGeneratedOutputImageNode,
} from '$src/infographics/workspace/workspaceAnchoredImagePlan.ts'

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

function makeGeneratedImage(overrides: Partial<ImageCanvasNode> & { nodeId: string; threadId: string }): ImageCanvasNode {
    return makeImage({
        ...overrides,
        generatedBy: {
            aiChatThreadId: overrides.threadId,
            responseId: 'response-1',
            aiModel: 'openai:gpt-4o' as any,
            revisedPrompt: 'prompt',
            responseMessageId: 'message-1',
            ...overrides.generatedBy,
        },
    })
}

function makeEdge(sourceNodeId: string, targetNodeId: string): WorkspaceEdge {
    return {
        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
        sourceMessageId: 'message-1',
    }
}

function makeAnchor(imageNodeId: string, threadNodeId: string): AnchoredImageEntry {
    return {
        imageNodeId,
        threadNodeId,
        threadReferenceId: `thread-${threadNodeId}`,
        responseMessageId: 'message-1',
        imageHeight: 120,
    }
}

describe('workspace anchored image plan', () => {
    it('identifies generated output images as independent context-region outputs', () => {
        const region = makeRegion({ nodeId: 'region-1', referenceId: 'thread-1' })
        const generatedImage = makeGeneratedImage({ nodeId: 'generated-output', threadId: 'thread-1' })
        const regularImage = makeImage({ nodeId: 'regular-image' })

        expect(isGeneratedOutputImageNode(generatedImage)).toBe(true)
        expect(canAdoptNodeIntoContextRegion(generatedImage)).toBe(false)
        expect(isGeneratedOutputImageNode(regularImage)).toBe(false)
        expect(canAdoptNodeIntoContextRegion(regularImage)).toBe(true)
        expect(canAdoptNodeIntoContextRegion(region)).toBe(true)
    })

    it('rejects connector-backed generated outputs as legacy anchored images', () => {
        const region = makeRegion({ nodeId: 'active-region', referenceId: 'thread-active' })
        const generatedImage = makeGeneratedImage({ nodeId: 'generated-output', threadId: 'thread-active' })
        const edges = [makeEdge(region.nodeId, generatedImage.nodeId)]

        expect(hasConnectorEdgeFromThreadToImage(edges, region.nodeId, generatedImage.nodeId)).toBe(true)
        expect(canUseLegacyAnchorForImage({ threadNode: region, imageNode: generatedImage, edges })).toBe(false)
    })

    it('keeps only legacy generated images that have no persisted connector edge', () => {
        const region = makeRegion({ nodeId: 'region-1', referenceId: 'thread-1' })
        const legacyAnchoredImage = makeGeneratedImage({ nodeId: 'legacy-anchored-image', threadId: 'thread-1' })
        const connectorBackedImage = makeGeneratedImage({ nodeId: 'connector-backed-image', threadId: 'thread-1' })
        const otherThreadImage = makeGeneratedImage({ nodeId: 'other-thread-image', threadId: 'thread-2' })
        const anchors = [
            makeAnchor('legacy-anchored-image', 'region-1'),
            makeAnchor('connector-backed-image', 'region-1'),
            makeAnchor('other-thread-image', 'region-1'),
            makeAnchor('missing-image', 'region-1'),
        ]
        const nodes: CanvasNode[] = [region, legacyAnchoredImage, connectorBackedImage, otherThreadImage]
        const edges = [makeEdge(region.nodeId, connectorBackedImage.nodeId)]

        const result = filterValidAnchorsForThread({
            anchors,
            nodes,
            edges,
            threadNodeId: region.nodeId,
        })

        expect(result.validAnchors.map((anchor) => anchor.imageNodeId)).toEqual(['legacy-anchored-image'])
        expect(result.staleAnchors.map((anchor) => anchor.imageNodeId)).toEqual([
            'connector-backed-image',
            'other-thread-image',
            'missing-image',
        ])
    })
})