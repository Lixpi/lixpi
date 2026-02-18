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
}
