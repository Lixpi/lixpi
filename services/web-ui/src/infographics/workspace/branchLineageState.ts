import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'

export type BranchLineageMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
export type StartedLineageMarkerState = {
    markerIdsWithGeneratedChildren: Set<string>
    parentIdsWithStartedMarkerChildren: Set<string>
}

export function isGeneratedMediaNode(node: CanvasNode): node is GeneratedMediaNode {
    return node.type === 'image' || node.type === 'video'
}

export function isBranchLineageMarkerNode(node: CanvasNode | undefined): node is BranchLineageMarkerNode {
    return node?.type === 'branchOrigin' || node?.type === 'branchFork' || node?.type === 'branchLine'
}

export function getGeneratedMediaLineageMarkerIds(node: GeneratedMediaNode): string[] {
    const markerIds = [
        node.generatedBy?.branchOriginNodeId,
        node.generatedBy?.branchForkNodeId,
        node.generatedBy?.branchLineNodeId,
    ].filter((markerId: string | undefined): markerId is string => Boolean(markerId))
    return [...new Set(markerIds)]
}

export function getGeneratedMediaMidpointMarkerId(node: GeneratedMediaNode): string | undefined {
    return node.generatedBy?.branchForkNodeId ?? node.generatedBy?.branchLineNodeId
}

export function getStartedLineageMarkerState(nodes: CanvasNode[]): StartedLineageMarkerState {
    const nodesById = new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
    const markerIdsWithGeneratedChildren = new Set<string>()
    const parentIdsWithStartedMarkerChildren = new Set<string>()

    for (const node of nodes) {
        if (!isGeneratedMediaNode(node)) continue
        for (const markerId of getGeneratedMediaLineageMarkerIds(node)) {
            markerIdsWithGeneratedChildren.add(markerId)

            const markerNode = nodesById.get(markerId)
            if ((markerNode?.type === 'branchFork' || markerNode?.type === 'branchLine') && markerNode.parentBranchNodeId) {
                parentIdsWithStartedMarkerChildren.add(markerNode.parentBranchNodeId)
            }
        }
    }

    return { markerIdsWithGeneratedChildren, parentIdsWithStartedMarkerChildren }
}
