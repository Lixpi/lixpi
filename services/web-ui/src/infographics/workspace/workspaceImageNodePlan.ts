import type { CanvasNode, ImageCanvasNode } from '@lixpi/constants'

export function isGeneratedOutputImageNode(node: CanvasNode | undefined): node is ImageCanvasNode {
    return node?.type === 'image' && Boolean((node as ImageCanvasNode).generatedBy?.aiChatThreadId)
}

export function canAdoptNodeIntoContextRegion(node: CanvasNode): boolean {
    return !isGeneratedOutputImageNode(node)
}