import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeWorldSizeForZoom,
    type BoundedZoomScalingOptions,
} from '@lixpi/canvas-engine/shared'
import {
    LoadingLayer,
    type LoadingLease,
} from '@lixpi/canvas-components/loading/layer'
import {
    type LoadingOverlayOptions,
} from '@lixpi/canvas-components/loading'
import {
    TravelingSnakeGlassMaterial,
    type GlassMaterialStyle,
} from '@lixpi/canvas-components/effects/glass'

const LOADING_LAP_DURATION_MS = 1500
const LOADING_TRAIL_FRACTION = 0.6

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
            styles: {
                snakeColors: string[]
                snakeTailAlpha: number
                glassMaterial: GlassMaterialStyle
            }
        }
    }
}

export type WorkspaceLoadingOutlineConfig = {
    paneEl: HTMLElement
    settings: WorkspaceLoadingSettings
    onRetry?: () => void
    onError?: (error: unknown) => void
    layer?: LoadingLayer
}

export type WorkspaceLoadingOutlineInstance = LoadingLease

export const getWorkspaceLoadingPresentation = (
    settings: WorkspaceLoadingSettings,
    diameter?: number,
): Pick<LoadingOverlayOptions, 'outline' | 'errorTitle' | 'retryLabel'> => {
    const animation = settings.mediaNode.inProgressOutlineAnimation
    const generatedMediaSize = settings.mediaBranchLineage.generatedMediaSize
    const configuredScale = Number(animation.preFrameCircleScale)
    const scale = Number.isFinite(configuredScale)
        && configuredScale > 0
        ? Math.min(1, configuredScale)
        : 1 / 3
    const configuredDiameter = Number(settings.workspaceLoadingOutline.diameterScale)
    const diameterScale = Number.isFinite(configuredDiameter)
        && configuredDiameter > 0
        ? configuredDiameter
        : 1
    const size = diameter ?? Math.max(1, Math.max(1, generatedMediaSize * scale) * diameterScale)
    const getStrokeScale = () => scaleCanvasChromeWorldSizeForZoom(
        1,
        1,
        getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling ?? { minZoom: 0 }),
    )

    return {
        errorTitle: 'Workspace failed to load',
        retryLabel: 'Retry',
        outline: {
            size,
            durationMs: LOADING_LAP_DURATION_MS,
            // Measure the trail against this circle, not the larger media node.
            snakeLengthFraction: LOADING_TRAIL_FRACTION,
            getStrokeScale,
            style: {
                radius: animation.radius,
                gap: animation.gap ?? 0,
                snakeHeadWidth: animation.snakeWidth,
                snakeTailWidthFraction: animation.snakeTailWidthFraction ?? 0.18,
                snakeTailThinLengthFraction: animation.snakeTailThinLengthFraction,
                snakeWidthTaperPower: animation.snakeWidthTaperPower,
                snakeLengthFraction: LOADING_TRAIL_FRACTION,
                snakeHeadRoundLengthFraction: animation.snakeHeadRoundLengthFraction,
                edgeFeatherFraction: animation.styles.glassMaterial.edgeFeatherFraction,
                durationMs: LOADING_LAP_DURATION_MS,
            },
            texture: new TravelingSnakeGlassMaterial(
                animation.styles.snakeColors,
                animation.styles.snakeTailAlpha,
                animation.styles.glassMaterial,
            ).bake(),
        },
    }
}

export const createWorkspaceLoadingLayer = (config: Pick<WorkspaceLoadingOutlineConfig, 'paneEl' | 'settings' | 'onError'>): LoadingLayer =>
    new LoadingLayer({
        root: config.paneEl.ownerDocument.body,
        ...getWorkspaceLoadingPresentation(config.settings, 100),
        onError: config.onError ?? (error => console.error('Failed to initialize workspace loading outline:', error)),
    })

export const createWorkspaceLoadingOutline = (config: WorkspaceLoadingOutlineConfig): WorkspaceLoadingOutlineInstance => {
    const layer = config.layer ?? createWorkspaceLoadingLayer(config)
    const lease = layer.acquire({ onRetry: config.onRetry })

    return {
        setVisible: lease.setVisible,
        setErrorMessage: lease.setErrorMessage,
        destroy: () => {
            lease.destroy()

            if (!config.layer)
                layer.destroy()
        },
    }
}
