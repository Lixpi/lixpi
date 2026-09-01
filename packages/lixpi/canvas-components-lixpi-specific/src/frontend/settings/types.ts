import type {
    WorkspaceCollisionSettings,
    WorkspacePersistenceSettings,
} from '@lixpi/constants'
import type { BoundedZoomScalingOptions } from '@lixpi/canvas-engine/shared'
import type { ConnectionSettings } from '@lixpi/canvas-engine/frontend/connectors'
import type {
    CircularGlassMaterialStyle,
    GlassMaterialStyle,
} from '@lixpi/canvas-components/effects/glass'

export type BoundedZoomScalingSettings = BoundedZoomScalingOptions
export type ConnectorSettings = ConnectionSettings
export type GenerationBorderGlassMaterialSettings = GlassMaterialStyle

export type CanvasBubbleMenuSettings = {
    zoomScaling: BoundedZoomScalingSettings
}

export type CanvasChromeSettings = {
    glassBorder: {
        enabled: boolean
        widthPx: number
        displacementScalePx: number
        displacementMapMaxDimensionPx: number
        edgeRefractionStrength: number
        surfaceWaveStrength: number
        causticBandStrength: number
        displacementFrequencyX: number
        displacementFrequencyY: number
        bodyColor: string
        bodyAlpha: number
        highlightColor: string
        highlightAlpha: number
        shadowColor: string
        shadowAlpha: number
        materialColors: string[]
        materialTailAlpha: number
        glassMaterial: GenerationBorderGlassMaterialSettings
    }
}

export type SelectionSettings = {
    styles: {
        marqueeBorderColor: string
        marqueeBackgroundColor: string
        overlayBorderColor: string
        overlayBackgroundColor: string
        outlineColor: string
    }
}

export type MediaNodeSettings = {
    // Shared across all media types (image, video, …).
    styles: {
        defaultBoxShadow: string
        selectedBoxShadow: string
        borderRadius: number
    }
    generatedMediaChrome: {
        iconSize: number
        gap: number
        chatScale: number
        modelBadgeSeparator: string
        zoomScaling: BoundedZoomScalingSettings
        styles: {
            modelBadgeIconGap: string
            modelBadgeProviderColor: string
            modelBadgeModelColor: string
            modelBadgeNameFontSize: string
            modelBadgeNameFontWeight: number
            modelBadgeNameLineHeight: number
            infoButtonColor: string
            infoButtonHoverColor: string
        }
    }
    useZoomCompensatedResizeHandleScaling: boolean
    resizeHandle: {
        size: number
        offset: number
        minSize: number
        zoomScaling: BoundedZoomScalingSettings
    }
    inProgressOutlineAnimation: {
        radius: number
        gap: number
        preFrameCircleScale: number
        snakeWidth: number
        snakeTailWidthFraction: number
        snakeTailThinLengthFraction: number
        snakeWidthTaperPower: number
        snakeLengthFraction: number
        snakeHeadRoundLengthFraction: number
        animationDurationMs: number
        zoomScaling: BoundedZoomScalingSettings
        developmentFlags: {
            alwaysOn: boolean
        }
        styles: {
            snakeTailAlpha: number
            snakeColors: string[]
            glassMaterial: GenerationBorderGlassMaterialSettings
        }
    }
    // Image-specific.
    image: {
        defaultInsertionWidth: number
    }
}

export type WorkspaceLoadingOutlineSettings = {
    // Diameter of the workspace-switch loading circle relative to the generated-media pending circle.
    diameterScale: number
}

export type MediaBranchLineageColorMixSettings = {
    targetColor: string
    amount: number
}

export type MediaBranchLineageColorAdjustSettings = {
    saturationMultiplier: number
    minSaturation: number
    maxSaturation: number
    lightnessMultiplier: number
    minLightness: number
    maxLightness: number
}

export type MediaBranchLineageMediaModelCircleSettings = {
    size: number
    iconSize: number
    mainGap: number
    stackGap: number
    styles: {
        iconColor: string
        backgroundColor: string
        boxShadow: string
    }
    glass: {
        textureSize: number
        translucency: number
        rimFeatherFraction: number
        fallbackColors: string[]
        brandColorAdjust: MediaBranchLineageColorAdjustSettings
        brandColorStops: MediaBranchLineageColorMixSettings[]
        material: GenerationBorderGlassMaterialSettings
        discMaterial: CircularGlassMaterialStyle
    }
    texture: {
        fallbackColor: string
        brandColorMix: MediaBranchLineageColorMixSettings
        fillOpacity: number
        inset: number
        opacity: number
        backgroundSizePercent: number
    }
}

export type MediaBranchLineageSettings = {
    generatedMediaSize: number
    nodeGap: number
    rootToFirstMediaGap: number
    branchRowGap: number
    mediaToMediaGap: number
    branchOriginToFirstMediaGap: number
    branchFanoutExtraGap: number
    branchOrigin: {
        size: number
        iconSize: number
        styles: {
            backgroundColor: string
            borderColor: string
            iconColor: string
            boxShadow: string
            separatorGradient: string
        }
    }
    mediaModelCircle: MediaBranchLineageMediaModelCircleSettings
    marker: {
        minWidthMultiplier: number
        maxWidthGrowth: number
        // Text sizing for the marker's user-message and AI-response preview lines.
        // Kept in sync with the floating detail panel so a marker reads at the same
        // size as the expanded thread it represents.
        text: {
            // Pixel font size of the user-message preview line (the bold prompt text).
            messageFontSize: number
            // Unitless line-height multiplier applied to the user-message preview.
            messageLineHeight: number
            // Pixel font size of the AI-response preview line below the separator.
            responseFontSize: number
            // Unitless line-height multiplier applied to the AI-response preview.
            responseLineHeight: number
        }
    }
}

export type LixpiCanvasPalette = {
    steelBlue: string
    offWhite: string
    nightBlue: string
}

export type LixpiCanvasSettings = {
    canvasBubbleMenu: CanvasBubbleMenuSettings
    canvasChrome: CanvasChromeSettings
    connector: ConnectorSettings
    selection: SelectionSettings
    workspaceCollision: WorkspaceCollisionSettings
    mediaNode: MediaNodeSettings
    workspaceLoadingOutline: WorkspaceLoadingOutlineSettings
    mediaBranchLineage: MediaBranchLineageSettings
    workspacePersistence: WorkspacePersistenceSettings
}
