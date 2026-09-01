import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeWorldSizeForZoom,
    type BoundedZoomScalingOptions,
} from '@lixpi/canvas-engine/shared'
import {
    LoadingOverlay,
    type LoadingOverlayOptions,
} from '@lixpi/canvas-components/loading'
import { getRoundedOutlinePerimeter } from '@lixpi/canvas-components/effects/outline'
import {
    TravelingSnakeGlassMaterial,
    type GlassMaterialStyle,
} from '@lixpi/canvas-components/effects/glass'

export type WorkspaceLoadingSettings = {
    mediaBranchLineage: { generatedMediaSize: number }
    workspaceLoadingOutline: { diameterScale: number }
    mediaNode: {
        styles: { borderRadius: number }
        inProgressOutlineAnimation: {
            radius: number
            gap: number
            snakeWidth: number
            snakeTailWidthFraction: number
            snakeTailThinLengthFraction: number
            snakeWidthTaperPower: number
            snakeLengthFraction: number
            snakeHeadRoundLengthFraction: number
            animationDurationMs: number
            preFrameCircleScale: number
            zoomScaling: BoundedZoomScalingOptions
            styles: { snakeColors: string[]; snakeTailAlpha: number; glassMaterial: GlassMaterialStyle }
        }
    }
}

export type WorkspaceLoadingOutlineConfig = {
    paneEl: HTMLElement
    settings: WorkspaceLoadingSettings
    onRetry?: () => void
    onError?: (error: unknown) => void
}

export type WorkspaceLoadingOutlineInstance = Pick<LoadingOverlay, 'setVisible' | 'setErrorMessage' | 'destroy'>

export function getWorkspaceLoadingPresentation(settings: WorkspaceLoadingSettings): Pick<LoadingOverlayOptions, 'outline' | 'errorTitle' | 'retryLabel'> {
    const animation = settings.mediaNode.inProgressOutlineAnimation
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const configuredScale = Number(animation.preFrameCircleScale)
    const scale = Number.isFinite(configuredScale) && configuredScale > 0 ? Math.min(1, configuredScale) : 1 / 3
    const configuredDiameter = Number(settings.workspaceLoadingOutline.diameterScale)
    const diameterScale = Number.isFinite(configuredDiameter) && configuredDiameter > 0 ? configuredDiameter : 1
    const size = Math.max(1, Math.max(1, generatedMediaSize * scale) * diameterScale)
    const getStrokeScale = () => scaleCanvasChromeWorldSizeForZoom(1, 1, getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling ?? { minZoom: 0 }))
    const outset = ((animation.gap ?? 0) + animation.snakeWidth / 2) * getStrokeScale()
    const configuredRadius = settings.mediaNode.styles.borderRadius
    const radius = Number.isFinite(configuredRadius) && configuredRadius > 0 ? Math.min(configuredRadius, generatedMediaSize / 2) : 0
    const nodePerimeter = getRoundedOutlinePerimeter(generatedMediaSize + outset * 2, generatedMediaSize + outset * 2, radius + outset)
    const circlePerimeter = getRoundedOutlinePerimeter(size + outset * 2, size + outset * 2, size / 2 + outset)
    const validPerimeters = nodePerimeter > 0 && circlePerimeter > 0
    return {
        errorTitle: 'Workspace failed to load',
        retryLabel: 'Retry',
        outline: {
            size,
            durationMs: validPerimeters ? animation.animationDurationMs * (circlePerimeter / nodePerimeter) : undefined,
            snakeLengthFraction: validPerimeters ? Math.min(0.98, animation.snakeLengthFraction * (nodePerimeter / circlePerimeter)) : undefined,
            getStrokeScale,
            style: {
                radius: animation.radius,
                gap: animation.gap ?? 0,
                snakeHeadWidth: animation.snakeWidth,
                snakeTailWidthFraction: animation.snakeTailWidthFraction ?? 0.18,
                snakeTailThinLengthFraction: animation.snakeTailThinLengthFraction,
                snakeWidthTaperPower: animation.snakeWidthTaperPower,
                snakeLengthFraction: animation.snakeLengthFraction,
                snakeHeadRoundLengthFraction: animation.snakeHeadRoundLengthFraction,
                edgeFeatherFraction: animation.styles.glassMaterial.edgeFeatherFraction,
                durationMs: animation.animationDurationMs,
            },
            texture: new TravelingSnakeGlassMaterial(animation.styles.snakeColors, animation.styles.snakeTailAlpha, animation.styles.glassMaterial).bake(),
        },
    }
}

export function createWorkspaceLoadingOutline(config: WorkspaceLoadingOutlineConfig): WorkspaceLoadingOutlineInstance {
    return new LoadingOverlay({
        root: config.paneEl,
        ...getWorkspaceLoadingPresentation(config.settings),
        onRetry: config.onRetry,
        onError: config.onError ?? (error => console.error('Failed to initialize workspace loading outline:', error)),
    })
}
