export type ViewportSnapshot = {
    x: number
    y: number
    zoom: number
}

export type ViewportRenderPlanInput = {
    incomingViewport: ViewportSnapshot | null | undefined
    liveViewport: ViewportSnapshot | null | undefined
    sceneChanged: boolean
}

export const viewportsMatch = (
    a: ViewportSnapshot | null | undefined,
    b: ViewportSnapshot | null | undefined,
): boolean => {
    if (
        !a
        || !b
    )
        return false

    return Math.abs(a.x - b.x) < 0.001
        && Math.abs(a.y - b.y) < 0.001
        && Math.abs(a.zoom - b.zoom) < 0.0001
}

export const shouldPreserveLiveViewportForScene = (input: ViewportRenderPlanInput): boolean => {
    const {
        incomingViewport,
        liveViewport,
        sceneChanged,
    } = input

    return Boolean(
        incomingViewport
            && liveViewport
            && !sceneChanged
            && !viewportsMatch(incomingViewport, liveViewport),
    )
}
