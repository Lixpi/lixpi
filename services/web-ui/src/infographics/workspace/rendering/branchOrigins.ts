import type {
    BranchOriginCanvasNode,
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'
import {
    buildNodesById,
    computeWorldPosition,
} from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

export type BranchOriginRenderDatum = {
    nodeId: string
    branchId: string
    prompt: string
    referenceNodeIds: string[]
    referenceFileIds: string[]
    x: number
    y: number
    width: number
    height: number
    selected: boolean
}

export type BranchOriginReferenceNode = ImageOrVideoReferenceNode

type ImageOrVideoReferenceNode = Extract<CanvasNode, { type: 'image' | 'video' }>

export type BranchOriginBounds = {
    minX: number
    minY: number
    maxX: number
    maxY: number
    nodeId: string
}

export function isBranchOriginCanvasNode(node: CanvasNode): node is BranchOriginCanvasNode {
    return node.type === 'branchOrigin'
}

export function getBranchOriginRenderDatums(
    canvasState: CanvasState | null,
    selectedNodeIds: Set<string> = new Set()
): BranchOriginRenderDatum[] {
    if (!canvasState) return []

    const nodesById = buildNodesById(canvasState.nodes)
    return canvasState.nodes
        .filter(isBranchOriginCanvasNode)
        .map((node: BranchOriginCanvasNode) => {
            const worldPosition = computeWorldPosition(node, nodesById)
            return {
                nodeId: node.nodeId,
                branchId: node.branchId,
                prompt: node.prompt,
                referenceNodeIds: [...node.referenceNodeIds],
                referenceFileIds: [...node.referenceFileIds],
                x: worldPosition.x,
                y: worldPosition.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
                selected: selectedNodeIds.has(node.nodeId),
            }
        })
}

export function getBranchOriginBounds(datum: BranchOriginRenderDatum): BranchOriginBounds {
    return {
        minX: datum.x,
        minY: datum.y,
        maxX: datum.x + datum.width,
        maxY: datum.y + datum.height,
        nodeId: datum.nodeId,
    }
}

export function branchOriginIntersectsRect(
    datum: BranchOriginRenderDatum,
    rect: Omit<BranchOriginBounds, 'nodeId'>
): boolean {
    const bounds = getBranchOriginBounds(datum)
    return bounds.minX <= rect.maxX
        && bounds.maxX >= rect.minX
        && bounds.minY <= rect.maxY
        && bounds.maxY >= rect.minY
}

export function hitTestBranchOrigin(
    datums: BranchOriginRenderDatum[],
    point: { x: number; y: number }
): BranchOriginRenderDatum | undefined {
    for (let index = datums.length - 1; index >= 0; index--) {
        const datum = datums[index]
        const centerX = datum.x + datum.width / 2
        const centerY = datum.y + datum.height / 2
        const radius = Math.min(datum.width, datum.height) / 2
        const dx = point.x - centerX
        const dy = point.y - centerY
        if ((dx * dx) + (dy * dy) <= radius * radius) return datum
    }
    return undefined
}

export function getBranchOriginReferenceNodes(
    origin: BranchOriginCanvasNode,
    nodes: CanvasNode[]
): BranchOriginReferenceNode[] {
    const referenceIds = new Set(origin.referenceNodeIds)
    return nodes.filter(
        (node: CanvasNode): node is ImageOrVideoReferenceNode =>
            referenceIds.has(node.nodeId) && (node.type === 'image' || node.type === 'video')
    )
}
