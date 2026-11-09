import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    workspacePersistenceSettings,
} from '@lixpi/constants'
import { createCanvasConnectorSettings } from '@lixpi/canvas-components/connectors'
import { createCanvasEffectsTheme } from '@lixpi/canvas-components/theme'
import { lixpiLightTheme } from '@lixpi/themes'
import {
    type LixpiCanvasPalette,
    type LixpiCanvasSettings,
} from './types.ts'

export const createLixpiCanvasSettings = (palette: Partial<LixpiCanvasPalette> = {}): LixpiCanvasSettings => {
    const canvasPalette: LixpiCanvasPalette = {
        steelBlue: lixpiLightTheme.text.muted,
        offWhite: lixpiLightTheme.accent.foreground,
        nightBlue: lixpiLightTheme.text.secondary,
        ...palette,
    }

    const effects = createCanvasEffectsTheme()

    // Each canvas can override nested settings without changing another canvas or shared API geometry.
    return structuredClone({
        canvasBubbleMenu: {
            // Lower zoom breakpoint for canvas bubble-menu chrome. Runtime call sites
            // opt this config into the shared adaptive low-zoom curve, which defaults
            // to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },

        canvasChrome: {
            // Shared glass coefficients with the product's established unthemed colors.
            glassBorder: {
                enabled: effects.glassBorder.enabled,
                widthPx: effects.glassBorder.widthPx,
                displacementScalePx: effects.glassBorder.displacementScalePx,
                displacementMapMaxDimensionPx: effects.glassBorder.displacementMapMaxDimensionPx,
                edgeRefractionStrength: effects.glassBorder.edgeRefractionStrength,
                surfaceWaveStrength: effects.glassBorder.surfaceWaveStrength,
                causticBandStrength: effects.glassBorder.causticBandStrength,
                displacementFrequencyX: effects.glassBorder.displacementFrequencyX,
                displacementFrequencyY: effects.glassBorder.displacementFrequencyY,
                bodyColor: '#ffffff',
                bodyAlpha: effects.glassBorder.bodyAlpha,
                highlightColor: '#ffffff',
                highlightAlpha: effects.glassBorder.highlightAlpha,
                shadowColor: '#415061',
                shadowAlpha: effects.glassBorder.shadowAlpha,
                materialColors: ['#ffffff', '#f7fbff', '#edf4ff', '#ffffff'],
                materialTailAlpha: effects.glassBorder.materialTailAlpha,
                glassMaterial: {
                    ...effects.glassBorder.glassMaterial,
                    shadowColor: '#415061',
                },
            },
        },

        connector: createCanvasConnectorSettings({ lineDefaultColor: canvasPalette.steelBlue }),

        selection: {
            styles: {
                // Border color for the drag-to-select marquee rectangle.
                marqueeBorderColor: 'rgba(176, 173, 224, 0.88)',
                // Fill color for the drag-to-select marquee rectangle.
                marqueeBackgroundColor: 'rgba(230, 233, 246, 0.38)',
                // Border color for the persistent multi-selection overlay.
                overlayBorderColor: 'rgba(197, 192, 238, 0.62)',
                // Fill color for the persistent multi-selection overlay.
                overlayBackgroundColor: 'rgba(230, 233, 246, 0.42)',
            },
        },

        workspaceCollision: workspaceCollisionSettings,

        mediaNode: {
            // ── Shared across all media types (image, video, …) ──

            styles: {
                // Box shadow applied to media nodes in their default state. Keep this subtler than the selected shadow so selection remains the stronger visual state.
                defaultBoxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
                // Box shadow applied when a media node is selected. Increasing this makes selected media read as more prominent on the canvas.
                selectedBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
                // Canvas-unit corner radius for media pixels and browser-composited media surfaces on the workspace canvas.
                borderRadius: 30,
            },

            // Provenance/descriptor controls below a media node. The strip is screen-space chrome projected from media node bounds and uses bounded zoom compensation; details render in the right sidebar.
            generatedMediaChrome: {
                // Base screen-pixel icon/button size at 100% and higher zoom. Shared with the API collision boxes via @lixpi/constants.
                iconSize: mediaGenerationLayoutSettings.generatedMediaChrome.iconSize,
                // Base screen-pixel gap between media and the control strip at 100% and higher zoom. Shared with the API collision boxes via @lixpi/constants.
                gap: mediaGenerationLayoutSettings.generatedMediaChrome.topGap,
                // Scale applied to generated-media badges rendered inside AI chat history cards.
                chatScale: 0.72,
                // Separator between the provider brand and model title in the model badge, e.g. "OpenAI : GPT Image 2". Includes its own surrounding spacing so it can be tuned freely (" : ", " — ", " / ", …).
                modelBadgeSeparator: ' : ',
                // Lower zoom breakpoint for generated-media icon chrome. Runtime call
                // sites opt this config into the shared adaptive low-zoom curve,
                // which defaults to 0.45 unless this object provides `lowZoomPower`.
                zoomScaling: mediaGenerationLayoutSettings.generatedMediaChrome.zoomScaling,
                // Theme tokens for the model badge + info button, surfaced as CSS custom properties.
                styles: {
                    // Gap between the provider icon and the provider/model name.
                    modelBadgeIconGap: '3px',
                    // Provider brand + separator color (the model title overrides with the darker value below so it reads as primary).
                    modelBadgeProviderColor: '#4d5963',
                    // Model title color — darker than the provider for emphasis.
                    modelBadgeModelColor: '#181e23',
                    modelBadgeNameFontSize: '15px',
                    modelBadgeNameFontWeight: 400,
                    modelBadgeNameLineHeight: 1.5,
                    // Interactive chrome icons match the provider icon at rest and darken on hover.
                    infoButtonColor: '#4d5963',
                    infoButtonHoverColor: '#181e23',
                },
            },

            // Keep resize corner handles at a stable apparent size as the canvas zoom changes.
            useZoomCompensatedResizeHandleScaling: true,
            // Resize-handle base sizes and zoom breakpoint, shared by image and video resize.
            resizeHandle: {
                // Base screen-pixel size of each resize handle at 100% and higher zoom.
                size: 24,
                // Base screen-pixel offset from the node corner at 100% and higher zoom.
                offset: 6,
                // Minimum handle size in canvas units after zoom compensation.
                minSize: 10,
                // Lower zoom breakpoint for resize handles. Runtime call sites opt
                // this config into the shared adaptive low-zoom curve, which defaults
                // to 0.45 unless this object provides `lowZoomPower`.
                zoomScaling: { minZoom: 0.4 },
            },

            // Shared outline geometry and material coefficients retain the product's legacy gradient.
            inProgressOutlineAnimation: {
                radius: effects.generationOutline.radius,
                gap: effects.generationOutline.gap,
                // Shared with the API's generation layout.
                preFrameCircleScale: mediaGenerationLayoutSettings.preFrameCircleScale,
                snakeWidth: effects.generationOutline.snakeHeadWidth,
                snakeTailWidthFraction: effects.generationOutline.snakeTailWidthFraction,
                snakeTailThinLengthFraction: effects.generationOutline.snakeTailThinLengthFraction,
                snakeWidthTaperPower: effects.generationOutline.snakeWidthTaperPower,
                snakeLengthFraction: effects.generationOutline.snakeLengthFraction,
                snakeHeadRoundLengthFraction: effects.generationOutline.snakeHeadRoundLengthFraction,
                animationDurationMs: effects.generationOutline.durationMs,
                // Runtime opts this product-specific breakpoint into the adaptive low-zoom curve.
                zoomScaling: { minZoom: 0 },
                developmentFlags: {
                    alwaysOn: false,
                },
                styles: {
                    snakeTailAlpha: effects.generationOutline.tailAlpha,
                    snakeColors: ['#ff0084', '#ff39b0', '#fc75c6', '#eba0f5', '#f1c2e9', '#e0d6ff', '#eaeaff', '#DAD7F1', '#E8E4F6'],
                    glassMaterial: {
                        ...effects.generationOutline.glassMaterial,
                        shadowColor: '#4E5B6C',
                    },
                },
            },

            // ── Image-specific ──
            image: {
                // Canvas-unit width for manually inserted image nodes. Height is derived from the image aspect ratio; failed dimension probes use this as a square fallback.
                defaultInsertionWidth: 600,
            },
        },

        workspaceLoadingOutline: {
            diameter: effects.loadingOutline.diameter,
            animationDurationMs: effects.loadingOutline.durationMs,
            spinCycle: { ...effects.loadingOutline.spinCycle },
            snakeLengthFraction: effects.loadingOutline.snakeLengthFraction,
        },

        mediaBranchLineage: {
            // Canvas-unit base width and height for new generated media nodes. Increasing it makes each generated branch artifact larger when inserted.
            generatedMediaSize: mediaGenerationLayoutSettings.generatedMediaSize,
            // Canvas-unit minimum empty space reserved around every branchOrigin, branchFork, and branchLine marker during placement, drag release, and branch-tree rebalance.
            nodeGap: mediaGenerationLayoutSettings.nodeGap,
            // Canvas-unit horizontal gap between a chat root or reference group and the first generated media node in that branch.
            rootToFirstMediaGap: mediaGenerationLayoutSettings.rootToFirstMediaGap,
            // Canvas-unit vertical gap between separate branch rows spawned from the same chat root. Increasing it moves new branches farther below the previous branch.
            branchRowGap: mediaGenerationLayoutSettings.branchRowGap,
            // Canvas-unit base horizontal gap between consecutive generated media nodes in the same branch lineage.
            mediaToMediaGap: mediaGenerationLayoutSettings.mediaToMediaGap,
            // Canvas-unit horizontal gap from a temporary branchOrigin marker to its first generated media node.
            branchOriginToFirstMediaGap: mediaGenerationLayoutSettings.branchOriginToFirstMediaGap,
            // Canvas-unit extra horizontal gap added for each extra generated media node when a lineage forks. Increasing it gives large branch fans more curve room.
            branchFanoutExtraGap: mediaGenerationLayoutSettings.branchFanoutExtraGap,
            // Temporary root marker used when a fresh multi-model branch has no real source node.
            branchOrigin: {
                // Canvas-unit base size for branch lineage markers; final width and height derive from the shared marker sizing in @lixpi/constants.
                size: mediaGenerationLayoutSettings.marker.baseSize,
                // Canvas-unit base size for the branch icon inside marker labels.
                iconSize: 52,
                styles: {
                    backgroundColor: canvasPalette.steelBlue,
                    borderColor: canvasPalette.steelBlue,
                    iconColor: canvasPalette.offWhite,
                    boxShadow: '0 8px 24px rgba(42, 48, 57, 0.22)',
                    separatorGradient: 'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.18) 10%, rgba(255, 255, 255, 0.34) 26%, rgba(255, 255, 255, 0.62) 50%, rgba(255, 255, 255, 0.34) 74%, rgba(255, 255, 255, 0.18) 90%, rgba(255, 255, 255, 0) 100%)',
                },
            },
            // Stacked translucent glass circles that identify which media models produced lineage children.
            mediaModelCircle: {
                // Screen-pixel diameter of each model circle.
                size: 32,
                // Screen-pixel size of the provider/model SVG icon above the glass.
                iconSize: 18,
                // Screen-pixel horizontal gap between the branch lineage node body and the media-model circle stack.
                mainGap: 8,
                // Screen-pixel vertical gap between stacked media-model circles.
                stackGap: 2,
                // CSS-facing theme tokens for the circle shell and foreground icon.
                styles: {
                    // Color applied to the model SVG icon rendered over the glass.
                    iconColor: canvasPalette.nightBlue,
                    // Base circle background behind the baked glass image. Keep transparent unless a fallback fill is needed.
                    backgroundColor: 'transparent',
                    // CSS box-shadow for the circle shell, including any inset rim shadow and external lift shadow.
                    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.1), inset 0 -4px 8px rgba(3, 7, 11, 0.07), 0 7px 18px rgba(18, 24, 31, 0.16)',
                },
                // Shared circular shader coefficients with the established unthemed fallback tint.
                glass: {
                    ...effects.circularGlass,
                    fallbackColors: ['#06133A', '#0A49A7', '#1768D9', '#55A7FF'],
                    material: {
                        ...effects.circularGlass.material,
                        shadowColor: '#03070B',
                    },
                },
                // SVG texture settings for the clipped pattern layer under the icon and over the glass.
                texture: {
                    // Fallback texture color when model metadata has no valid brand color.
                    fallbackColor: '#4B5D70',
                    // Brand-color remap used to tint the SVG pattern toward a lighter glass-readable color.
                    brandColorMix: {
                        // Target color mixed into the model brand color for the pattern fill.
                        targetColor: canvasPalette.nightBlue,
                        // Blend amount from model brand color to the pattern target color.
                        amount: 0.32,
                    },
                    // SVG path fill opacity baked into the generated pattern data URL.
                    fillOpacity: 0.36,
                    // Screen-pixel inset from glass edge to the clipped texture circle.
                    inset: 4,
                    // CSS opacity applied to the clipped pattern layer.
                    opacity: 0.9,
                    // Percent background-size applied to the SVG pattern inside the clipped circle.
                    backgroundSizePercent: 142,
                },
            },
            // Width sizing for the branch marker pill that hugs a user message. The
            // sizing metrics come from the shared mediaGenerationLayoutSettings.marker
            // so the API layout estimates marker dimensions with identical values —
            // tune them in @lixpi/constants only.
            marker: {
                // Multiplier on branchOrigin.size for the marker's comfortable minimum width (the pill never shrinks below this).
                minWidthMultiplier: mediaGenerationLayoutSettings.marker.minWidthMultiplier,
                // Multiplier on the minimum width capping how wide an on-canvas (already-placed) marker may grow before its preview wraps to a second line and truncates. Lower it to keep long placed messages more compact.
                maxWidthGrowth: mediaGenerationLayoutSettings.marker.maxWidthGrowth,
                // Text sizing for the marker's preview lines. Matches the floating detail panel's body text (1rem / 16px) so a marker reads at the same size as the thread it represents.
                text: mediaGenerationLayoutSettings.marker.text,
            },
        },

        workspacePersistence: workspacePersistenceSettings,
    })
}
