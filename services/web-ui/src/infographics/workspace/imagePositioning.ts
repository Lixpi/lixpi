import type {
    CanvasNode,
    ImageCanvasNode,
    AiChatThreadCanvasNode,
} from '@lixpi/constants'

const IMAGE_GAP_X = 50
const IMAGE_GAP_Y = 30
const OVERLAP_PADDING_X = 16
const OVERLAP_GAP_Y = 8
const OVERLAP_WIDTH_RATIO = 0.68
const OVERLAP_INTERSECTION_RATIO = -0.06

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

export function computeImagePositionOverlappingThread(
    threadNode: AiChatThreadCanvasNode,
    responseMessageId: string,
    threadNodeEl: HTMLElement | null
): { x: number; y: number; constrainedWidth: number } {
    const constrainedWidth = Math.floor(threadNode.dimensions.width * OVERLAP_WIDTH_RATIO)
    let x = threadNode.position.x + threadNode.dimensions.width - constrainedWidth + OVERLAP_PADDING_X

    if (!threadNodeEl) {
        const y = threadNode.position.y + 80
        return { x, y, constrainedWidth }
    }

    // Find the target response message for vertical alignment
    let messageEl: Element | null = null
    if (responseMessageId) {
        messageEl = threadNodeEl.querySelector(`[data-message-id="${responseMessageId}"]`)
    }
    // Fallback: find the last response message in the thread (critical during
    // IMAGE_PARTIAL when responseMessageId is not yet available)
    if (!messageEl) {
        const allMessages = threadNodeEl.querySelectorAll('[data-message-id]')
        if (allMessages.length > 0) {
            messageEl = allMessages[allMessages.length - 1]
        }
    }

    if (!messageEl) {
        const y = threadNode.position.y + 80
        return { x, y, constrainedWidth }
    }

    const nodeRect = threadNodeEl.getBoundingClientRect()
    const msgRect = messageEl.getBoundingClientRect()
    const zoom = nodeRect.width / threadNode.dimensions.width || 1

    const bubbleEl = messageEl.querySelector('.ai-response-message-bubble') as HTMLElement | null
    const contentEl = messageEl.querySelector('.ai-response-message-content') as HTMLElement | null
    if (bubbleEl || contentEl) {
        const bubbleRect = bubbleEl?.getBoundingClientRect()
        const contentRect = contentEl?.getBoundingClientRect()

        const anchorRight = contentRect?.right ?? bubbleRect?.right
        if (anchorRight) {
            const anchorRightRelative = (anchorRight - nodeRect.left) / zoom
            const desiredX = threadNode.position.x + anchorRightRelative - Math.floor(constrainedWidth * OVERLAP_INTERSECTION_RATIO)

            const minX = threadNode.position.x + Math.floor(threadNode.dimensions.width * 0.84)
            const maxX = threadNode.position.x + threadNode.dimensions.width - Math.floor(constrainedWidth * 0.005)
            x = Math.max(minX, Math.min(desiredX, maxX))
        }
    }

    // Align with the TOP of the response bubble (not the message wrapper, which may have margin above)
    const bubbleTop = bubbleEl?.getBoundingClientRect().top ?? msgRect.top
    const bubbleTopRelative = (bubbleTop - nodeRect.top) / zoom
    const y = threadNode.position.y + bubbleTopRelative

    return { x, y, constrainedWidth }
}

export { OVERLAP_PADDING_X, OVERLAP_GAP_Y, OVERLAP_WIDTH_RATIO }

export function countExistingImagesForThread(
    nodes: CanvasNode[],
    threadId: string
): number {
    return nodes.filter(
        (n): n is ImageCanvasNode =>
            n.type === 'image' && n.generatedBy?.aiChatThreadId === threadId
    ).length
}
