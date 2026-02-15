export type WebUiThemeSettings = {
    aiResponseMessageBubbleColor: string
    aiChatThreadNodeBoxShadow: string
    aiChatThreadNodeBorder: string
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
}
