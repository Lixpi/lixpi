// =============================================================================
// CANVAS BUBBLE MENU ITEMS
//
// Menu items for the workspace canvas bubble menu. Supports image nodes and
// video nodes (Delete, Download, Replace, save, Connect), plus edge connections
// (Delete). Framework-agnostic — uses only DOM and callbacks. No ProseMirror
// imports.
// =============================================================================

import { createEl, applyStyle } from '$src/utils/domTemplates.ts'
import {
    trashBinIcon,
    downloadIcon,
    triggerNodesConnectionIcon,
    changeNodesConnectorLineCurve,
    mediaLibraryIcon
} from '$src/svgIcons/index.ts'
import type { BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'

export const CANVAS_IMAGE_CONTEXT = 'canvasImage'
export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'
export const CANVAS_EDGE_CONTEXT = 'canvasEdge'

const magicIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>'
// const libraryIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v4H4z"/><path d="M4 11h16v8H4z"/><path d="M12 13v4"/><path d="M10 15h4"/></svg>'

type CanvasBubbleMenuCallbacks = {
    onDeleteNode: (nodeId: string) => void
    onDeleteEdge: (edgeId: string) => void
    onChangeConnectorCurve: (edgeId: string) => void
    onAskAi: (nodeId: string) => void
    onDownloadMedia: (nodeId: string) => void
    onReplaceMedia: (nodeId: string) => void
    onAddToMediaLibrary: (nodeId: string) => void
    canAddToMediaLibrary: (nodeId: string | null) => boolean
    onTriggerConnection: (nodeId: string) => void
    // Spawns a new chat thread that consumes the active VideoCanvasNode as
    // VEO's `video` (extension) input. Mirrors the image "Edit in new thread"
    // contract but routes through the video extension path.
    onExtendVideoInNewThread: (nodeId: string) => void
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
        applyStyle(svg, { width: `${config.iconSize}px`, height: `${config.iconSize}px` })
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
        title: 'Download media',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onDownloadMedia(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const replaceButton = createCanvasButton({
        icon: downloadIcon,
        title: 'Replace media',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onReplaceMedia(activeNodeId)
                callbacks.onHide()
            }
        },
    })
    const replaceSvg = replaceButton.querySelector('svg')
    if (replaceSvg) applyStyle(replaceSvg, { transform: 'rotate(180deg)' })

    const addToLibraryButton = createCanvasButton({
        icon: mediaLibraryIcon,
        title: 'Add to Media Library',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onAddToMediaLibrary(activeNodeId)
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
        applyStyle(connectSvg, { width: '16px', height: '16px' })
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

    const extendVideoButton = createCanvasButton({
        icon: magicIcon,
        title: 'Extend video in new thread',
        iconSize: 17,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onExtendVideoInNewThread(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const deleteVideoButton = createCanvasButton({
        icon: trashBinIcon,
        title: 'Delete video',
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
        { element: replaceButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT] },
        { element: downloadButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT] },
        {
            element: addToLibraryButton,
            context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT],
            update: () => applyStyle(addToLibraryButton, {
                display: callbacks.canAddToMediaLibrary(activeNodeId) ? '' : 'none',
            }),
        },
        // Connect is shared across image + video contexts because both can be
        // wired into a downstream thread the same way.
        { element: connectButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT] },
        { element: deleteButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: extendVideoButton, context: [CANVAS_VIDEO_CONTEXT] },
        { element: deleteVideoButton, context: [CANVAS_VIDEO_CONTEXT] },
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
