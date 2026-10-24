import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type GlassMaterialStyle,
} from '@lixpi/canvas-components/effects/glass'
import {
    getWorkspaceLoadingPresentation,
    type WorkspaceLoadingSettings,
} from './workspace-loading-outline.ts'

vi.mock('@lixpi/canvas-components/effects/glass', () => ({
    TravelingSnakeGlassMaterial: class {
        bake() {
            return {
                kind: 'pixels',
                size: {
                    width: 1,
                    height: 1,
                },
                rgba: new Uint8Array(4),
            }
        }
    },
}))

const settings = (): WorkspaceLoadingSettings => {
    return {
        mediaBranchLineage: { generatedMediaSize: 300 },
        workspaceLoadingOutline: {
            diameter: 140,
            animationDurationMs: 875,
            snakeLengthFraction: 0.55,
        },
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
                styles: {
                    snakeColors: ['#ffffff'],
                    snakeTailAlpha: 0.1,
                    glassMaterial: { edgeFeatherFraction: 0.5 } as GlassMaterialStyle,
                },
            },
        },
    }
}

describe('workspace loading presentation', () => {
    it('reads the circle diameter, lap duration, and trail length from loading settings', () => {
        const config = settings()
        const presentation = getWorkspaceLoadingPresentation(config)
        expect(presentation.outline.size).toBe(config.workspaceLoadingOutline.diameter)
        expect(presentation.outline.style.snakeHeadWidth).toBe(4)
        expect(presentation.outline.texture.kind).toBe('pixels')
        expect(presentation.outline.durationMs).toBe(config.workspaceLoadingOutline.animationDurationMs)
        expect(presentation.outline.snakeLengthFraction).toBe(config.workspaceLoadingOutline.snakeLengthFraction)
    })
    it('preserves the lap duration and proportional gap when the circle size changes', () => {
        const config = settings()
        config.workspaceLoadingOutline.diameter = 200
        const presentation = getWorkspaceLoadingPresentation(config)
        expect(presentation.outline.size).toBe(200)
        expect(presentation.outline.durationMs).toBe(config.workspaceLoadingOutline.animationDurationMs)
        expect(presentation.outline.style.durationMs).toBe(config.workspaceLoadingOutline.animationDurationMs)
        expect(presentation.outline.snakeLengthFraction).toBe(config.workspaceLoadingOutline.snakeLengthFraction)
        expect(presentation.outline.style.snakeLengthFraction).toBe(config.workspaceLoadingOutline.snakeLengthFraction)
        expect(presentation.errorTitle).toBe('Workspace failed to load')
        expect(presentation.retryLabel).toBe('Retry')
    })

    it('does not derive loading dimensions or timing from generated media settings', () => {
        const config = settings()
        config.mediaBranchLineage.generatedMediaSize = 1200
        config.mediaNode.inProgressOutlineAnimation.preFrameCircleScale = 0.9
        config.mediaNode.inProgressOutlineAnimation.animationDurationMs = 4000
        config.mediaNode.inProgressOutlineAnimation.snakeLengthFraction = 0.9
        const presentation = getWorkspaceLoadingPresentation(config)
        expect(presentation.outline.size).toBe(config.workspaceLoadingOutline.diameter)
        expect(presentation.outline.durationMs).toBe(config.workspaceLoadingOutline.animationDurationMs)
        expect(presentation.outline.snakeLengthFraction).toBe(config.workspaceLoadingOutline.snakeLengthFraction)
    })
})
