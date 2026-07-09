'use strict'

// Pure media geometry shared by the API projection and the WebUI canvas:
// aspect-ratio fitting, lineage continuation placement, and the chrome height
// reserved below generated media in collision boxes.

import { mediaGenerationLayoutSettings } from '@lixpi/constants'

export type SizeLike = { width: number; height: number }
export type RectLike = { x: number; y: number; width: number; height: number }

// Fits a bounding box to an aspect ratio, preserving the larger dimension.
export function fitDimensionsToAspectRatio(dimensions: SizeLike, aspectRatio: number): SizeLike {
    const widthFromHeight = dimensions.height * aspectRatio
    if (widthFromHeight <= dimensions.width) {
        return { width: widthFromHeight, height: dimensions.height }
    }
    return { width: dimensions.width, height: dimensions.width / aspectRatio }
}

export function computeVerticallyCenteredY(rect: RectLike, itemHeight: number): number {
    return rect.y + rect.height / 2 - itemHeight / 2
}

// Position for the next lineage item to the right of a rect, vertically centered.
export function computeLineageContinuationPositionToRightOfRect(
    rect: RectLike,
    itemHeight: number,
    horizontalGap: number
): { x: number; y: number } {
    return {
        x: rect.x + rect.width + horizontalGap,
        y: computeVerticallyCenteredY(rect, itemHeight),
    }
}

// Chrome height is reserved for generated media (pending included: the model
// label appears at settle time, and reserving its row up front prevents a
// post-settle reflow). Video additionally reserves its external controls strip.
export function getGeneratedMediaChromeCollisionHeight(nodeType: 'image' | 'video'): number {
    const chrome = mediaGenerationLayoutSettings.generatedMediaChrome
    const baseChromeHeight = chrome.topGap + chrome.iconSize
    if (nodeType !== 'video') return baseChromeHeight
    return chrome.videoControlsBottomInset + chrome.videoControlsHeight + baseChromeHeight
}
