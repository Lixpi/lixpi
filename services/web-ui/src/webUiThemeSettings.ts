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

export type ContextRegionCloudThemeStyle = {
    key: string
    aspect: 'wide' | 'square' | 'tall'
    bleedRatio: number
    titleAnchor: ContextRegionCloudThemePoint
    palette: ContextRegionCloudThemePalette
    seed: number
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


    // Context region cloud visual settings.
    contextRegionCloudTextureSize: ContextRegionCloudThemeSize
    contextRegionCloudMaskAlphaThreshold: number
    contextRegionCloudMinBleed: number
    contextRegionCloudGradientBaseColor: string
    contextRegionCloudGradientColors: [string, string, string, string]
    contextRegionCloudGradientPositions: ContextRegionCloudThemeGradientPositions
    contextRegionCloudStyles: ContextRegionCloudThemeStyle[]
    contextRegionCloudBorderEnabled: boolean
    contextRegionCloudBorderMainAlpha: number
    contextRegionCloudBorderThoughtCircleAlpha: number
    contextRegionCloudIdleAlpha: number
    contextRegionCloudSelectedAlpha: number
    contextRegionCloudPulseDurationMs: number
    contextRegionCloudPulseAlphaLift: number
    contextRegionCloudPulseLiftPx: number
    contextRegionCloudTitleFontFamily: string
    contextRegionCloudTitleFontSize: number
    contextRegionCloudTitleFontWeight: string
    contextRegionCloudTitleAlpha: number
    contextRegionCloudTitleHeight: number
    contextRegionCloudTitleCharWidth: number
    contextRegionCloudTitleMinWidth: number
    contextRegionCloudTitleMaxWidth: number
    contextRegionCloudTitlePaddingX: number
    contextRegionCloudTitleMinX: number
    contextRegionCloudTitleGap: number
    contextRegionImageFrameColor: string
}

const brandColors = {
    steelBlue: '#5d656d'
}

const contextRegionCloudPalettes = {
    mist: {
        pool: '#C7DAD4',
        bloom: '#EEF8F5',
        edge: '#A1C3BA',
        ink: '#1F2937',
    },
    seafoam: {
        pool: '#C7DAD4',
        bloom: '#EEF8F5',
        edge: '#8FB5AB',
        ink: '#1F2937',
    },
} satisfies Record<string, ContextRegionCloudThemePalette>

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


    // Context region cloud visual settings.
    // Pale seafoam palette fit to the region backdrop in gradient-sample.png.
    // The center needs visible depth without collapsing into a gray block.
    contextRegionCloudTextureSize: { width: 1080, height: 1080 },
    contextRegionCloudMaskAlphaThreshold: 0.045,
    contextRegionCloudMinBleed: 28,
    contextRegionCloudGradientBaseColor: '#E5F2EE',
    contextRegionCloudGradientColors: ['#DDECE7', '#C7DAD4', '#EEF8F5', '#D6E7E1'],
    contextRegionCloudGradientPositions: [
        { x: 0.2, y: 0.9 },
        { x: 0.65, y: 0.75 },
        { x: 0.8, y: 0.1 },
        { x: 0.35, y: 0.25 },
    ],
    contextRegionCloudStyles: [
        { key: 'seafoam-wide-a', aspect: 'wide', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, palette: contextRegionCloudPalettes.mist, seed: 1103 },
        { key: 'seafoam-wide-b', aspect: 'wide', bleedRatio: 0.32, titleAnchor: { x: 0.10, y: 0.12 }, palette: contextRegionCloudPalettes.seafoam, seed: 1291 },
        { key: 'seafoam-square-a', aspect: 'square', bleedRatio: 0.30, titleAnchor: { x: 0.12, y: 0.12 }, palette: contextRegionCloudPalettes.mist, seed: 1427 },
        { key: 'seafoam-square-b', aspect: 'square', bleedRatio: 0.31, titleAnchor: { x: 0.13, y: 0.12 }, palette: contextRegionCloudPalettes.seafoam, seed: 1559 },
        { key: 'seafoam-tall-a', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.14, y: 0.12 }, palette: contextRegionCloudPalettes.mist, seed: 1667 },
        { key: 'seafoam-tall-b', aspect: 'tall', bleedRatio: 0.30, titleAnchor: { x: 0.13, y: 0.12 }, palette: contextRegionCloudPalettes.seafoam, seed: 1789 },
    ],
    contextRegionCloudBorderEnabled: false,
    contextRegionCloudBorderMainAlpha: 0.22,
    contextRegionCloudBorderThoughtCircleAlpha: 0.20,
    contextRegionCloudIdleAlpha: 0.98,
    contextRegionCloudSelectedAlpha: 1,
    contextRegionCloudPulseDurationMs: 700,
    contextRegionCloudPulseAlphaLift: 0.02,
    contextRegionCloudPulseLiftPx: 3,
    contextRegionCloudTitleFontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    contextRegionCloudTitleFontSize: 20,
    contextRegionCloudTitleFontWeight: '650',
    contextRegionCloudTitleAlpha: 0.80,
    contextRegionCloudTitleHeight: 30,
    contextRegionCloudTitleCharWidth: 8.25,
    contextRegionCloudTitleMinWidth: 112,
    contextRegionCloudTitleMaxWidth: 280,
    contextRegionCloudTitlePaddingX: 20,
    contextRegionCloudTitleMinX: 22,
    contextRegionCloudTitleGap: 10,
    contextRegionImageFrameColor: '#FCFCFA',
}
