// Pure media geometry shared by the API projection and the WebUI canvas:
// aspect-ratio fitting, lineage continuation placement, and the screen-fixed
// controls envelope reserved around resolved media in collision boxes.

import { mediaGenerationLayoutSettings } from '@lixpi/constants'
import {
    getAdaptiveBoundedZoomScalingOptions,
    computeVerticallyCenteredY,
    scaleCanvasControlsWorldSizeForZoom,
} from '@lixpi/canvas-engine/shared'

export type SizeLike = {
    width: number
    height: number
}
export type RectLike = {
    x: number
    y: number
    width: number
    height: number
}

export const getGeneratedMediaProgressCollisionRect = (
    mediaCollisionRect: RectLike,
    anchor: {
        position: {
            x: number
            y: number
        }
        dimensions: SizeLike
    },
    progressHeight: number,
    progressWidth = mediaGenerationLayoutSettings.generatedMediaProgress.width,
    gap = mediaGenerationLayoutSettings.generatedMediaProgress.gap,
): RectLike => {
    if (
        !Number.isFinite(progressHeight)
        || progressHeight <= 0
        || !Number.isFinite(progressWidth)
        || progressWidth <= 0
    )
        return mediaCollisionRect

    const progressLeft = anchor.position.x + anchor.dimensions.width + gap
    const progressTop = progressHeight <= anchor.dimensions.height
        ? anchor.position.y + (anchor.dimensions.height - progressHeight) / 2
        : anchor.position.y
    const left = Math.min(mediaCollisionRect.x, progressLeft)
    const top = Math.min(mediaCollisionRect.y, progressTop)
    const right = Math.max(mediaCollisionRect.x + mediaCollisionRect.width, progressLeft + progressWidth)
    const bottom = Math.max(mediaCollisionRect.y + mediaCollisionRect.height, progressTop + progressHeight)

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

// Position for the next lineage item to the right of a rect, vertically centered.
export const computeLineageContinuationPositionToRightOfRect = (
    rect: RectLike,
    itemHeight: number,
    horizontalGap: number,
): {
    x: number
    y: number
} => {
    return {
        x: rect.x + rect.width + horizontalGap,
        y: computeVerticallyCenteredY(rect, itemHeight),
    }
}

export type GeneratedOutputControlsCollisionInsets = {
    top: number
    bottom: number
}

const getMaximumGeneratedMediaControlsWorldSize = (baseSize: number): number => {
    const zoomScaling = getAdaptiveBoundedZoomScalingOptions(mediaGenerationLayoutSettings.generatedMediaControls.zoomScaling)

    return Math.max(
        baseSize,
        scaleCanvasControlsWorldSizeForZoom(
            baseSize,
            zoomScaling.minZoom,
            zoomScaling,
        ),
    )
}

// Resolved media title/actions are screen-fixed DOM controls, so their largest
// world-space footprint occurs at the bounded curve's lower zoom breakpoint.
// Pending media callers use the compact pre-frame circle instead of this box.
export const getGeneratedOutputControlsCollisionInsets = (nodeType: 'image' | 'video' | 'audio' | 'capabilityArtifact'): GeneratedOutputControlsCollisionInsets => {
    const controls = mediaGenerationLayoutSettings.generatedMediaControls
    const bottomBaseHeight = controls.topGap
        + controls.iconSize
        + (nodeType === 'video'
            ? controls.videoControlsBottomInset + controls.videoControlsHeight
            : 0)

    return {
        top: getMaximumGeneratedMediaControlsWorldSize(controls.titleCollisionHeight),
        bottom: getMaximumGeneratedMediaControlsWorldSize(bottomBaseHeight),
    }
}

export const getGeneratedOutputControlsCollisionHeight = (nodeType: 'image' | 'video' | 'audio' | 'capabilityArtifact'): number =>
    getGeneratedOutputControlsCollisionInsets(nodeType).bottom

export const getGeneratedMediaControlsCollisionHeight = getGeneratedOutputControlsCollisionHeight
