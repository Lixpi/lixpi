export type ContextRegionCloudThemePoint = { x: number; y: number }

export type ContextRegionCloudThemeSize = { width: number; height: number }

export type ContextRegionCloudThemeGradientPositions = [
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
]

export type ContextRegionCloudThemeGradientColors = [string, string, string, string]

export type ContextRegionCloudThemeGradientPalette = {
    color1: string
    color2: string
    color3: string
    color4: string
}

export type ContextRegionCloudThemePalette = {
    pool: string
    bloom: string
    edge: string
    ink: string
}

export type ContextRegionCloudThemePalettes = {
    mist: ContextRegionCloudThemePalette
    seafoam: ContextRegionCloudThemePalette
    surfaceGradient: ContextRegionCloudThemeGradientPalette
    activeThoughtCircle: ContextRegionCloudThemeGradientPalette
}

export type ContextRegionCloudThemeStyle = {
    key: string
    aspect: 'wide' | 'square' | 'tall'
    bleedRatio: number
    titleAnchor: ContextRegionCloudThemePoint
    palette: ContextRegionCloudThemePalette
    seed: number
}
export type ContextRegionSettings = {
    defaultDimensions: ContextRegionCloudThemeSize
    adjacentNodeGap: number
    cloud: WebUiContextRegionCloudThemeSettings
}
export type WebUiContextRegionCloudThemeSettings = {
    palettes: ContextRegionCloudThemePalettes
    textureSize: ContextRegionCloudThemeSize
    maskAlphaThreshold: number
    minBleed: number
    resizeEdgeHitRadiusPx: number
    gradientBaseColor: string
    gradientColors: ContextRegionCloudThemeGradientColors
    gradientPositions: ContextRegionCloudThemeGradientPositions
    activeThoughtCircleGradientColors: ContextRegionCloudThemeGradientColors
    activeThoughtCircleAlpha: number
    activeThoughtCircleAnimationDurationMs: number
    activeThoughtCircleBloomAlphaLift: number
    styles: ContextRegionCloudThemeStyle[]
    borderEnabled: boolean
    borderMainAlpha: number
    borderThoughtCircleAlpha: number
    idleAlpha: number
    selectedAlpha: number
    pulseDurationMs: number
    pulseAlphaLift: number
    pulseLiftPx: number
    titleFontFamily: string
    titleFontSize: number
    titleFontWeight: string
    titleAlpha: number
    titleHeight: number
    titleCharWidth: number
    titleMinWidth: number
    titleMaxWidth: number
    titlePaddingX: number
    titleMinX: number
    titleGap: number
}
function getContextRegionCloudGradientColors(palette: ContextRegionCloudThemeGradientPalette): ContextRegionCloudThemeGradientColors {
    return [palette.color1, palette.color2, palette.color3, palette.color4]
}
    // Context region layout settings. These values affect newly created context-region nodes, not regions already persisted in canvas state.
    contextRegion: {
        // Default canvas-unit size for newly created context regions. Increasing it creates larger starter clouds across toolbar, prompt, and edit-thread flows.
        defaultDimensions: { width: 640, height: 480 },
        // Canvas-unit gap when a new context region is placed next to an existing node. Increasing it puts more breathing room between source images and new edit regions.
        adjacentNodeGap: 50,

        // Context region cloud visual settings. These values control the PIXI-rendered CO2 cloud surface, hit geometry padding, title placement, and pulse behavior.
        cloud: {
            // Reusable color palettes referenced by cloud surface and marker settings. Add new palettes here before assigning them to render settings.
            palettes: {
                // Softer mist palette for lighter, lower-contrast cloud variants.
                mist: {
                    pool: '#C7DAD4',
                    bloom: '#EEF8F5',
                    edge: '#A1C3BA',
                    ink: '#1F2937',
                },
                // Slightly stronger seafoam palette for variants that need a clearer cloud edge.
                seafoam: {
                    pool: '#C7DAD4',
                    bloom: '#EEF8F5',
                    edge: '#8FB5AB',
                    ink: '#1F2937',
                },
                // Watercolor colors mixed across the cloud surface.
                surfaceGradient: {
                    color1: '#DDECE7',
                    color2: '#C7DAD4',
                    color3: '#EEF8F5',
                    color4: '#D6E7E1',
                },
                // Soft sage colors for the active thought-circle overlay.
                activeThoughtCircle: {
                    color1: '#A7C39A',
                    color2: '#9CBB91',
                    color3: '#91AD86',
                    color4: '#AFCB9E',
                },
            },

            // Pixel size of the offscreen watercolor texture template. Larger values can look crisper but use more memory and texture upload time.
            textureSize: { width: 1080, height: 1080 },
            // Alpha cutoff used when building the cloud mask. Raising it trims faint edges; lowering it keeps more soft transparent edge pixels.
            maskAlphaThreshold: 0.045,
            // Minimum canvas-unit bleed beyond the logical context-region rectangle. Increasing it expands the visible cloud and its placement/collision bounds.
            minBleed: 28,
            // Screen-pixel radius around the visible cloud edge that activates resize handles and resize cursors. Increasing it makes edge resize easier to trigger; lowering it requires more precise pointer placement.
            resizeEdgeHitRadiusPx: 16,
            // Base underpaint color for the cloud texture. Changing it shifts the overall tint before watercolor colors are blended in.
            gradientBaseColor: '#E5F2EE',
            // Watercolor colors mixed across the cloud surface. This getter keeps the renderer knob mapped to the matching cloud palette entry.
            get gradientColors(): ContextRegionCloudThemeGradientColors {
                return getContextRegionCloudGradientColors(this.palettes.surfaceGradient)
            },
            // Normalized color anchor positions for the cloud gradient. Moving a point changes where its matching gradient color blooms on the cloud.
            gradientPositions: [
                { x: 0.2, y: 0.9 },
                { x: 0.65, y: 0.75 },
                { x: 0.8, y: 0.1 },
                { x: 0.35, y: 0.25 },
            ],
            // Gradient colors for the active thought-circle overlay. This getter keeps the renderer knob mapped to the matching cloud palette entry.
            get activeThoughtCircleGradientColors(): ContextRegionCloudThemeGradientColors {
                return getContextRegionCloudGradientColors(this.palettes.activeThoughtCircle)
            },
            // Opacity for the active thought-circle overlay. Lower values keep the active marker closer to the cloud's translucent watercolor surface.
            activeThoughtCircleAlpha: 0.68,
            // Duration of the active thought-circle gradient bloom. Increasing it makes active-region changes linger longer.
            activeThoughtCircleAnimationDurationMs: 760,
            // Extra opacity added at the center of the active thought-circle bloom. Increasing it makes activation feel brighter before it settles.
            activeThoughtCircleBloomAlphaLift: 0.18,
            // Shape variants chosen by aspect ratio and node id. This is a getter only because styles self-reference sibling palettes through `this`; do not use getters for static settings.
            get styles(): ContextRegionCloudThemeStyle[] {
                return [
                    { key: 'seafoam-wide-a', aspect: 'wide', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, palette: this.palettes.mist, seed: 1103 },
                    { key: 'seafoam-wide-b', aspect: 'wide', bleedRatio: 0.32, titleAnchor: { x: 0.10, y: 0.12 }, palette: this.palettes.seafoam, seed: 1291 },
                    { key: 'seafoam-square-a', aspect: 'square', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, palette: this.palettes.mist, seed: 1427 },
                    { key: 'seafoam-square-b', aspect: 'square', bleedRatio: 0.31, titleAnchor: { x: 0.13, y: 0.12 }, palette: this.palettes.seafoam, seed: 1559 },
                    { key: 'seafoam-tall-a', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.14, y: 0.12 }, palette: this.palettes.mist, seed: 1667 },
                    { key: 'seafoam-tall-b', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.13, y: 0.12 }, palette: this.palettes.seafoam, seed: 1789 },
                ]
            },
            // Enables an exact CO2-shape border around the cloud. Turning it on makes region boundaries more explicit.
            borderEnabled: false,
            // Alpha for the optional main cloud border. Increasing it makes the large cloud outline stronger when borders are enabled.
            borderMainAlpha: 0.22,
            // Alpha for the optional thought-circle borders. Increasing it makes the small detached circles read more clearly when borders are enabled.
            borderThoughtCircleAlpha: 0.20,
            // Base opacity for unselected clouds. Lower values make inactive context regions recede into the canvas.
            idleAlpha: 0.98,
            // Base opacity for selected clouds. Lower values make selected context regions less visually dominant.
            selectedAlpha: 1,
            // Duration of the context-region pulse animation in milliseconds. Increasing it makes selection/submission feedback linger longer.
            pulseDurationMs: 700,
            // Extra opacity added during a pulse. Increasing it makes pulse feedback more noticeable.
            pulseAlphaLift: 0.02,
            // Upward canvas-pixel lift during a pulse. Increasing it makes the cloud visibly bob more during feedback.
            pulseLiftPx: 3,
            // Font family for context-region titles. Changing it affects all PIXI-rendered cloud labels.
            titleFontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            // Base title font size before zoom compensation. Increasing it makes context-region labels larger on screen.
            titleFontSize: 20,
            // Font weight for context-region titles. Increasing it makes labels heavier and more prominent.
            titleFontWeight: '650',
            // Opacity for context-region title text. Lower values make labels softer against the canvas.
            titleAlpha: 0.80,
            // Reserved title hit/render height before zoom compensation. Increasing it creates more vertical room for label hit testing and placement.
            titleHeight: 30,
            // Approximate character width used to estimate title label width. Increasing it reserves more horizontal label space per character.
            titleCharWidth: 8.25,
            // Minimum title label width before zoom compensation. Increasing it prevents short titles from becoming too narrow.
            titleMinWidth: 112,
            // Maximum title label width before zoom compensation. Increasing it lets longer titles occupy more space before clamping.
            titleMaxWidth: 280,
            // Horizontal title padding before zoom compensation. Increasing it gives text more breathing room inside the title hit area.
            titlePaddingX: 20,
            // Minimum title x-offset from the cloud visual bounds. Increasing it pushes labels farther right from the cloud's left edge.
            titleMinX: 22,
            // Vertical gap between the cloud visual bounds and the title. Increasing it moves labels farther above the cloud.
            titleGap: 10,
        },

    },
