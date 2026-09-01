import {
    describe,
    it,
    expect,
} from 'vitest'
import {
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP,
    BRANCH_MARKER_MEDIA_MODEL_CIRCLE_OFFSET_X,
    BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE,
    getBranchMarkerGeneratedMediaNodesForModelCircles,
    getBranchMarkerMediaModelCircleDescriptors,
    getBranchMarkerMediaModelCircleIndexForGeneratedMedia,
    getBranchMarkerMediaModelCircleNodeId,
    getBranchMarkerMediaModelCircleRect,
    isBranchMarkerNodeForMediaModelCircles,
    isGeneratedMediaNodeForMediaModelCircles,
} from './marker-media-ports.ts'

function branchOriginNode(nodeId: string): BranchOriginCanvasNode {
    return {
        nodeId,
        type: 'branchOrigin',
        workspaceId: 'w',
        dimensions: { width: 120, height: 120 },
        position: { x: 10, y: 15 },
        fileId: nodeId,
        branchId: 'branch-a',
        src: '',
    }
}

function branchForkNode(nodeId: string, parentId: string): BranchForkCanvasNode {
    return {
        nodeId,
        type: 'branchFork',
        workspaceId: 'w',
        dimensions: { width: 120, height: 120 },
        position: { x: 20, y: 25 },
        fileId: nodeId,
        branchId: 'branch-a',
        parentBranchNodeId: parentId,
        generationRequestId: 'req-1',
        src: '',
    }
}

function branchLineNode(nodeId: string, parentId: string): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        workspaceId: 'w',
        dimensions: { width: 120, height: 120 },
        position: { x: 30, y: 35 },
        fileId: nodeId,
        branchId: 'branch-a',
        parentBranchNodeId: parentId,
        generationRequestId: 'req-1',
        src: '',
    }
}

function imageNode(nodeId: string, generatedBy: Record<string, unknown>): ImageCanvasNode {
    return {
        nodeId,
        type: 'image',
        fileId: `${nodeId}-file`,
        workspaceId: 'w',
        src: `/${nodeId}.png`,
        aspectRatio: 1,
        dimensions: { width: 256, height: 256 },
        position: { x: 40, y: 50 },
        generatedBy: {
            aiChatThreadId: 'thread-1',
            responseId: 'response-1',
            aiModel: 'text-model',
            revisedPrompt: '',
            responseMessageId: 'message-1',
            ...generatedBy,
        } as ImageCanvasNode['generatedBy'],
    } as ImageCanvasNode
}

function videoNode(nodeId: string, generatedBy: Record<string, unknown>): VideoCanvasNode {
    return {
        nodeId,
        type: 'video',
        fileId: `${nodeId}-file`,
        posterFileId: `${nodeId}-poster`,
        workspaceId: 'w',
        src: `/${nodeId}.mp4`,
        posterSrc: `/${nodeId}-poster.png`,
        aspectRatio: 16 / 9,
        durationSeconds: 12,
        hasAudio: true,
        dimensions: { width: 320, height: 180 },
        position: { x: 60, y: 70 },
        generatedBy: {
            aiChatThreadId: 'thread-1',
            responseId: 'response-1',
            videoModel: 'video-fallback',
            revisedPrompt: '',
            responseMessageId: 'message-1',
            ...generatedBy,
        } as VideoCanvasNode['generatedBy'],
    } as VideoCanvasNode
}

function moveMediaNode<T extends ImageCanvasNode | VideoCanvasNode>(node: T, position: { x: number; y: number }): T {
    return { ...node, position }
}

describe('branchMarkerMediaModelCircles — node collection and shape helpers', () => {
    it('identifies branch-marker and generated-media nodes', () => {
        const marker: BranchOriginCanvasNode = branchOriginNode('origin')
        const image = imageNode('media-image', {})
        const doc = {
            nodeId: 'doc-1',
            type: 'document',
            workspaceId: 'w',
            dimensions: { width: 100, height: 100 },
            position: { x: 0, y: 0 },
            fileId: 'document',
            referenceId: 'document-1',
        } as CanvasNode

        expect(isBranchMarkerNodeForMediaModelCircles(marker)).toBe(true)
        expect(isBranchMarkerNodeForMediaModelCircles(image)).toBe(false)
        expect(isGeneratedMediaNodeForMediaModelCircles(image)).toBe(true)
        expect(isGeneratedMediaNodeForMediaModelCircles(doc)).toBe(false)
    })

    it('filters branch lineage nodes and sorts generated media by connector row order', () => {
        const origin = branchOriginNode('origin')
        const originNodeA = imageNode('origin-a', { branchOriginNodeId: 'origin', createdAt: 40, variantIndex: 2 })
        const originNodeB = imageNode('origin-b', { branchOriginNodeId: 'origin', createdAt: 10 })
        const forkMarker = branchForkNode('fork', 'origin')
        const forkNode = videoNode('fork-node', { branchForkNodeId: 'fork', createdAt: 99, variantIndex: 1 })
        const lineMarker = branchLineNode('line', 'origin')
        const lineNode = imageNode('line-node', { branchLineNodeId: 'line', createdAt: 50, variantIndex: 0 })
        const unrelated = imageNode('other-node', { branchOriginNodeId: 'other' })

        const nodes: CanvasNode[] = [unrelated, originNodeA, originNodeB, forkNode, lineNode, forkMarker, lineMarker]

        expect(getBranchMarkerGeneratedMediaNodesForModelCircles(origin, nodes).map((node) => node.nodeId)).toEqual([
            'origin-a',
            'origin-b',
        ])
        expect(getBranchMarkerGeneratedMediaNodesForModelCircles(forkMarker, nodes).map((node) => node.nodeId)).toEqual([
            'fork-node',
        ])
        expect(getBranchMarkerGeneratedMediaNodesForModelCircles(lineMarker, nodes).map((node) => node.nodeId)).toEqual([
            'line-node',
        ])
    })

    it('keeps media-model circles in the same top-to-bottom order as generated output rows', () => {
        const forkMarker = branchForkNode('fork', 'origin')
        const topRowNode = moveMediaNode(
            imageNode('top-row-node', {
                branchForkNodeId: 'fork',
                mediaRunId: 'run-top',
                mediaModelId: 'provider:top-model',
                createdAt: 200,
                variantIndex: 2,
            }),
            { x: 600, y: 100 },
        )
        const bottomRowNode = moveMediaNode(
            imageNode('bottom-row-node', {
                branchForkNodeId: 'fork',
                mediaRunId: 'run-bottom',
                mediaModelId: 'provider:bottom-model',
                createdAt: 10,
                variantIndex: 0,
            }),
            { x: 600, y: 620 },
        )
        const nodes: CanvasNode[] = [bottomRowNode, topRowNode, forkMarker]

        expect(getBranchMarkerGeneratedMediaNodesForModelCircles(forkMarker, nodes).map((node) => node.nodeId)).toEqual([
            'top-row-node',
            'bottom-row-node',
        ])
        expect(getBranchMarkerMediaModelCircleDescriptors(forkMarker, nodes).map((descriptor) => descriptor.modelId)).toEqual([
            'provider:top-model',
            'provider:bottom-model',
        ])
        expect(getBranchMarkerMediaModelCircleIndexForGeneratedMedia(forkMarker, nodes, topRowNode)).toBe(0)
        expect(getBranchMarkerMediaModelCircleIndexForGeneratedMedia(forkMarker, nodes, bottomRowNode)).toBe(1)
    })

    it('dedupes media model circles by media type + model id and normalizes case', () => {
        const origin = branchOriginNode('origin')
        const nodes: CanvasNode[] = [
            moveMediaNode(imageNode('image-a', { branchOriginNodeId: 'origin', mediaRunId: 'run-a', mediaModelId: 'ProviderA:Model-1' }), { x: 500, y: 100 }),
            moveMediaNode(imageNode('image-b', { branchOriginNodeId: 'origin', mediaRunId: 'run-b', mediaModelId: 'providera:MODEL-1' }), { x: 500, y: 120 }),
            moveMediaNode(imageNode('image-c', { branchOriginNodeId: 'origin', mediaRunId: 'run-c', aiModel: 'providerB:Model-2' }), { x: 500, y: 260 }),
            moveMediaNode(videoNode('video-a', { branchOriginNodeId: 'origin', mediaRunId: 'run-d', videoModel: 'providerC:Model-3' }), { x: 500, y: 420 }),
            moveMediaNode(videoNode('video-b', { branchOriginNodeId: 'origin', mediaRunId: 'run-e', videoModel: 'providerC:model-3' }), { x: 500, y: 440 }),
        ]

        const descriptors = getBranchMarkerMediaModelCircleDescriptors(origin, nodes)
        expect(descriptors).toMatchObject([
            {
                label: 'Image',
                mediaType: 'image',
                modelId: 'ProviderA:Model-1',
                modelProvider: 'ProviderA',
            },
            {
                label: 'Image',
                mediaType: 'image',
                modelId: 'providerB:Model-2',
            },
            {
                label: 'Video',
                mediaType: 'video',
                modelId: 'providerC:Model-3',
                modelProvider: 'providerC',
            },
        ])
        expect(descriptors[2].mediaType).toBe('video')
        expect(descriptors).toHaveLength(3)
    })

    it('derives fallback model provider when explicit persisted provider is unavailable', () => {
        const origin = branchOriginNode('origin')
        const nodes: CanvasNode[] = [
            imageNode('image-without-provider', {
                branchOriginNodeId: 'origin',
                mediaModelId: 'fallback-provider:alpha',
            }),
            videoNode('video-without-provider', {
                branchOriginNodeId: 'origin',
                videoModel: 'video-provider:beta',
            }),
        ]

        const descriptors = getBranchMarkerMediaModelCircleDescriptors(origin, nodes)
        const imageDescriptor = descriptors.find((descriptor) => descriptor.mediaType === 'image')
        const videoDescriptor = descriptors.find((descriptor) => descriptor.mediaType === 'video')

        expect(imageDescriptor?.modelProvider).toBe('fallback-provider')
        expect(videoDescriptor?.modelProvider).toBe('video-provider')
    })

    it('computes media model badge ids and viewport rectangles as an evenly stacked rail', () => {
        const marker = branchOriginNode('origin')
        expect(getBranchMarkerMediaModelCircleNodeId('origin', 0)).toBe('origin:media-model-circle:0')
        expect(getBranchMarkerMediaModelCircleNodeId('origin', 2)).toBe('origin:media-model-circle:2')

        const rect = getBranchMarkerMediaModelCircleRect(marker, 1, 3)
        const stackHeight = 3 * BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE + 2 * BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP
        expect(rect).toEqual({
            x: marker.position.x + marker.dimensions.width + BRANCH_MARKER_MEDIA_MODEL_CIRCLE_OFFSET_X,
            y: marker.position.y + marker.dimensions.height / 2 - (stackHeight / 2)
                + (1 * (BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE + BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP)),
            width: BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE,
            height: BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE,
        })
    })

    it('maps generated media to the matching media model badge index', () => {
        const origin = branchOriginNode('origin')
        const nodes: CanvasNode[] = [
            moveMediaNode(imageNode('image-1', { branchOriginNodeId: 'origin', mediaRunId: 'run-a', mediaModelId: 'ProviderA:model-1' }), { x: 500, y: 100 }),
            moveMediaNode(imageNode('image-2', { branchOriginNodeId: 'origin', mediaRunId: 'run-b', mediaModelId: 'ProviderA:model-2' }), { x: 500, y: 260 }),
            moveMediaNode(videoNode('video-1', { branchOriginNodeId: 'origin', mediaRunId: 'run-c', videoModel: 'ProviderC:model-3' }), { x: 500, y: 420 }),
        ]
        const targetNodeByRun = imageNode('target-run', { branchOriginNodeId: 'origin', mediaRunId: 'run-b', mediaModelId: 'ProviderA:model-2' })
        const targetNodeFallback = imageNode('target-fallback', { branchOriginNodeId: 'origin', mediaModelId: 'providera:MODEL-1' })
        const targetNodeMissing = imageNode('target-missing', { branchOriginNodeId: 'origin' })

        expect(getBranchMarkerMediaModelCircleIndexForGeneratedMedia(origin, nodes, targetNodeByRun)).toBe(1)
        expect(getBranchMarkerMediaModelCircleIndexForGeneratedMedia(origin, nodes, targetNodeFallback)).toBe(0)
        expect(getBranchMarkerMediaModelCircleIndexForGeneratedMedia(origin, nodes, targetNodeMissing)).toBeNull()
    })
})
