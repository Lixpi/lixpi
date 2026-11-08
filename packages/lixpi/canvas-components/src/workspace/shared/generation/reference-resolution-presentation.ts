import {
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'

export type ReferenceResolutionBranchMarker =
    | BranchOriginCanvasNode
    | BranchForkCanvasNode
    | BranchLineCanvasNode

export const isMediaGenerationReferenceResolutionOperation = (node: CanvasNode): node is OperationStatusCanvasNode & {
    operation: 'media-generation'
    status: 'action-required'
} => {
    return node.type === 'operationStatus'
        && node.operation === 'media-generation'
        && node.status === 'action-required'
        && Boolean(node.generationRequestId)
        && Boolean(node.unresolvedBindingId)
        && Boolean(node.candidateAssetIds?.length)
        && node.requestRevision !== undefined
}

const isBranchMarker = (node: CanvasNode): node is ReferenceResolutionBranchMarker =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const getMarkerPriority = (node: ReferenceResolutionBranchMarker): number => {
    if (node.pendingState?.phase === 'preflight')
        return 0

    if (node.type === 'branchOrigin')
        return 1

    if (node.type === 'branchFork')
        return 2

    return 3
}

export const getMediaGenerationReferenceResolutionOwner = (
    nodes: readonly CanvasNode[],
    generationRequestId: string,
): ReferenceResolutionBranchMarker | undefined => {
    return nodes.filter(
        (node): node is ReferenceResolutionBranchMarker => (
                isBranchMarker(node) && node.generationRequestId === generationRequestId
            ),
    )
        .sort(
            (left, right) => (
                getMarkerPriority(left) - getMarkerPriority(right)
                || (left.pendingState?.reasoningIndex ?? Number.MAX_SAFE_INTEGER)
                    - (right.pendingState?.reasoningIndex ?? Number.MAX_SAFE_INTEGER)
                || left.nodeId.localeCompare(right.nodeId)
            ),
        )[0]
}

export const getMediaGenerationReferenceResolutionForMarker = (
    nodes: readonly CanvasNode[],
    marker: ReferenceResolutionBranchMarker,
): OperationStatusCanvasNode | undefined => {
    const operation = nodes.find(
        (node): node is OperationStatusCanvasNode => (
            isMediaGenerationReferenceResolutionOperation(node)
            && node.generationRequestId === marker.generationRequestId
        ),
    )

    if (!operation?.generationRequestId)
        return undefined

    const owner = getMediaGenerationReferenceResolutionOwner(nodes, operation.generationRequestId)

    return owner?.nodeId === marker.nodeId ? operation : undefined
}
