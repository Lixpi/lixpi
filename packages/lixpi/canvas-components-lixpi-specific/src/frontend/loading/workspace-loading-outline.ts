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
import {
    type WorkspaceLoadingOutlineSettings,
} from '../settings/types.ts'

export type WorkspaceLoadingSettings = {
    mediaBranchLineage: { generatedMediaSize: number }
    workspaceLoadingOutline: WorkspaceLoadingOutlineSettings
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

export const getWorkspaceLoadingPresentation = (settings: WorkspaceLoadingSettings): Pick<LoadingOverlayOptions, 'outline' | 'errorTitle' | 'retryLabel'> => {
    const animation = settings.mediaNode.inProgressOutlineAnimation
    const loading = settings.workspaceLoadingOutline
    const getStrokeScale = () => scaleCanvasChromeWorldSizeForZoom(
        1,
        1,
        getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling ?? { minZoom: 0 }),
    )

    return {
        errorTitle: 'Workspace failed to load',
        retryLabel: 'Retry',
        outline: {
            size: loading.diameter,
            durationMs: loading.animationDurationMs,
            // Measure the trail against this circle, not the larger media node.
            snakeLengthFraction: loading.snakeLengthFraction,
            getStrokeScale,
            style: {
                radius: animation.radius,
                gap: animation.gap ?? 0,
                snakeHeadWidth: animation.snakeWidth,
                snakeTailWidthFraction: animation.snakeTailWidthFraction ?? 0.18,
                snakeTailThinLengthFraction: animation.snakeTailThinLengthFraction,
                snakeWidthTaperPower: animation.snakeWidthTaperPower,
                snakeLengthFraction: loading.snakeLengthFraction,
                snakeHeadRoundLengthFraction: animation.snakeHeadRoundLengthFraction,
                edgeFeatherFraction: animation.styles.glassMaterial.edgeFeatherFraction,
                durationMs: loading.animationDurationMs,
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
        ...getWorkspaceLoadingPresentation(config.settings),
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
