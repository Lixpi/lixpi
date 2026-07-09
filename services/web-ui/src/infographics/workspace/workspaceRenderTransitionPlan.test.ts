import { describe, expect, it } from 'vitest'
import {
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'

import { planWorkspaceRenderTransition } from '$src/infographics/workspace/workspaceRenderTransitionPlan.ts'

function makeCanvasState(): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
    }
}

// =============================================================================
// SLOW WORKSPACE SWITCH REGRESSION
// =============================================================================

describe('workspace render transition plan — slow workspace switches', () => {
    it('keeps the loaded workspace render marked as a workspace switch after an unloaded route render', () => {
        const loadingPlan = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: 'workspace-a',
            nextRouteWorkspaceId: 'workspace-b',
            renderedWorkspaceId: 'workspace-a',
            incomingCanvasState: null,
            loadingStatus: LoadingStatus.loading,
        })

        expect(loadingPlan.shouldClearVisualContent).toBe(true)
        expect(loadingPlan.shouldShowLoadingOutline).toBe(true)
        expect(loadingPlan.shouldTreatAsWorkspaceChanged).toBe(true)

        const loadedPlan = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: 'workspace-b',
            nextRouteWorkspaceId: 'workspace-b',
            renderedWorkspaceId: 'workspace-a',
            incomingCanvasState: makeCanvasState(),
            loadingStatus: LoadingStatus.success,
        })

        expect(loadedPlan.loadedWorkspaceChanged).toBe(true)
        expect(loadedPlan.shouldTreatAsWorkspaceChanged).toBe(true)
        expect(loadedPlan.shouldClearVisualContent).toBe(false)
        expect(loadedPlan.shouldShowLoadingOutline).toBe(false)
    })

    it('does not hide stale content behind a failed workspace load', () => {
        const plan = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: 'workspace-a',
            nextRouteWorkspaceId: 'workspace-b',
            renderedWorkspaceId: 'workspace-a',
            incomingCanvasState: null,
            loadingStatus: LoadingStatus.error,
        })

        expect(plan.shouldClearVisualContent).toBe(true)
        expect(plan.shouldShowLoadingOutline).toBe(false)
    })

    it('does not treat an already rendered workspace as loading when its state is temporarily absent', () => {
        const plan = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: 'workspace-a',
            nextRouteWorkspaceId: 'workspace-a',
            renderedWorkspaceId: 'workspace-a',
            incomingCanvasState: null,
            loadingStatus: LoadingStatus.loading,
        })

        expect(plan.shouldClearVisualContent).toBe(false)
        expect(plan.shouldShowLoadingOutline).toBe(false)
        expect(plan.shouldTreatAsWorkspaceChanged).toBe(false)
    })
})
