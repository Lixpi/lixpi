// =============================================================================
// CANVAS BUBBLE MENU ITEMS
//
// Menu items for the workspace canvas bubble menu. Currently supports
// image nodes with Delete and Create Variant actions. Framework-agnostic —
// uses only DOM and callbacks. No ProseMirror imports.
// =============================================================================

import { createEl } from '$src/utils/domTemplates.ts'
import { trashBinIcon, downloadIcon } from '$src/svgIcons/index.ts'
import type { BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'

export const CANVAS_IMAGE_CONTEXT = 'canvasImage'

const magicIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>'

type CanvasBubbleMenuCallbacks = {
    onDeleteNode: (nodeId: string) => void
    onCreateVariant: (nodeId: string) => void
    onDownloadImage: (nodeId: string) => void
    onHide: () => void
}

function createCanvasButton(config: {
    icon: string
    title: string
    iconSize: number
    onClick: () => void
}): HTMLElement {
    const button = createEl('button', {
        className: 'bubble-menu-button',
        type: 'button',
        title: config.title,
        innerHTML: config.icon,
    })

    const svg = button.querySelector('svg')
    if (svg) {
        svg.style.width = `${config.iconSize}px`
        svg.style.height = `${config.iconSize}px`
    }

    button.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        config.onClick()
    })

    return button
}

export function buildCanvasBubbleMenuItems(callbacks: CanvasBubbleMenuCallbacks): {
    items: BubbleMenuItem[]
    getActiveNodeId: () => string | null
    setActiveNodeId: (nodeId: string | null) => void
} {
    let activeNodeId: string | null = null

    const createVariantButton = createCanvasButton({
        icon: magicIcon,
        title: 'Create variant',
        iconSize: 17,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onCreateVariant(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const downloadButton = createCanvasButton({
        icon: downloadIcon,
        title: 'Download image',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onDownloadImage(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const deleteButton = createCanvasButton({
        icon: trashBinIcon,
        title: 'Delete image',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onDeleteNode(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const items: BubbleMenuItem[] = [
        { element: createVariantButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: downloadButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: deleteButton, context: [CANVAS_IMAGE_CONTEXT] },
    ]

    return {
        items,
        getActiveNodeId: () => activeNodeId,
        setActiveNodeId: (nodeId: string | null) => { activeNodeId = nodeId },
    }
}
