import {
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'

export const BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE = 36
export const BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP = 6
export const BRANCH_MARKER_MEDIA_MODEL_CIRCLE_OFFSET_X = 10

export type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

export type BranchMarkerMediaModelCircleDescriptor = {
    label: 'Image' | 'Video'
    mediaType: 'image' | 'video'
    modelId: string
    modelProvider?: string
    mediaRunId?: string
}

export function isBranchMarkerNodeForMediaModelCircles(node: CanvasNode | undefined): node is BranchMarkerNode {
    return node?.type === 'branchOrigin' || node?.type === 'branchFork' || node?.type === 'branchLine'
}

export function isGeneratedMediaNodeForMediaModelCircles(node: CanvasNode | undefined): node is ImageCanvasNode | VideoCanvasNode {
    return node?.type === 'image' || node?.type === 'video'
}

function compareGeneratedMediaByGenerationOrder(
    a: ImageCanvasNode | VideoCanvasNode,
    b: ImageCanvasNode | VideoCanvasNode,
): number {
    const aVariant = a.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER
    const bVariant = b.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER
    if (aVariant !== bVariant) return aVariant - bVariant
    return (a.generatedBy?.createdAt ?? 0) - (b.generatedBy?.createdAt ?? 0)
}

function getGeneratedMediaModelId(node: ImageCanvasNode | VideoCanvasNode): string {
    const generatedBy = node.generatedBy
    if (!generatedBy) return ''
    if (generatedBy.mediaModelId) return String(generatedBy.mediaModelId)
    if (node.type === 'video') return String((generatedBy as VideoCanvasNode['generatedBy'])?.videoModel ?? '')
    return String((generatedBy as ImageCanvasNode['generatedBy'])?.aiModel ?? '')
}

function getGeneratedMediaModelProvider(node: ImageCanvasNode | VideoCanvasNode, modelId: string): string {
    const generatedBy = node.generatedBy
    const persistedProvider = node.type === 'video'
        ? (generatedBy as VideoCanvasNode['generatedBy'])?.videoModelProvider
        : (generatedBy as ImageCanvasNode['generatedBy'])?.imageModelProvider
    if (persistedProvider) return persistedProvider
    const separatorIndex = modelId.indexOf(':')
    return separatorIndex < 0 ? '' : modelId.slice(0, separatorIndex)
}

function getGeneratedMediaType(node: ImageCanvasNode | VideoCanvasNode): 'image' | 'video' {
    return node.generatedBy?.mediaType ?? node.type
}

function normalizeModelKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase()
}

function getDescriptorKey(descriptor: BranchMarkerMediaModelCircleDescriptor): string {
    return `${descriptor.mediaType}:${normalizeModelKey(descriptor.modelId)}`
}

function addDescriptor(
    descriptors: BranchMarkerMediaModelCircleDescriptor[],
    seenKeys: Set<string>,
    descriptor: BranchMarkerMediaModelCircleDescriptor,
): void {
    if (!descriptor.modelId) return
    const key = getDescriptorKey(descriptor)
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    descriptors.push(descriptor)
}

export function getBranchMarkerGeneratedMediaNodesForModelCircles(
    markerNode: BranchMarkerNode,
    nodes: CanvasNode[],
): Array<ImageCanvasNode | VideoCanvasNode> {
    return nodes
        .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
            if (!isGeneratedMediaNodeForMediaModelCircles(node)) return false
            if (markerNode.type === 'branchOrigin') {
                return node.generatedBy?.branchOriginNodeId === markerNode.nodeId
                    && !node.generatedBy?.branchForkNodeId
                    && !node.generatedBy?.branchLineNodeId
            }
            if (markerNode.type === 'branchFork') return node.generatedBy?.branchForkNodeId === markerNode.nodeId
            return node.generatedBy?.branchLineNodeId === markerNode.nodeId
        })
        .sort(compareGeneratedMediaByGenerationOrder)
}

export function getBranchMarkerMediaModelCircleDescriptors(
    markerNode: BranchMarkerNode,
    nodes: CanvasNode[],
): BranchMarkerMediaModelCircleDescriptor[] {
    const descriptors: BranchMarkerMediaModelCircleDescriptor[] = []
    const seenKeys = new Set<string>()

    for (const mediaNode of getBranchMarkerGeneratedMediaNodesForModelCircles(markerNode, nodes)) {
        const modelId = getGeneratedMediaModelId(mediaNode)
        const mediaType = getGeneratedMediaType(mediaNode)
        addDescriptor(descriptors, seenKeys, {
            label: mediaType === 'video' ? 'Video' : 'Image',
            mediaType,
            modelId,
            modelProvider: getGeneratedMediaModelProvider(mediaNode, modelId),
            ...(mediaNode.generatedBy?.mediaRunId ? { mediaRunId: mediaNode.generatedBy.mediaRunId } : {}),
        })
    }

    return descriptors
}

export function getBranchMarkerMediaModelCircleNodeId(markerNodeId: string, index: number): string {
    return `${markerNodeId}:media-model-circle:${index}`
}

export function getBranchMarkerMediaModelCircleRect(
    markerNode: BranchMarkerNode,
    index: number,
    count: number,
): { x: number; y: number; width: number; height: number } {
    const safeCount = Math.max(1, count)
    const stackHeight = safeCount * BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE
        + Math.max(0, safeCount - 1) * BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP
    return {
        x: markerNode.position.x + markerNode.dimensions.width + BRANCH_MARKER_MEDIA_MODEL_CIRCLE_OFFSET_X,
        y: markerNode.position.y + markerNode.dimensions.height / 2
            - stackHeight / 2
            + index * (BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE + BRANCH_MARKER_MEDIA_MODEL_CIRCLE_GAP),
        width: BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE,
        height: BRANCH_MARKER_MEDIA_MODEL_CIRCLE_SIZE,
    }
}

export function getBranchMarkerMediaModelCircleIndexForGeneratedMedia(
    markerNode: BranchMarkerNode,
    nodes: CanvasNode[],
    targetNode: ImageCanvasNode | VideoCanvasNode,
): number | null {
    const descriptors = getBranchMarkerMediaModelCircleDescriptors(markerNode, nodes)
    if (descriptors.length === 0) return null

    const targetMediaRunId = targetNode.generatedBy?.mediaRunId
    if (targetMediaRunId) {
        const runIndex = descriptors.findIndex(descriptor => descriptor.mediaRunId === targetMediaRunId)
        if (runIndex >= 0) return runIndex
    }

    const targetModelId = normalizeModelKey(getGeneratedMediaModelId(targetNode))
    if (!targetModelId) return null
    const targetMediaType = getGeneratedMediaType(targetNode)
    const modelIndex = descriptors.findIndex(descriptor =>
        descriptor.mediaType === targetMediaType
        && normalizeModelKey(descriptor.modelId) === targetModelId
    )
    if (modelIndex >= 0) return modelIndex

    const modelOnlyIndex = descriptors.findIndex(descriptor => normalizeModelKey(descriptor.modelId) === targetModelId)
    return modelOnlyIndex >= 0 ? modelOnlyIndex : null
}
