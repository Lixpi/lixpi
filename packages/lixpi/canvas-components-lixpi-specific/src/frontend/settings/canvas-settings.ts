import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    workspacePersistenceSettings,
} from '@lixpi/constants'
import { createWorkspaceConnectorSettings } from '../connectors/workspace-connector-settings.ts'
import type {
    LixpiCanvasPalette,
    LixpiCanvasSettings,
} from './types.ts'

export function createLixpiCanvasSettings(palette: Partial<LixpiCanvasPalette> = {}): LixpiCanvasSettings {
    const colorPalette: LixpiCanvasPalette = {
        steelBlue: '#5d656d',
        offWhite: '#f5f3f3',
        nightBlue: '#42494f',
        ...palette,
    }

    // Each canvas can override nested settings without changing another canvas or shared API geometry.
    return structuredClone({
        canvasBubbleMenu: {
            // Lower zoom breakpoint for canvas bubble-menu chrome. Runtime call sites
            // opt this config into the shared adaptive low-zoom curve, which defaults
            // to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },

        canvasChrome: {
            // Pixi glass border for bottom canvas controls.
            glassBorder: {
                // Enables the Pixi render-texture refraction border around composer controls.
                enabled: true,
                // Width of the refractive ring in screen pixels.
                widthPx: 10,
                // Pixel offset strength used by the Pixi displacement filter that refracts captured canvas content.
                displacementScalePx: 34,
                // Upper bound for the generated screen-space displacement map.
                displacementMapMaxDimensionPx: 1600,
                // Normal-direction edge pinch strength. Higher values pull pixels harder across the glass edge.
                edgeRefractionStrength: 0.95,
                // Tangential wave strength for the liquid smear inside the ring.
                surfaceWaveStrength: 0.26,
                // Secondary bright-band distortion strength along the border thickness.
                causticBandStrength: 0.34,
                // Horizontal wave frequency for the procedural liquid displacement.
                displacementFrequencyX: 4.8,
                // Vertical wave frequency for the procedural liquid displacement.
                displacementFrequencyY: 3.9,
                // Transparent body tint drawn only inside the ring.
                bodyColor: '#ffffff',
                // Body tint alpha inside the ring.
                bodyAlpha: 0.035,
                // Specular rim color.
                highlightColor: '#ffffff',
                // Specular rim alpha.
                highlightAlpha: 0.2,
                // Subtle inner-shadow rim color.
                shadowColor: '#415061',
                // Subtle inner-shadow rim alpha.
                shadowAlpha: 0.1,
                // Baked Pixi glass material colors for the closed border mesh.
                materialColors: ['#ffffff', '#f7fbff', '#edf4ff', '#ffffff'],
                // Closed border meshes do not tail-fade; this stays fully present before material alpha is applied.
                materialTailAlpha: 1,
                glassMaterial: {
                    // Dark tint mixed into the soft lower rim of the glass.
                    shadowColor: '#415061',
                    // Kept for shared material compatibility; closed strip opacity is forced by the material subclass.
                    tailOpacityPower: 1,
                    // Disabled so the rounded-rectangle border has no tail seam.
                    tailFadeFraction: 0,
                    // Closed strip minimum opacity.
                    minTailOpacity: 1,
                    // Extra transparent feather width as a fraction of the visible border width.
                    edgeFeatherFraction: 0.22,
                    // Exponent applied to the feather mask.
                    edgeFeatherPower: 1.34,
                    // Cross-section lens exponent.
                    lensCorePower: 0.5,
                    // Vertical center of the main specular highlight, from outer edge 0 to inner edge 1.
                    upperSpecularCenter: 0.24,
                    // Subtle drift along the closed outline path.
                    upperSpecularDrift: 0.02,
                    // Width of the main specular highlight across the border body.
                    upperSpecularWidth: 0.18,
                    // Closed strips have no tail, so the highlight is present immediately.
                    upperSpecularFadeStart: 0,
                    // Closed strips have no tail, so the highlight is present immediately.
                    upperSpecularFadeEnd: 0.01,
                    // Brightness contribution from the main specular highlight.
                    upperSpecularStrength: 0.13,
                    // Longitudinal center of the inherited head glint.
                    headSpecularProgressCenter: 0.52,
                    // Longitudinal width of the inherited head glint.
                    headSpecularProgressWidth: 0.42,
                    // Cross-section center of the inherited head glint.
                    headSpecularCrossSectionCenter: 0.48,
                    // Cross-section width of the inherited head glint.
                    headSpecularCrossSectionWidth: 0.28,
                    // Brightness contribution from the inherited head glint.
                    headSpecularStrength: 0.04,
                    // Cross-section center of the lower glass shadow rim.
                    lowerEdgeShadowCenter: 0.86,
                    // Width of the lower glass shadow rim.
                    lowerEdgeShadowWidth: 0.22,
                    // Darkness contribution from the lower glass shadow rim.
                    lowerEdgeShadowStrength: 0.12,
                    // Cross-section center of the upper glass shadow rim.
                    upperEdgeShadowCenter: 0.08,
                    // Width of the upper glass shadow rim.
                    upperEdgeShadowWidth: 0.18,
                    // Darkness contribution from the upper glass shadow rim.
                    upperEdgeShadowStrength: 0.05,
                    // Power curve for the broad edge shadow.
                    edgeShadowPower: 2.1,
                    // Darkness contribution from the broad edge shadow.
                    edgeShadowStrength: 0.035,
                    // Brightness contribution from the rounded lens core.
                    lensHighlightStrength: 0.06,
                    // Maximum amount of white mixed into highlights.
                    highlightWhiteMixMax: 0.24,
                    // Maximum amount of shadow color mixed into edge shadows.
                    shadowMixMax: 0.1,
                    // Baseline material opacity before cross-section highlights are added.
                    materialAlphaBase: 0.018,
                    // Maximum material opacity before the feathered edge mask is applied.
                    materialAlphaMax: 0.14,
                    // Opacity contribution from the rounded lens core.
                    lensAlphaStrength: 0.05,
                    // Opacity contribution from the main specular highlight.
                    upperSpecularAlphaStrength: 0.035,
                    // Opacity contribution from the inherited head glint.
                    headSpecularAlphaStrength: 0.016,
                },
            },
        },

        connector: createWorkspaceConnectorSettings({ lineDefaultColor: colorPalette.steelBlue }),

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
                // Outline color for a selected thread's floating prompt input.
                outlineColor: 'rgba(197, 192, 238, 0.75)',
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

            // PIXI-rendered animated outline shown while media work is in progress.
            inProgressOutlineAnimation: {
                // Fallback rounded-corner radius for the snake path when a media-specific clip radius is unavailable.
                radius: 10,
                // Empty screen-pixel gap between the media node edge and the inside edge of the snake at 100% zoom.
                gap: 3,
                // Diameter of the pre-first-frame generation circle as a fraction of the pending media node's shortest side.
                preFrameCircleScale: mediaGenerationLayoutSettings.preFrameCircleScale,
                // Screen-pixel width of the snake head at 100% zoom. The body tapers from this value toward the tail.
                snakeWidth: 9,
                // Tail width as a fraction of `snakeWidth`; lower values make the tail taper to a finer point.
                snakeTailWidthFraction: 0.14,
                // Fraction of the snake path held near the minimum tail width before the body starts widening.
                snakeTailThinLengthFraction: 0.1,
                // Power curve for the tail-to-head width ramp. Higher values keep the trail thin longer without changing total snake length.
                snakeWidthTaperPower: 0.86,
                // Fraction of the rounded media perimeter occupied by the visible snake.
                snakeLengthFraction: 0.24,
                // Rounded head length as a fraction of the feather-expanded snake width. Higher values make the endpoint softer without protruding past the head.
                snakeHeadRoundLengthFraction: 0.5,
                // Milliseconds for one complete lap around the media node.
                animationDurationMs: 3200,
                // Lower zoom breakpoint for the PIXI generation outline stroke widths. Runtime call sites opt this config into the shared adaptive low-zoom curve.
                zoomScaling: { minZoom: 0 },
                developmentFlags: {
                    // Shows the outline on every media node for visual tuning.
                    alwaysOn: false,
                },
                styles: {
                    // Tail fade preference. The glass renderer keeps a material-opacity floor so the tail fades without turning into mist.
                    snakeTailAlpha: 0,
                    // Tail-to-head colors inspired by the shifting gradient and model menu divider, with a bright iridescent amethyst tail.
                    snakeColors: ['#ff0084', '#ff39b0', '#fc75c6', '#eba0f5', '#f1c2e9', '#e0d6ff', '#eaeaff', '#DAD7F1', '#E8E4F6'],
                    glassMaterial: {
                        // Dark tint mixed into the soft lower rim of the glass.
                        shadowColor: '#4E5B6C',
                        // Exponent for tail-to-head opacity growth. Lower values make the tail become visible sooner.
                        tailOpacityPower: 0.72,
                        // Fraction of snake length used to fade the tail in from fully transparent.
                        tailFadeFraction: 0.08,
                        // Minimum opacity floor after the tail fade finishes.
                        minTailOpacity: 0.62,
                        // Extra transparent feather width as a fraction of the visible snake width. Higher values blur outward without shrinking the core.
                        edgeFeatherFraction: 0.1,
                        // Exponent applied to the feather mask. Higher values make the fade more gradual at the outer edge.
                        edgeFeatherPower: 1.18,
                        // Cross-section lens exponent. Lower values spread the rounded glass body farther toward the edges.
                        lensCorePower: 0.42,
                        // Vertical center of the main specular highlight, from top edge 0 to bottom edge 1.
                        upperSpecularCenter: 0.32,
                        // How far the main specular highlight drifts across the width as it travels along the snake.
                        upperSpecularDrift: 0.035,
                        // Width of the main specular highlight across the snake body.
                        upperSpecularWidth: 0.16,
                        // Tail progress where the main specular highlight starts fading in.
                        upperSpecularFadeStart: 0.1,
                        // Tail progress where the main specular highlight reaches full strength.
                        upperSpecularFadeEnd: 0.32,
                        // Brightness contribution from the main specular highlight.
                        upperSpecularStrength: 0.24,
                        // Longitudinal center of the head glint, from tail 0 to head 1.
                        headSpecularProgressCenter: 0.91,
                        // Longitudinal width of the head glint.
                        headSpecularProgressWidth: 0.22,
                        // Cross-section center of the head glint, from top edge 0 to bottom edge 1.
                        headSpecularCrossSectionCenter: 0.48,
                        // Cross-section width of the head glint.
                        headSpecularCrossSectionWidth: 0.26,
                        // Brightness contribution from the head glint.
                        headSpecularStrength: 0.18,
                        // Cross-section center of the lower glass shadow rim.
                        lowerEdgeShadowCenter: 0.88,
                        // Width of the lower glass shadow rim.
                        lowerEdgeShadowWidth: 0.2,
                        // Darkness contribution from the lower glass shadow rim.
                        lowerEdgeShadowStrength: 0.16,
                        // Cross-section center of the upper glass shadow rim.
                        upperEdgeShadowCenter: 0.1,
                        // Width of the upper glass shadow rim.
                        upperEdgeShadowWidth: 0.2,
                        // Darkness contribution from the upper glass shadow rim.
                        upperEdgeShadowStrength: 0.07,
                        // Power curve for the broad edge shadow. Higher values push shadow closer to the edge.
                        edgeShadowPower: 2.2,
                        // Darkness contribution from the broad edge shadow.
                        edgeShadowStrength: 0.04,
                        // Brightness contribution from the rounded lens core.
                        lensHighlightStrength: 0.08,
                        // Maximum amount of white mixed into highlights.
                        highlightWhiteMixMax: 0.3,
                        // Maximum amount of shadow color mixed into edge shadows.
                        shadowMixMax: 0.14,
                        // Baseline material opacity before cross-section highlights are added.
                        materialAlphaBase: 0.72,
                        // Maximum material opacity before the feathered edge mask is applied.
                        materialAlphaMax: 0.94,
                        // Opacity contribution from the rounded lens core.
                        lensAlphaStrength: 0.16,
                        // Opacity contribution from the main specular highlight.
                        upperSpecularAlphaStrength: 0.04,
                        // Opacity contribution from the head glint.
                        headSpecularAlphaStrength: 0.03,
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
            // Relative to the generated-media pending circle. 0.6 makes the workspace-switch spinner 40% smaller in diameter.
            diameterScale: 0.6,
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
                    backgroundColor: colorPalette.steelBlue,
                    borderColor: colorPalette.steelBlue,
                    iconColor: colorPalette.offWhite,
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
                    iconColor: colorPalette.nightBlue,
                    // Base circle background behind the baked glass image. Keep transparent unless a fallback fill is needed.
                    backgroundColor: 'transparent',
                    // CSS box-shadow for the circle shell, including any inset rim shadow and external lift shadow.
                    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.1), inset 0 -4px 8px rgba(3, 7, 11, 0.07), 0 7px 18px rgba(18, 24, 31, 0.16)',
                },
                // Baked circular glass image settings and brand-color remapping.
                glass: {
                    // Baked once per color at this resolution; reused as a CSS background.
                    textureSize: 128,
                    // Dense translucent body with enough transmission for internal caustic light.
                    translucency: 0.97,
                    // Soft round rim so the disc edge fades instead of aliasing.
                    rimFeatherFraction: 0.04,
                    // Fallback cool glass tint for models without synced brand colors.
                    fallbackColors: ['#06133A', '#0A49A7', '#1768D9', '#55A7FF'],
                    // Brand-color transform applied before glass stops are mixed, forcing deep saturated color instead of pastel brand tints.
                    brandColorAdjust: {
                        // Multiplier applied to the model brand color's HSL saturation before stop mixing.
                        saturationMultiplier: 2.1,
                        // Minimum HSL saturation for the adjusted model color so lower-saturation brand colors still read as strong color.
                        minSaturation: 0.72,
                        // Maximum HSL saturation for the adjusted model color so glass stays rich without turning neon.
                        maxSaturation: 0.9,
                        // Multiplier applied to the model brand color's HSL lightness before stop mixing.
                        lightnessMultiplier: 0.72,
                        // Minimum HSL lightness for the adjusted model color so dark brands do not collapse to black.
                        minLightness: 0.36,
                        // Maximum HSL lightness for the adjusted model color so light brands stay deep and saturated.
                        maxLightness: 0.46,
                    },
                    // Model brand color is remixed into the glass gradient through these stops.
                    brandColorStops: [
                        {
                            // Target color mixed into the first, darkest glass stop.
                            targetColor: '#020714',
                            // Blend amount from the model brand color to the first stop target.
                            amount: 0.28,
                        },
                        {
                            // Target color mixed into the second, saturated body stop.
                            targetColor: '#000000',
                            // Blend amount from the model brand color to the second stop target.
                            amount: 0.02,
                        },
                        {
                            // Target color mixed into the third, bright transmitted-light stop.
                            targetColor: '#FFFFFF',
                            // Blend amount from the model brand color to the third stop target.
                            amount: 0.16,
                        },
                        {
                            // Target color mixed into the fourth, near-white highlight stop.
                            targetColor: '#FFFFFF',
                            // Blend amount from the model brand color to the fourth stop target.
                            amount: 0.34,
                        },
                    ],
                    // Shared glass shader style reused by the circular material baker.
                    material: {
                        // Dark tint color mixed into shadowed glass regions.
                        shadowColor: '#03070B',
                        // Exponent for tail-to-head opacity growth in the shared material sampler.
                        tailOpacityPower: 0.54,
                        // Fraction of material progress used to fade the start from transparent.
                        tailFadeFraction: 0.05,
                        // Minimum material opacity once the fade-in is complete.
                        minTailOpacity: 0.56,
                        // Extra transparent feather width at the material cross-section edge.
                        edgeFeatherFraction: 0.0,
                        // Exponent applied to the edge feather mask.
                        edgeFeatherPower: 1.04,
                        // Cross-section lens exponent controlling how broad the glass core highlight is.
                        lensCorePower: 0.58,
                        // Cross-section center of the upper specular band.
                        upperSpecularCenter: 0.18,
                        // Amount the upper specular band drifts as material progress changes.
                        upperSpecularDrift: 0.02,
                        // Cross-section width of the upper specular band.
                        upperSpecularWidth: 0.08,
                        // Progress value where the upper specular band starts fading in.
                        upperSpecularFadeStart: 0.03,
                        // Progress value where the upper specular band reaches full strength.
                        upperSpecularFadeEnd: 0.14,
                        // Brightness contribution from the upper specular band.
                        upperSpecularStrength: 0.46,
                        // Progress center of the head glint in the shared material model.
                        headSpecularProgressCenter: 0.78,
                        // Progress width of the head glint.
                        headSpecularProgressWidth: 0.22,
                        // Cross-section center of the head glint.
                        headSpecularCrossSectionCenter: 0.34,
                        // Cross-section width of the head glint.
                        headSpecularCrossSectionWidth: 0.18,
                        // Brightness contribution from the head glint.
                        headSpecularStrength: 0.34,
                        // Cross-section center of the lower edge shadow.
                        lowerEdgeShadowCenter: 0.9,
                        // Cross-section width of the lower edge shadow.
                        lowerEdgeShadowWidth: 0.18,
                        // Darkness contribution from the lower edge shadow.
                        lowerEdgeShadowStrength: 0.22,
                        // Cross-section center of the upper edge shadow.
                        upperEdgeShadowCenter: 0.08,
                        // Cross-section width of the upper edge shadow.
                        upperEdgeShadowWidth: 0.14,
                        // Darkness contribution from the upper edge shadow.
                        upperEdgeShadowStrength: 0.13,
                        // Power curve for broad edge darkening.
                        edgeShadowPower: 1.8,
                        // Darkness contribution from broad edge darkening.
                        edgeShadowStrength: 0.09,
                        // Brightness contribution from the rounded lens core.
                        lensHighlightStrength: 0.14,
                        // Maximum amount of white mixed into highlights.
                        highlightWhiteMixMax: 0.3,
                        // Maximum amount of shadow color mixed into dark regions.
                        shadowMixMax: 0.16,
                        // Baseline material alpha before lens/specular additions.
                        materialAlphaBase: 0.9,
                        // Maximum material alpha before circular masking and translucency.
                        materialAlphaMax: 0.98,
                        // Alpha contribution from the rounded lens core.
                        lensAlphaStrength: 0.12,
                        // Alpha contribution from the upper specular band.
                        upperSpecularAlphaStrength: 0.05,
                        // Alpha contribution from the head glint.
                        headSpecularAlphaStrength: 0.04,
                    },
                    // Circular-disc-only sampler and lighting coefficients.
                    discMaterial: {
                        // Amount that disc body volume darkens the sampled glass color.
                        absorptionVolumeStrength: 0.035,
                        // Amount that rim fresnel darkens the sampled glass color.
                        absorptionFresnelStrength: 0.2,
                        // Amount that internal shadows darken the sampled glass color.
                        absorptionInnerShadowStrength: 0.22,
                        // Amount that caustic bands brighten transmitted glass color.
                        causticLightStrength: 0.54,
                        // Amount that specular regions brighten transmitted glass color.
                        specularLightStrength: 0.66,
                        // Baseline multiplier applied to the shared material alpha.
                        alphaBaseMultiplier: 0.92,
                        // Additional alpha contributed by disc body volume.
                        alphaVolumeStrength: 0.12,
                        // Additional alpha contributed by specular regions.
                        specularAlphaStrength: 0.022,
                        // Additional alpha contributed by caustic regions.
                        causticAlphaStrength: 0.014,
                        // Maximum final alpha for the baked disc pixels.
                        alphaMax: 0.98,
                        // Normalized radius where rim-thickness shading starts.
                        rimThicknessStart: 0.56,
                        // Normalized radius where rim-thickness shading reaches full strength.
                        rimThicknessEnd: 1,
                        // Vertical center of the upper meniscus shadow band.
                        upperMeniscusShadowCenterY: -0.42,
                        // Vertical width of the upper meniscus shadow band.
                        upperMeniscusShadowWidthY: 0.08,
                        // Horizontal center of the upper meniscus shadow band.
                        upperMeniscusShadowCenterX: 0.02,
                        // Horizontal width of the upper meniscus shadow band.
                        upperMeniscusShadowWidthX: 0.68,
                        // Vertical center of the lower meniscus depth band.
                        lowerMeniscusDepthCenterY: 0.64,
                        // Vertical width of the lower meniscus depth band.
                        lowerMeniscusDepthWidthY: 0.18,
                        // Horizontal center of the lower meniscus depth band.
                        lowerMeniscusDepthCenterX: -0.02,
                        // Horizontal width of the lower meniscus depth band.
                        lowerMeniscusDepthWidthX: 0.64,
                        // Vertical center of the lower transmitted-light band.
                        lowerTransmittedLightCenterY: 0.5,
                        // Vertical width of the lower transmitted-light band.
                        lowerTransmittedLightWidthY: 0.16,
                        // Horizontal center of the lower transmitted-light band.
                        lowerTransmittedLightCenterX: -0.1,
                        // Horizontal width of the lower transmitted-light band.
                        lowerTransmittedLightWidthX: 0.5,
                        // Vertical center of the top reflection.
                        topReflectionCenterY: -0.28,
                        // Vertical width of the top reflection.
                        topReflectionWidthY: 0.1,
                        // Horizontal center of the top reflection.
                        topReflectionCenterX: -0.24,
                        // Horizontal width of the top reflection.
                        topReflectionWidthX: 0.26,
                        // Horizontal center of the left-edge reflection.
                        leftEdgeReflectionCenterX: -0.48,
                        // Horizontal width of the left-edge reflection.
                        leftEdgeReflectionWidthX: 0.08,
                        // Vertical center of the left-edge reflection.
                        leftEdgeReflectionCenterY: -0.08,
                        // Vertical width of the left-edge reflection.
                        leftEdgeReflectionWidthY: 0.46,
                        // Horizontal center of the small internal glint.
                        smallGlintCenterX: -0.18,
                        // Horizontal width of the small internal glint.
                        smallGlintWidthX: 0.04,
                        // Vertical center of the small internal glint.
                        smallGlintCenterY: -0.02,
                        // Vertical width of the small internal glint.
                        smallGlintWidthY: 0.06,
                        // Horizontal frequency of the broad internal wave used for striations.
                        horizontalWaveFrequencyX: 3.6,
                        // Vertical frequency of the broad internal wave used for striations.
                        horizontalWaveFrequencyY: 0.7,
                        // Phase offset for the broad internal wave.
                        horizontalWavePhase: 0.15,
                        // Horizontal frequency of the fine internal wave used for striations.
                        fineWaveFrequencyX: 8.2,
                        // Vertical frequency of the fine internal wave used for striations.
                        fineWaveFrequencyY: -1.4,
                        // Phase offset for the fine internal wave.
                        fineWavePhase: 0.35,
                        // Vertical center of the upper internal striation band.
                        upperStriationCenterY: -0.16,
                        // Vertical width of the upper internal striation band.
                        upperStriationWidthY: 0.18,
                        // Baseline opacity of the upper internal striation band.
                        upperStriationBase: 0.42,
                        // Broad-wave contribution to the upper internal striation band.
                        upperStriationHorizontalWaveStrength: 0.4,
                        // Fine-wave contribution to the upper internal striation band.
                        upperStriationFineWaveStrength: 0.1,
                        // Vertical center of the lower internal striation band.
                        lowerStriationCenterY: 0.34,
                        // Vertical width of the lower internal striation band.
                        lowerStriationWidthY: 0.18,
                        // Horizontal center of the lower internal striation band.
                        lowerStriationCenterX: 0.16,
                        // Horizontal width of the lower internal striation band.
                        lowerStriationWidthX: 0.56,
                        // Vertical center of the soft internal veil.
                        internalVeilCenterY: 0.02,
                        // Vertical width of the soft internal veil.
                        internalVeilWidthY: 0.38,
                        // Baseline opacity of the soft internal veil.
                        internalVeilBase: 0.32,
                        // Broad-wave contribution to the soft internal veil.
                        internalVeilHorizontalWaveStrength: 0.22,
                        // Baseline slab thickness used for non-spherical glass shading.
                        flatThicknessBase: 0.48,
                        // Rim contribution to slab thickness.
                        flatThicknessRimStrength: 0.28,
                        // Lower-depth contribution to slab thickness.
                        flatThicknessLowerDepthStrength: 0.18,
                        // Internal-veil contribution to slab thickness.
                        flatThicknessInternalVeilStrength: 0.08,
                        // Vertical coordinate where extra slab depth starts ramping in.
                        flatThicknessVerticalDepthStartY: -0.12,
                        // Vertical coordinate where extra slab depth reaches full strength.
                        flatThicknessVerticalDepthEndY: 0.9,
                        // Strength of the vertical slab-depth ramp.
                        flatThicknessVerticalDepthStrength: 0.1,
                        // Baseline directional light value before local bands adjust it.
                        directionalLightBase: 0.24,
                        // Directional-light contribution from the lower transmitted-light band.
                        directionalLightLowerTransmittedStrength: 0.26,
                        // Directional-light contribution from the top reflection.
                        directionalLightTopReflectionStrength: 0.22,
                        // Directional-light contribution from the left-edge reflection.
                        directionalLightLeftEdgeStrength: 0.1,
                        // Directional-light contribution from the upper striation band.
                        directionalLightUpperStriationStrength: 0.06,
                        // Directional-light contribution from the lower striation band.
                        directionalLightLowerStriationStrength: 0.08,
                        // Directional-light subtraction from the upper meniscus shadow.
                        directionalLightUpperMeniscusShadowStrength: 0.12,
                        // Directional-light subtraction from rim thickness.
                        directionalLightRimShadowStrength: 0.1,
                        // Baseline cross-section coordinate passed into the shared material shader.
                        crossSectionBase: 0.5,
                        // Vertical contribution to the shared material cross-section coordinate.
                        crossSectionYStrength: 0.58,
                        // Horizontal skew contribution to the shared material cross-section coordinate.
                        crossSectionXStrength: 0.035,
                        // Baseline opacity multiplier for the circular alpha mask.
                        lensAlphaBase: 0.84,
                        // Alpha-mask contribution from slab thickness.
                        lensAlphaThicknessStrength: 0.12,
                        // Alpha-mask contribution from the lower-depth band.
                        lensAlphaLowerDepthStrength: 0.04,
                        // Baseline progress coordinate passed into the shared material shader.
                        progressBase: 0.14,
                        // Directional-light contribution to shared material progress.
                        progressLightStrength: 0.64,
                        // Caustic contribution from the lower transmitted-light band.
                        causticLowerLightStrength: 0.58,
                        // Caustic contribution from the lower striation band.
                        causticLowerStriationStrength: 0.18,
                        // Specular contribution from the top reflection.
                        specularTopReflectionStrength: 0.68,
                        // Specular contribution from the left-edge reflection.
                        specularLeftEdgeStrength: 0.48,
                        // Specular contribution from the small internal glint.
                        specularSmallGlintStrength: 0.9,
                        // Internal-shadow contribution from the upper meniscus shadow.
                        innerShadowUpperMeniscusStrength: 0.76,
                        // Internal-shadow contribution from rim thickness.
                        innerShadowRimStrength: 0.16,
                        // Internal-shadow contribution from the soft internal veil.
                        innerShadowVeilStrength: 0.1,
                    },
                },
                // SVG texture settings for the clipped pattern layer under the icon and over the glass.
                texture: {
                    // Fallback texture color when model metadata has no valid brand color.
                    fallbackColor: '#4B5D70',
                    // Brand-color remap used to tint the SVG pattern toward a lighter glass-readable color.
                    brandColorMix: {
                        // Target color mixed into the model brand color for the pattern fill.
                        targetColor: colorPalette.nightBlue,
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
