'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { GlassMaterialStyle } from '@lixpi/canvas-components/effects/glass'
import {
    getWorkspaceLoadingPresentation,
    type WorkspaceLoadingSettings,
} from './workspace-loading-outline.ts'

vi.mock('@lixpi/canvas-components/loading', () => ({ LoadingOverlay: class {} }))
vi.mock('@lixpi/canvas-components/effects/glass', () => ({
    TravelingSnakeGlassMaterial: class {
        bake() {
            return { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array(4) }
        }
    },
}))

function settings(): WorkspaceLoadingSettings {
    return {
        mediaBranchLineage: { generatedMediaSize: 300 },
        workspaceLoadingOutline: { diameterScale: 2 },
        mediaNode: {
            styles: { borderRadius: 12 },
            inProgressOutlineAnimation: {
                radius: 12,
                gap: 3,
                snakeWidth: 4,
                snakeTailWidthFraction: 0.2,
                snakeTailThinLengthFraction: 0.1,
                snakeWidthTaperPower: 0.86,
                snakeLengthFraction: 0.8,
                snakeHeadRoundLengthFraction: 0.5,
                animationDurationMs: 1000,
                preFrameCircleScale: 1 / 3,
                zoomScaling: { minZoom: 0.1 },
                styles: { snakeColors: ['#ffffff'], snakeTailAlpha: 0.1, glassMaterial: { edgeFeatherFraction: 0.5 } as GlassMaterialStyle },
            },
        },
    }
}

describe('workspace loading presentation', () => {
    it('sizes the circle from the generated-output envelope and preserves its lap speed', () => {
        const presentation = getWorkspaceLoadingPresentation(settings())
        const nodePerimeter = 2 * (310 + 310 - 4 * 17) + 2 * Math.PI * 17
        const circlePerimeter = 2 * Math.PI * 105
        expect(presentation.outline.size).toBe(200)
        expect(presentation.outline.durationMs).toBeCloseTo(1000 * circlePerimeter / nodePerimeter)
        expect(presentation.outline.snakeLengthFraction).toBe(Math.min(0.98, 0.8 * nodePerimeter / circlePerimeter))
        expect(presentation.errorTitle).toBe('Workspace failed to load')
        expect(presentation.retryLabel).toBe('Retry')
    })

    it('preserves invalid-scale fallbacks and limits the pre-frame circle to the media size', () => {
        const config = settings()
        config.mediaNode.inProgressOutlineAnimation.preFrameCircleScale = Number.NaN
        config.workspaceLoadingOutline.diameterScale = -1
        expect(getWorkspaceLoadingPresentation(config).outline.size).toBe(100)
        config.mediaNode.inProgressOutlineAnimation.preFrameCircleScale = 10
        expect(getWorkspaceLoadingPresentation(config).outline.size).toBe(300)
    })
})
