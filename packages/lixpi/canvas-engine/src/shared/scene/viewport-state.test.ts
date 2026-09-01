import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    shouldPreserveLiveViewportForScene,
    viewportsMatch,
    type ViewportSnapshot,
    type ViewportRenderPlanInput,
} from './viewport-state.ts'

function makeViewport(overrides: Partial<ViewportSnapshot> = {}): ViewportSnapshot {
    return {
        x: 672.8041612129193,
        y: -733.7018286603416,
        zoom: 0.1,
        ...overrides,
    }
}

function makeInput(overrides: Partial<ViewportRenderPlanInput> = {}): ViewportRenderPlanInput {
    return {
        incomingViewport: makeViewport({ x: 663.8041612129193, y: -425.70182866034156 }),
        liveViewport: makeViewport(),
        sceneChanged: false,
        ...overrides,
    }
}

// =============================================================================
// SAME-WORKSPACE VIEWPORT OWNERSHIP REGRESSION
// =============================================================================

describe('workspace viewport state plan — same-workspace renders', () => {
    it('preserves the live viewport when a delayed store render would replay an older pan position', () => {
        const preserveLiveViewport = shouldPreserveLiveViewportForScene(makeInput())

        expect(preserveLiveViewport).toBe(true)
    })

    it('accepts a debounced persistence acknowledgement when it matches the live viewport', () => {
        const liveViewport = makeViewport()
        const preserveLiveViewport = shouldPreserveLiveViewportForScene(makeInput({
            incomingViewport: liveViewport,
            liveViewport,
        }))

        expect(preserveLiveViewport).toBe(false)
    })

    it('preserves a newer live zoom even when the incoming persisted viewport has not advanced', () => {
        const liveViewport = makeViewport({ zoom: 0.65 })
        const preserveLiveViewport = shouldPreserveLiveViewportForScene(makeInput({
            incomingViewport: makeViewport({ zoom: 0.25 }),
            liveViewport,
        }))

        expect(preserveLiveViewport).toBe(true)
    })

    it('accepts the incoming viewport when the workspace changes', () => {
        const preserveLiveViewport = shouldPreserveLiveViewportForScene(makeInput({
            sceneChanged: true,
        }))

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
        const preserveLiveViewport = shouldPreserveLiveViewportForScene(makeInput(overrides))

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
        expect(shouldPreserveLiveViewportForScene(makeInput({ incomingViewport, liveViewport }))).toBe(false)
    })

    it('treats visible pan or zoom deltas as different viewports', () => {
        const liveViewport = makeViewport()
        const incomingViewport = makeViewport({ y: liveViewport.y + 308 })

        expect(viewportsMatch(incomingViewport, liveViewport)).toBe(false)
        expect(shouldPreserveLiveViewportForScene(makeInput({ incomingViewport, liveViewport }))).toBe(true)
    })
})
