import type {
    CanvasNode,
    ImageCanvasNode,
    AiChatThreadCanvasNode,
} from '@lixpi/constants'

const IMAGE_GAP_X = 50
const IMAGE_GAP_Y = 30

export function computeImagePositionNextToThread(
    threadNode: AiChatThreadCanvasNode,
    existingImageCount: number,
    imageWidth: number,
    imageHeight: number
): { x: number; y: number } {
    const x = threadNode.position.x + threadNode.dimensions.width + IMAGE_GAP_X
    const y = threadNode.position.y + existingImageCount * (imageHeight + IMAGE_GAP_Y)

    return { x, y }
}

export function countExistingImagesForThread(
    nodes: CanvasNode[],
    threadId: string
): number {
    return nodes.filter(
        (n): n is ImageCanvasNode =>
            n.type === 'image' && n.generatedBy?.aiChatThreadId === threadId
    ).length
}
