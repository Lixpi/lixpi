import { computeCenteredPositionToRightOfRect } from '@lixpi/canvas-engine/shared'

type RectLike = {
    x: number
    y: number
    width: number
    height: number
}
type Dimensions = {
    width: number
    height: number
}
type Point = {
    x: number
    y: number
}

export type ReferenceBranchRootMarkerPlacementOptions = {
    referenceGroupRect: RectLike
    markerDimensions: Dimensions
    mediaHeight: number
    rootToFirstMediaGap: number
    markerToMediaGap: number
    referenceToMarkerMinGap: number
}

// Computes the neutral/root lineage marker position for reference-only
// generations. The marker is allowed to preserve the configured first-media slot
// when there is enough room, but it is clamped after the reference group so a
// long marker label can never slide back under the source media.
export const computeReferenceBranchRootMarkerPosition = (options: ReferenceBranchRootMarkerPlacementOptions): Point => {
    const desiredMediaPosition = computeCenteredPositionToRightOfRect(
        options.referenceGroupRect,
        options.mediaHeight,
        options.rootToFirstMediaGap,
    )
    const markerXForConfiguredMediaSlot = desiredMediaPosition.x
        - options.markerToMediaGap
        - options.markerDimensions.width
    const referenceRight = options.referenceGroupRect.x + options.referenceGroupRect.width
    const minimumMarkerX = referenceRight + Math.max(0, options.referenceToMarkerMinGap)

    return {
        x: Math.max(markerXForConfiguredMediaSlot, minimumMarkerX),
        y: desiredMediaPosition.y + (options.mediaHeight - options.markerDimensions.height) / 2,
    }
}
