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
    infoCircleFilledIcon,
} from '@lixpi/ui-kit/svg'
import type { BubbleMenuItem } from '@lixpi/ui-kit/components/bubble-menu'

export const CANVAS_IMAGE_CONTEXT = 'canvasImage'
export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'
export const CANVAS_DOCUMENT_CONTEXT = 'canvasDocument'
export const CANVAS_AUDIO_CONTEXT = 'canvasAudio'
export const CANVAS_EDGE_CONTEXT = 'canvasEdge'

type CanvasBubbleMenuCallbacks = {
    onDeleteNode: (nodeId: string) => void
    onDeleteEdge: (edgeId: string) => void
    onChangeConnectorCurve: (edgeId: string) => void
    onDownloadMedia: (nodeId: string) => void
    onReplaceMedia: (nodeId: string) => void
    onOpenAsset: (nodeId: string) => void
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
        'aria-label': config.title,
        innerHTML: config.icon,
        data: { helpTooltip: 'aria-label' },
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

    const assetDetailsButton = createCanvasButton({
        icon: infoCircleFilledIcon,
        title: 'Open Asset details',
        iconSize: 16,
        onClick: () => {
            if (activeNodeId) {
                callbacks.onOpenAsset(activeNodeId)
                callbacks.onHide()
            }
        },
    })

    const connectButton = createEl('button', {
        className: 'bubble-menu-button',
        type: 'button',
        'aria-label': 'Connect to node',
        innerHTML: triggerNodesConnectionIcon,
        data: { helpTooltip: 'aria-label' },
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

    const deleteFileButton = createCanvasButton({
        icon: trashBinIcon,
        title: 'Delete file',
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
        { element: replaceButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT] },
        { element: downloadButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT] },
        { element: assetDetailsButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT] },
        // Connect is shared across all media contexts because any node can be
        // wired into a downstream thread the same way.
        { element: connectButton, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT] },
        { element: deleteButton, context: [CANVAS_IMAGE_CONTEXT] },
        { element: deleteVideoButton, context: [CANVAS_VIDEO_CONTEXT] },
        { element: deleteFileButton, context: [CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT] },
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
