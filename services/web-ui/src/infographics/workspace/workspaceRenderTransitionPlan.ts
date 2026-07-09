import {
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'

export type WorkspaceRenderTransitionPlanInput = {
    currentRouteWorkspaceId: string
    nextRouteWorkspaceId?: string
    renderedWorkspaceId: string | null
    incomingCanvasState: CanvasState | null
    loadingStatus: LoadingStatus
}

export type WorkspaceRenderTransitionPlan = {
    routeWorkspaceId: string
    routeWorkspaceChanged: boolean
    loadedWorkspaceChanged: boolean
    shouldTreatAsWorkspaceChanged: boolean
    shouldClearVisualContent: boolean
    shouldShowLoadingOutline: boolean
}

export function planWorkspaceRenderTransition(input: WorkspaceRenderTransitionPlanInput): WorkspaceRenderTransitionPlan {
    const routeWorkspaceId = input.nextRouteWorkspaceId || input.currentRouteWorkspaceId
    const routeWorkspaceChanged = Boolean(input.nextRouteWorkspaceId && input.nextRouteWorkspaceId !== input.currentRouteWorkspaceId)
    const hasLoadedCanvasState = Boolean(input.incomingCanvasState)
    const hasRouteWorkspaceId = Boolean(routeWorkspaceId)
    const renderedWorkspaceId = input.renderedWorkspaceId
    const loadedWorkspaceChanged = Boolean(hasLoadedCanvasState && hasRouteWorkspaceId && routeWorkspaceId !== renderedWorkspaceId)
    const loadingWorkspaceSwitch = Boolean(hasRouteWorkspaceId && !hasLoadedCanvasState && routeWorkspaceId !== renderedWorkspaceId)

    return {
        routeWorkspaceId,
        routeWorkspaceChanged,
        loadedWorkspaceChanged,
        shouldTreatAsWorkspaceChanged: routeWorkspaceChanged || loadedWorkspaceChanged,
        shouldClearVisualContent: loadingWorkspaceSwitch,
        shouldShowLoadingOutline: loadingWorkspaceSwitch && input.loadingStatus !== LoadingStatus.error,
    }
}
