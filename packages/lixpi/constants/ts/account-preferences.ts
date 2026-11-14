import {
    type ConversationContextMode,
    type ConversationMidRunPolicy,
} from './agent-conversation.ts'

export type AccountAgentPreferences = {
    contextMode: ConversationContextMode
    midRunPolicy: ConversationMidRunPolicy
}

export type AccountPreferences = {
    appearance?: string
    agent?: AccountAgentPreferences
}
