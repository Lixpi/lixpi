import type { CanvasNode, ImageCanvasNode, WorkspaceEdge } from '@lixpi/constants'

import type { AnchoredImageEntry } from '$src/infographics/workspace/anchoredImageManager.ts'

type AnchorFilterResult = {
    validAnchors: AnchoredImageEntry[]
    staleAnchors: AnchoredImageEntry[]
}

type AnchorFilterInput = {
    anchors: AnchoredImageEntry[]
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    threadNodeId: string
}

function isContextRegionNode(node: CanvasNode | undefined): boolean {
    return node?.type === 'contextRegion' || node?.type === 'aiChatThread'
}

export function isGeneratedOutputImageNode(node: CanvasNode | undefined): node is ImageCanvasNode {
    return node?.type === 'image' && Boolean((node as ImageCanvasNode).generatedBy?.aiChatThreadId)
}

export function canAdoptNodeIntoContextRegion(node: CanvasNode): boolean {
    return !isGeneratedOutputImageNode(node)
}

export function hasConnectorEdgeFromThreadToImage(edges: WorkspaceEdge[], threadNodeId: string, imageNodeId: string): boolean {
    return edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === threadNodeId && edge.targetNodeId === imageNodeId)
}

export function canUseLegacyAnchorForImage(params: {
    threadNode: CanvasNode | undefined
    imageNode: CanvasNode | undefined
    edges: WorkspaceEdge[]
}): boolean {
    const { threadNode, imageNode, edges } = params
    if (!isContextRegionNode(threadNode)) return false
    if (imageNode?.type !== 'image') return false
    if (imageNode.generatedBy?.aiChatThreadId !== threadNode.referenceId) return false
    return !hasConnectorEdgeFromThreadToImage(edges, threadNode.nodeId, imageNode.nodeId)
}

export function filterValidAnchorsForThread(input: AnchorFilterInput): AnchorFilterResult {
    const nodesById = new Map(input.nodes.map((node: CanvasNode) => [node.nodeId, node]))
    const threadNode = nodesById.get(input.threadNodeId)
    const validAnchors: AnchoredImageEntry[] = []
    const staleAnchors: AnchoredImageEntry[] = []

    for (const anchor of input.anchors) {
        const imageNode = nodesById.get(anchor.imageNodeId)
        const isValid = anchor.threadNodeId === input.threadNodeId
            && canUseLegacyAnchorForImage({ threadNode, imageNode, edges: input.edges })

        if (isValid) {
            validAnchors.push(anchor)
        } else {
            staleAnchors.push(anchor)
        }
    }

    return { validAnchors, staleAnchors }
}

export type { AnchorFilterInput, AnchorFilterResult }