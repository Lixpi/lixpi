import { describe, expect, it } from 'vitest'

import {
    shouldPreserveLiveViewportForViewportOnlyRender,
    viewportsMatch,
    type ViewportSnapshot,
    type WorkspaceViewportRenderPlanInput,
} from '$src/infographics/workspace/workspaceViewportStatePlan.ts'

function makeViewport(overrides: Partial<ViewportSnapshot> = {}): ViewportSnapshot {
    return {
        x: 672.8041612129193,
        y: -733.7018286603416,
        zoom: 0.1,
        ...overrides,
    }
}

function makeInput(overrides: Partial<WorkspaceViewportRenderPlanInput> = {}): WorkspaceViewportRenderPlanInput {
    return {
        incomingViewport: makeViewport({ x: 663.8041612129193, y: -425.70182866034156 }),
        liveViewport: makeViewport(),
        viewportChanged: true,
        visualStateChanged: false,
        needsRerender: false,
        workspaceChanged: false,
        ...overrides,
    }
}

// =============================================================================
// STALE VIEWPORT-ONLY RENDER REGRESSION
// =============================================================================

describe('workspace viewport state plan — stale viewport-only renders', () => {
    it('preserves the live viewport when a delayed store render would replay an older pan position', () => {
        const preserveLiveViewport = shouldPreserveLiveViewportForViewportOnlyRender(makeInput())

        expect(preserveLiveViewport).toBe(true)
    })

    it('accepts a debounced persistence acknowledgement when it matches the live viewport', () => {
        const liveViewport = makeViewport()
        const preserveLiveViewport = shouldPreserveLiveViewportForViewportOnlyRender(makeInput({
            incomingViewport: liveViewport,
            liveViewport,
        }))

        expect(preserveLiveViewport).toBe(false)
    })

    it.each([
        {
            reason: 'the viewport did not change',
            overrides: { viewportChanged: false },
        },
        {
            reason: 'nodes or edges changed',
            overrides: { visualStateChanged: true },
        },
        {
            reason: 'the render needs a full DOM rebuild',
            overrides: { needsRerender: true },
        },
        {
            reason: 'the workspace changed',
            overrides: { workspaceChanged: true },
        },
    ])('does not preserve the live viewport when $reason', ({ overrides }) => {
        const preserveLiveViewport = shouldPreserveLiveViewportForViewportOnlyRender(makeInput(overrides))

        expect(preserveLiveViewport).toBe(false)
    })

    it.each([
        {
            reason: 'the incoming canvas state has no viewport',
            overrides: { incomingViewport: null },
        },
        {
            reason: 'the renderer has no live viewport yet',
            overrides: { liveViewport: null },
        },
    ])('does not preserve the live viewport when $reason', ({ overrides }) => {
        const preserveLiveViewport = shouldPreserveLiveViewportForViewportOnlyRender(makeInput(overrides))

        expect(preserveLiveViewport).toBe(false)
    })
})

// =============================================================================
// VIEWPORT EQUALITY TOLERANCE
// =============================================================================

describe('workspace viewport state plan — viewport equality tolerance', () => {
    it('treats tiny floating-point transform noise as the same viewport', () => {
        const liveViewport = makeViewport()
        const incomingViewport = makeViewport({
            x: liveViewport.x + 0.0009,
            y: liveViewport.y - 0.0009,
            zoom: liveViewport.zoom + 0.00009,
        })

        expect(viewportsMatch(incomingViewport, liveViewport)).toBe(true)
        expect(shouldPreserveLiveViewportForViewportOnlyRender(makeInput({ incomingViewport, liveViewport }))).toBe(false)
    })

    it('treats visible pan or zoom deltas as different viewports', () => {
        const liveViewport = makeViewport()
        const incomingViewport = makeViewport({ y: liveViewport.y + 308 })

        expect(viewportsMatch(incomingViewport, liveViewport)).toBe(false)
        expect(shouldPreserveLiveViewportForViewportOnlyRender(makeInput({ incomingViewport, liveViewport }))).toBe(true)
    })
})