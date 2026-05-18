export type ViewportSnapshot = {
    x: number
    y: number
    zoom: number
}

export type WorkspaceViewportRenderPlanInput = {
    incomingViewport: ViewportSnapshot | null | undefined
    liveViewport: ViewportSnapshot | null | undefined
    viewportChanged: boolean
    visualStateChanged: boolean
    needsRerender: boolean
    workspaceChanged: boolean
}

export function viewportsMatch(a: ViewportSnapshot | null | undefined, b: ViewportSnapshot | null | undefined): boolean {
    if (!a || !b) return false
    return Math.abs(a.x - b.x) < 0.001 &&
        Math.abs(a.y - b.y) < 0.001 &&
        Math.abs(a.zoom - b.zoom) < 0.0001
}

export function shouldPreserveLiveViewportForViewportOnlyRender(input: WorkspaceViewportRenderPlanInput): boolean {
    const {
        incomingViewport,
        liveViewport,
        viewportChanged,
        visualStateChanged,
        needsRerender,
        workspaceChanged,
    } = input

    return Boolean(
        incomingViewport &&
        liveViewport &&
        viewportChanged &&
        !visualStateChanged &&
        !needsRerender &&
        !workspaceChanged &&
        !viewportsMatch(incomingViewport, liveViewport)
    )
}