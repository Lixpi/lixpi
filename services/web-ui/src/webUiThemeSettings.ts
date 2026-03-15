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
    // Four gradient colors used by the shifting gradient background and animated border
    // overlays (image generation border, document thread shape, context selection).
    // Hex strings. The shifting gradient renderer converts these to RGB internally.
    shiftingGradientColors: [string, string, string, string]
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
    // Four gradient colors shared between the shifting gradient background and the
    // animated border overlays (image generation, document thread shape).
    // Dreamy sky pastel palette — whisper pink, lavender, periwinkle, orchid.
    shiftingGradientColors: ['#FFF5FA', '#F5EFF9', '#E6E9F6', '#F3E4F2'],
}
