import {
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'
import { planSceneTransition } from '@lixpi/canvas-engine/shared'

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
    const transition = planSceneTransition({ currentSceneKey: input.currentRouteWorkspaceId, nextSceneKey: input.nextRouteWorkspaceId, renderedSceneKey: input.renderedWorkspaceId, hasSnapshot: Boolean(input.incomingCanvasState), failed: input.loadingStatus === LoadingStatus.error })
    return {
        routeWorkspaceId: transition.sceneKey,
        routeWorkspaceChanged: transition.routeChanged,
        loadedWorkspaceChanged: transition.loadedChanged,
        shouldTreatAsWorkspaceChanged: transition.sceneChanged,
        shouldClearVisualContent: transition.clearContent,
        shouldShowLoadingOutline: transition.showLoading,
    }
}
