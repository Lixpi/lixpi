import type {
    CanvasState,
} from '@lixpi/constants'

export type GeneratedMediaEventWorkspaceGuardState = {
    workspaceId: string
    currentCanvasState: Pick<CanvasState, 'nodes' | 'aiChatPanel'> | null
    currentAiChatThreads: Array<{ threadId: string }>
}

export type GeneratedMediaEventWorkspaceGuardInput = GeneratedMediaEventWorkspaceGuardState & {
    threadId: string
    eventWorkspaceId?: string
}

export function hasCurrentWorkspaceThread({
    threadId,
    currentCanvasState,
    currentAiChatThreads,
}: GeneratedMediaEventWorkspaceGuardState & { threadId: string }): boolean {
    if (currentAiChatThreads.some((thread) => thread.threadId === threadId)) return true

    return Boolean(currentCanvasState?.aiChatPanel?.tabs?.some((tab) =>
        tab.type === 'thread' && tab.refId === threadId
    ))
}

export function shouldAcceptGeneratedMediaEvent({
    threadId,
    eventWorkspaceId,
    workspaceId,
    currentCanvasState,
    currentAiChatThreads,
}: GeneratedMediaEventWorkspaceGuardInput): boolean {
    if (eventWorkspaceId && eventWorkspaceId !== workspaceId) return false
    return hasCurrentWorkspaceThread({ threadId, currentCanvasState, currentAiChatThreads, workspaceId })
}
