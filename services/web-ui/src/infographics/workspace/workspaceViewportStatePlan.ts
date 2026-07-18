export type ViewportSnapshot = {
    x: number
    y: number
    zoom: number
}

export type WorkspaceViewportRenderPlanInput = {
    incomingViewport: ViewportSnapshot | null | undefined
    liveViewport: ViewportSnapshot | null | undefined
    workspaceChanged: boolean
}

export function viewportsMatch(a: ViewportSnapshot | null | undefined, b: ViewportSnapshot | null | undefined): boolean {
    if (!a || !b) return false
    return Math.abs(a.x - b.x) < 0.001 &&
        Math.abs(a.y - b.y) < 0.001 &&
        Math.abs(a.zoom - b.zoom) < 0.0001
}

export function shouldPreserveLiveViewportForSameWorkspaceRender(input: WorkspaceViewportRenderPlanInput): boolean {
    const {
        incomingViewport,
        liveViewport,
        workspaceChanged,
    } = input

    return Boolean(
        incomingViewport &&
        liveViewport &&
        !workspaceChanged &&
        !viewportsMatch(incomingViewport, liveViewport)
    )
}
