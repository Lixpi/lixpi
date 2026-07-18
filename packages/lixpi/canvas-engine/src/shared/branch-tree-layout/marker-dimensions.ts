'use strict'

// Text-driven branch-marker pill sizing shared by the API (authoritative layout
// estimates) and the WebUI (rendered marker resize). Both sides MUST derive
// marker dimensions from these functions and the shared metric settings so
// server-resolved layout reserves exactly the space the client paints.

import { mediaGenerationLayoutSettings } from '@lixpi/constants'
import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
} from '@lixpi/constants'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

export type BranchMarkerDimensionOptions = {
    responseLine?: boolean
    responseText?: string
    screenFixed?: boolean
}

// Marker text can grow while reasoning streams. Preserve the connector's
// vertical center across that resize; fork/line markers also preserve their
// horizontal center because they sit at the midpoint of a connector. A root
// branchOrigin keeps its left anchor stable while its output side expands.
export function resizeBranchMarkerToDimensions<T extends BranchMarkerNode>(
    node: T,
    dimensions: { width: number; height: number },
): T {
    if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node
    const widthDelta = dimensions.width - node.dimensions.width
    const heightDelta = dimensions.height - node.dimensions.height
    return {
        ...node,
        position: {
            x: node.type === 'branchOrigin'
                ? node.position.x
                : node.position.x - widthDelta / 2,
            y: node.position.y - heightDelta / 2,
        },
        dimensions,
    } as T
}

const marker = mediaGenerationLayoutSettings.marker

export function getBranchMarkerPromptPreview(promptText: string): string {
    if (!promptText) return ''
    if (promptText.length <= marker.promptPreviewMaxChars) return promptText
    return `${promptText.slice(0, marker.promptPreviewMaxChars)}...`
}

// Streaming reasoning text scrolls past the marker as a tail while receiving.
export function getBranchMarkerResponsePreview(responseText: string, options: { isReceiving?: boolean } = {}): string {
    const normalized = responseText.replace(/\s+/g, ' ').trim()
    if (normalized.length <= marker.responsePreviewMaxChars) return normalized
    if (options.isReceiving) return `…${normalized.slice(-marker.responsePreviewMaxChars)}`
    return `${normalized.slice(0, marker.responsePreviewMaxChars)}...`
}

function getMessageLineHeight(): number {
    return Math.ceil(marker.text.messageFontSize * marker.text.messageLineHeight)
}

function getResponseLineHeight(): number {
    return Math.ceil(marker.text.responseFontSize * marker.text.responseLineHeight)
}

export function getBranchMarkerMinWidth(): number {
    return Math.round(marker.baseSize * marker.minWidthMultiplier)
}

export function getBranchMarkerScreenFixedMinWidth(): number {
    return Math.round(marker.baseSize * 1.1)
}

// Match the natural single-line height (vertical padding + one message line) so
// a one-line marker isn't inflated relative to a wrapped two-line one.
function getMarkerMinHeight(): number {
    return marker.verticalPadding + getMessageLineHeight()
}

function getMarkerWidthForText(promptText: string, responseText = ''): number {
    const minWidth = getBranchMarkerMinWidth()
    const maxWidth = minWidth * marker.maxWidthGrowth
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    const responsePreview = getBranchMarkerResponsePreview(responseText)
    const previewCharCount = Math.max(promptPreview.length, responsePreview.length)
    // Target a single line; longer messages keep growing until they hit the
    // ceiling, then wrap to (and truncate at) two lines.
    const desiredWidth = marker.horizontalPadding + previewCharCount * marker.approxCharWidth
    return Math.round(Math.max(minWidth, Math.min(maxWidth, desiredWidth)))
}

function getMarkerPromptLineCount(promptText: string, width: number): number {
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    const charsPerLine = Math.max(1, Math.floor((width - marker.horizontalPadding) / marker.lineWrapCharWidth))
    return promptPreview.length > charsPerLine ? 2 : 1
}

// Sizing for the screen-fixed preflight pose: the prompt stays on one line up to
// a wider ceiling (then truncates), while the response row adds height only once
// streamed text is visible. Shorter and wider than the on-canvas pill.
function getScreenFixedDimensions(promptText: string, responseLine: boolean, responseText = ''): { width: number; height: number } {
    const minWidth = getBranchMarkerScreenFixedMinWidth()
    const maxWidth = getBranchMarkerMinWidth() * marker.screenFixedMaxWidthGrowth
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    const responsePreview = getBranchMarkerResponsePreview(responseText)
    const previewCharCount = Math.max(promptPreview.length, responsePreview.length)
    const desiredWidth = marker.screenFixedHorizontalPadding + previewCharCount * marker.approxCharWidth
    const responseHeight = responseLine
        ? marker.screenFixedSeparatorHeight + getResponseLineHeight()
        : 0
    return {
        width: Math.round(Math.max(minWidth, Math.min(maxWidth, desiredWidth))),
        height: marker.screenFixedVerticalPadding + getMessageLineHeight() + responseHeight,
    }
}

// Single estimator both sides use. On-canvas pose by default; pass
// screenFixed: true for the preflight composer-attached pose.
export function estimateBranchMarkerDimensions(
    promptText: string,
    options: BranchMarkerDimensionOptions = {},
): { width: number; height: number } {
    if (options.screenFixed) return getScreenFixedDimensions(promptText, Boolean(options.responseLine), options.responseText)

    const width = getMarkerWidthForText(promptText, options.responseText)
    const promptLineCount = getMarkerPromptLineCount(promptText, width)
    const responseHeight = options.responseLine
        ? marker.separatorHeight + getResponseLineHeight()
        : 0
    return {
        width,
        height: Math.max(
            getMarkerMinHeight(),
            Math.ceil(
                marker.verticalPadding
                + promptLineCount * getMessageLineHeight()
                + responseHeight
            )
        ),
    }
}
