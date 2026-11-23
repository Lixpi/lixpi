import {
    type AiModelsCatalogResponse,
    type ConversationAcknowledgement,
    type ConversationMessageNode,
    type ConversationMessagesPage,
    type ConversationReference,
    type ConversationSettings,
    type ConversationSnapshot,
} from '@lixpi/constants'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'

// The active execution supplies scope and authorship for every dispatch.
export type CanvasComposerDispatch = {
    conversationAssetId: string
    fragment: ConversationMessageNode
    references: ConversationReference[]
    settingsRevision: number
}

// Where a conversation turn came from. dispatchedBy names the conversation
// whose agent sent the turn; a person's turn has none.
export type CanvasComposerDispatchResult = {
    acknowledgement: ConversationAcknowledgement
    operationId?: string
}

export type CanvasComposerTurnOrigin = {
    dispatchedBy?: string
}

export type CanvasComposerConversationPage = {
    conversations: ConversationSnapshot[]
    cursor?: string
}

// Every operation runs as the conversation owner in the active workspace.
// Inputs never carry a user, workspace or organization; the host derives
// them from the authorized execution. The host sends messages through the
// normal conversation submit path as an agent-authored turn, so the
// receiving run is queued behind other work and limited to what the
// sending run has left.
export type CanvasComposerSession = {
    conversationAssetId: string
    requestId: string
    signal: AbortSignal
    listConversations: (cursor?: string) => Promise<CanvasComposerConversationPage>
    readConversation: (conversationAssetId: string) => Promise<ConversationSnapshot>
    readMessages: (
        conversationAssetId: string,
        cursor?: string,
    ) => Promise<ConversationMessagesPage>
    readModelCatalog: () => Promise<AiModelsCatalogResponse>
    // The sending conversation followed by every conversation whose agent
    // sent the turn that led to it, nearest first.
    dispatchAncestry: () => Promise<string[]>
    readTurnOrigin: (
        conversationAssetId: string,
        turnId: string,
    ) => Promise<CanvasComposerTurnOrigin | undefined>
    createConversation: (settings: Partial<ConversationSettings>) => Promise<ConversationSnapshot>
    updateSettings: (
        conversationAssetId: string,
        expectedRevision: number,
        patch: Partial<ConversationSettings>,
    ) => Promise<ConversationSnapshot>
    renameConversation: (
        conversationAssetId: string,
        title: string,
    ) => Promise<ConversationSnapshot>
    dispatchMessage: (dispatch: CanvasComposerDispatch) => Promise<CanvasComposerDispatchResult>
    stopRun: (
        conversationAssetId: string,
        runId: string,
    ) => Promise<ConversationSnapshot>
    resumeQueue: (
        conversationAssetId: string,
        expectedRevision: number,
    ) => Promise<ConversationSnapshot>
    cancelQueued: (
        conversationAssetId: string,
        expectedRevision: number,
        turnIds: string[],
    ) => Promise<ConversationSnapshot>
}

export type CanvasComposerAccess = (context: CapabilityActionAuthorizationContext) => Promise<CanvasComposerSession>
