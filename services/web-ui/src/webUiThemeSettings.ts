export type ContextRegionCloudThemePoint = { x: number; y: number }

export type ContextRegionCloudThemeSize = { width: number; height: number }

export type ContextRegionCloudThemeGradientPositions = [
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
    ContextRegionCloudThemePoint,
]

export type ContextRegionCloudThemePalette = {
    pool: string
    bloom: string
    edge: string
    ink: string
}

export type ContextRegionCloudThemePalettes = {
    mist: ContextRegionCloudThemePalette
    seafoam: ContextRegionCloudThemePalette
}

export type ContextRegionCloudThemeStyle = {
    key: string
    aspect: 'wide' | 'square' | 'tall'
    bleedRatio: number
    titleAnchor: ContextRegionCloudThemePoint
    palette: ContextRegionCloudThemePalette
    seed: number
}

export type WebUiImageNodeThemeSettings = {
    defaultBoxShadow: string
    selectedBoxShadow: string
    defaultInsertionWidth: number
    borderRadius: number
    contextRegionChildImageFrameColor: string
    contextRegionChildImageDropShadow: string
    modelBadgeBoxShadow: string
}

export type WebUiContextRegionThemeSettings = {
    defaultDimensions: ContextRegionCloudThemeSize
    adjacentNodeGap: number
    cloud: WebUiContextRegionCloudThemeSettings
}

export type WebUiImageBranchLineageThemeSettings = {
    generatedImageSize: number
    contextRegionOutputGap: number
    branchToBranchGap: number
    imageToImageGap: number
}

export type WebUiContextRegionCloudThemeSettings = {
    palettes: ContextRegionCloudThemePalettes
    textureSize: ContextRegionCloudThemeSize
    maskAlphaThreshold: number
    minBleed: number
    resizeEdgeHitRadiusPx: number
    gradientBaseColor: string
    gradientColors: [string, string, string, string]
    gradientPositions: ContextRegionCloudThemeGradientPositions
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

export type WebUiThemeSettings = {
    aiResponseMessageBubbleColor: string
    aiChatThreadNodeBoxShadow: string
    aiChatThreadNodeBorder: string
    aiChatThreadRailGradient: string
    aiChatThreadRailWidth: string
    aiChatThreadRailOffset: number
    aiChatThreadRailEdgeMargin: number
    aiChatThreadRailMinSlideHeight: number
    aiChatThreadRailBoundaryCircleColors: [string, string, string]
    nodesConnectorLineDefaultColor: string
    nodesConnectorLineFocusColor: string
    selectionMarqueeBorderColor: string
    selectionMarqueeBackgroundColor: string
    selectionOverlayBorderColor: string
    selectionOverlayBackgroundColor: string
    selectionOutlineColor: string
    // Box shadow for the dropdown popover menus (model selectors etc.).
    dropdownPopoverBoxShadow: string
    // Four gradient colors used by the shared shifting gradient background and
    // animated border overlays (image generation border, document thread shape,
    // context selection).
    // Hex strings. The shifting gradient renderer converts these to RGB internally.
    shiftingGradientColors: [string, string, string, string]

    imageNode: WebUiImageNodeThemeSettings

    contextRegion: WebUiContextRegionThemeSettings

    imageBranchLineage: WebUiImageBranchLineageThemeSettings
}

const brandColors = {
    steelBlue: '#5d656d'
}

export const webUiThemeSettings: WebUiThemeSettings = {
    // Background color for AI response message bubbles and their pigtail (speech bubble tail).
    // Previous value: '#fff'
    aiResponseMessageBubbleColor: '#f7f7fd',
    // Box shadow around the AI chat thread canvas node.
    // Previous value: '0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)'
    aiChatThreadNodeBoxShadow: 'none',
    // Border around the AI chat thread canvas node.
    // Previous value: not set (inherited browser default)
    aiChatThreadNodeBorder: 'none',
    // Gradient for the vertical rail running along AI chat thread + floating input nodes.
    // Matches the model selector dropdown item highlight gradient.
    // Previous value (solid color): '#dcdaf5'
    aiChatThreadRailGradient: 'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)',
    // Width of the visible rail line.
    aiChatThreadRailWidth: '3px',
    // Horizontal offset (in pixels) of the rail from the node's left edge.
    aiChatThreadRailOffset: -2,
    // Fractional margin (0–0.5) from the top and bottom of the rail where connector
    // anchor points stop sliding. E.g. 0.025 means connectors won't go closer than
    // 2.5 % of the rail height from either end.
    aiChatThreadRailEdgeMargin: 0.065,
    // Minimum rail/node height (in pixels) required before connectors slide freely.
    // Below this threshold all connectors snap to the vertical center (t = 0.5).
    aiChatThreadRailMinSlideHeight: 120,
    // Colors for the three concentric shapes in the rail boundary circle SVG.
    // Order: [outer fill, ring/border, inner fill].
    // Uses the shifting gradient hue family with increased contrast for small-size legibility.
    aiChatThreadRailBoundaryCircleColors: ['#F3E4F2', '#C5C0EE', 'rgb(202, 180, 201)'],
    // Default color for connector lines between nodes.
    nodesConnectorLineDefaultColor: brandColors.steelBlue,
    // Focus/selected color for connector lines between nodes.
    nodesConnectorLineFocusColor: '#000',
    // Marquee selection rectangle (drag-to-select).
    selectionMarqueeBorderColor: 'rgba(176, 173, 224, 0.88)',
    selectionMarqueeBackgroundColor: 'rgba(230, 233, 246, 0.38)',
    // Persistent selection group overlay (multi-select / single AI chat thread).
    selectionOverlayBorderColor: 'rgba(197, 192, 238, 0.62)',
    selectionOverlayBackgroundColor: 'rgba(230, 233, 246, 0.42)',
    // Outline on the per-thread floating input when selected.
    selectionOutlineColor: 'rgba(197, 192, 238, 0.75)',
    // Box shadow for dropdown popover menus (model selectors etc.).
    dropdownPopoverBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.1)',
    // Four gradient colors shared between the default shifting gradient background
    // and the animated border overlays (image generation, document thread shape).
    // Dreamy sky pastel palette — whisper pink, lavender, periwinkle, orchid.
    shiftingGradientColors: ['#FFF5FA', '#F5EFF9', '#E6E9F6', '#F3E4F2'],

    // Canvas image node settings. These values style image-node chrome and selection states.
    imageNode: {
        // Box shadow applied to image nodes in their default state. Keep this subtler than the selected shadow so selection remains the stronger visual state.
        defaultBoxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
        // Box shadow applied when an image node is selected. Increasing this makes selected images read as more prominent on the canvas.
        selectedBoxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
        // Canvas-unit width for manually inserted image nodes. Height is derived from the image aspect ratio; failed dimension probes use this as a square fallback.
        defaultInsertionWidth: 600,
        // Canvas-unit corner radius for image pixels on the workspace canvas. Increasing it rounds both PIXI-rendered stored images and DOM partial previews more strongly.
        borderRadius: 8,
        // Frame color used for image nodes parented inside a context region. Changing it updates the card-like surface around adopted images.
        contextRegionChildImageFrameColor: '#FCFCFA',
        // Drop shadow used by image nodes parented inside a context region. Larger shadows make child images feel more lifted from the cloud.
        contextRegionChildImageDropShadow: '0 10px 24px rgba(31, 49, 42, 0.16), 0 1px 2px rgba(31, 49, 42, 0.08)',
        // Shadow behind the generated-image model badge. Increasing it improves badge separation on busy image pixels.
        modelBadgeBoxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
    },


    // Context region layout settings. These values affect newly created context-region nodes, not regions already persisted in canvas state.
    contextRegion: {
        // Default canvas-unit size for newly created context regions. Increasing it creates larger starter clouds across toolbar, prompt, and edit-thread flows.
        defaultDimensions: { width: 640, height: 480 },
        // Canvas-unit gap when a new context region is placed next to an existing node. Increasing it puts more breathing room between source images and new edit regions.
        adjacentNodeGap: 50,

        // Context region cloud visual settings. These values control the PIXI-rendered CO2 cloud surface, hit geometry padding, title placement, and pulse behavior.
        cloud: {
            // Reusable color palettes referenced by cloud style variants. Add new palettes here before assigning them to styles.
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
            // Watercolor colors mixed across the cloud surface. Changing these alters the main visible cloud palette.
            gradientColors: ['#DDECE7', '#C7DAD4', '#EEF8F5', '#D6E7E1'],
            // Normalized color anchor positions for the cloud gradient. Moving a point changes where its matching gradient color blooms on the cloud.
            gradientPositions: [
                { x: 0.2, y: 0.9 },
                { x: 0.65, y: 0.75 },
                { x: 0.8, y: 0.1 },
                { x: 0.35, y: 0.25 },
            ],
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


    // Image branch lineage placement settings. These values control where newly generated image nodes appear in relation to regions and previous branch images.
    imageBranchLineage: {
        // Canvas-unit width and height for new generated image nodes. Increasing it makes each generated branch image larger when inserted.
        generatedImageSize: 800,
        // Canvas-unit horizontal gap between a context-region cloud's visual bounds and the first generated image in that branch. Increasing it moves first outputs farther right.
        contextRegionOutputGap: 384,
        // Canvas-unit vertical gap between separate branch rows spawned from the same context region. Increasing it moves new branches farther below the previous branch.
        branchToBranchGap: 160,
        // Canvas-unit horizontal gap between consecutive generated images in the same branch lineage. Increasing it stretches image-to-image branch spacing.
        imageToImageGap: 192,
    },
}
