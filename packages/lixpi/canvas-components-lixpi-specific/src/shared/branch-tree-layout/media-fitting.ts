// Pure media geometry shared by the API projection and the WebUI canvas:
// aspect-ratio fitting, lineage continuation placement, and the screen-fixed
// chrome envelope reserved around resolved media in collision boxes.

import { mediaGenerationLayoutSettings } from '@lixpi/constants'
import {
    getAdaptiveBoundedZoomScalingOptions,
    computeVerticallyCenteredY,
    scaleCanvasChromeWorldSizeForZoom,
} from '@lixpi/canvas-engine/shared'

export type SizeLike = { width: number; height: number }
export type RectLike = { x: number; y: number; width: number; height: number }

export function getGeneratedMediaProgressCollisionRect(
    mediaCollisionRect: RectLike,
    anchor: { position: { x: number; y: number }; dimensions: SizeLike },
    progressHeight: number,
    progressWidth = mediaGenerationLayoutSettings.generatedMediaProgress.width,
    gap = mediaGenerationLayoutSettings.generatedMediaProgress.gap,
): RectLike {
    if (
        !Number.isFinite(progressHeight) || progressHeight <= 0
        || !Number.isFinite(progressWidth) || progressWidth <= 0
    ) return mediaCollisionRect

    const progressLeft = anchor.position.x + anchor.dimensions.width + gap
    const progressTop = progressHeight <= anchor.dimensions.height
        ? anchor.position.y + (anchor.dimensions.height - progressHeight) / 2
        : anchor.position.y
    const left = Math.min(mediaCollisionRect.x, progressLeft)
    const top = Math.min(mediaCollisionRect.y, progressTop)
    const right = Math.max(
        mediaCollisionRect.x + mediaCollisionRect.width,
        progressLeft + progressWidth,
    )
    const bottom = Math.max(
        mediaCollisionRect.y + mediaCollisionRect.height,
        progressTop + progressHeight,
    )
    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

// Position for the next lineage item to the right of a rect, vertically centered.
export function computeLineageContinuationPositionToRightOfRect(
    rect: RectLike,
    itemHeight: number,
    horizontalGap: number,
): { x: number; y: number } {
    return {
        x: rect.x + rect.width + horizontalGap,
        y: computeVerticallyCenteredY(rect, itemHeight),
    }
}

export type GeneratedOutputChromeCollisionInsets = {
    top: number
    bottom: number
}

function getMaximumGeneratedMediaChromeWorldSize(baseSize: number): number {
    const zoomScaling = getAdaptiveBoundedZoomScalingOptions(
        mediaGenerationLayoutSettings.generatedMediaChrome.zoomScaling,
    )
    return Math.max(
        baseSize,
        scaleCanvasChromeWorldSizeForZoom(
            baseSize,
            zoomScaling.minZoom,
            zoomScaling,
        ),
    )
}

// Resolved media title/actions are screen-fixed DOM chrome, so their largest
// world-space footprint occurs at the bounded curve's lower zoom breakpoint.
// Pending media callers use the compact pre-frame circle instead of this box.
export function getGeneratedOutputChromeCollisionInsets(
    nodeType: 'image' | 'video' | 'capabilityArtifact',
): GeneratedOutputChromeCollisionInsets {
    const chrome = mediaGenerationLayoutSettings.generatedMediaChrome
    const bottomBaseHeight = chrome.topGap
        + chrome.iconSize
        + (nodeType === 'video'
            ? chrome.videoControlsBottomInset + chrome.videoControlsHeight
            : 0)
    return {
        top: getMaximumGeneratedMediaChromeWorldSize(chrome.titleCollisionHeight),
        bottom: getMaximumGeneratedMediaChromeWorldSize(bottomBaseHeight),
    }
}

export function getGeneratedOutputChromeCollisionHeight(nodeType: 'image' | 'video' | 'capabilityArtifact'): number {
    return getGeneratedOutputChromeCollisionInsets(nodeType).bottom
}

export const getGeneratedMediaChromeCollisionHeight = getGeneratedOutputChromeCollisionHeight
