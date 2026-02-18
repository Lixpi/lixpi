export type WebUiThemeSettings = {
    aiResponseMessageBubbleColor: string
    aiChatThreadNodeBoxShadow: string
    aiChatThreadNodeBorder: string
    aiChatThreadRailGradient: string
    aiChatThreadRailWidth: string
    aiChatThreadRailOffset: number
    aiChatThreadRailEdgeMargin: number
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
    aiChatThreadRailOffset: -1,
    // Fractional margin (0–0.5) from the top and bottom of the rail where connector
    // anchor points stop sliding. E.g. 0.025 means connectors won't go closer than
    // 2.5 % of the rail height from either end.
    aiChatThreadRailEdgeMargin: 0.025,
}
