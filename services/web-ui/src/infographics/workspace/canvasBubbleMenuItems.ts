// =============================================================================
// CANVAS BUBBLE MENU ITEMS
//
// Menu items for the workspace canvas bubble menu. Supports image nodes
// (Delete, Download, Ask AI, Connect) and edge connections (Delete).
// Framework-agnostic — uses only DOM and callbacks. No ProseMirror imports.
// =============================================================================

import { createEl } from '$src/utils/domTemplates.ts'
import { trashBinIcon, downloadIcon, triggerNodesConnectionIcon, changeNodesConnectorLineCurve } from '$src/svgIcons/index.ts'
import type { BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'

export const CANVAS_IMAGE_CONTEXT = 'canvasImage'
export const CANVAS_EDGE_CONTEXT = 'canvasEdge'

const magicIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>'

type CanvasBubbleMenuCallbacks = {
    onDeleteNode: (nodeId: string) => void
    onDeleteEdge: (edgeId: string) => void
    onChangeConnectorCurve: (edgeId: string) => void
    onAskAi: (nodeId: string) => void
    onDownloadImage: (nodeId: string) => void
    onTriggerConnection: (nodeId: string) => void
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
    getActiveEdgeId: () => string | null
    setActiveEdgeId: (edgeId: string | null) => void
} {
    let activeNodeId: string | null = null
    let activeEdgeId: string | null = null

    const askAiButton = createCanvasButton({
        icon: magicIcon,
        title: 'Ask AI',
        iconSize: 17,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onAskAi(activeNodeId)
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

    const connectButton = createEl('button', {
        className: 'bubble-menu-button',
        type: 'button',
        title: 'Connect to node',
        innerHTML: triggerNodesConnectionIcon,
    })
    const connectSvg = connectButton.querySelector('svg')
    if (connectSvg) {
        connectSvg.style.width = '16px'
        connectSvg.style.height = '16px'
    }
    connectButton.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (activeNodeId) {
            callbacks.onHide()
            callbacks.onTriggerConnection(activeNodeId)
        }
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

    const deleteEdgeButton = createCanvasButton({
        icon: trashBinIcon,
        title: 'Delete connection',
        iconSize: 16,
        onClick: () => {
            if (activeEdgeId) {
                callbacks.onDeleteEdge(activeEdgeId)
                callbacks.onHide()
            }
        },
    })

    const changeCurveButton = createCanvasButton({
        icon: changeNodesConnectorLineCurve,
        title: 'Change connector curve',
        iconSize: 16,
        onClick: () => {
            if (activeEdgeId) {
                callbacks.onChangeConnectorCurve(activeEdgeId)
                callbacks.onHide()
            }
        },
    })

    const items: BubbleMenuItem[] = [
        { element: askAiButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: downloadButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: connectButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: deleteButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: changeCurveButton, context: [CANVAS_EDGE_CONTEXT] },
        { element: deleteEdgeButton, context: [CANVAS_EDGE_CONTEXT] },
    ]

    return {
        items,
        getActiveNodeId: () => activeNodeId,
        setActiveNodeId: (nodeId: string | null) => { activeNodeId = nodeId },
        getActiveEdgeId: () => activeEdgeId,
        setActiveEdgeId: (edgeId: string | null) => { activeEdgeId = edgeId },
    }
}
