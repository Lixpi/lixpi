import { getPersistedPanelConversationIds } from '../scene/workspace-panel-state.ts'
import {
    type CanvasState,
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

export const hasCurrentWorkspaceThread = ({
    threadId,
    currentCanvasState,
    currentAiChatThreads,
}: GeneratedMediaEventWorkspaceGuardState & { threadId: string }): boolean => {
    if (currentAiChatThreads.some(thread => thread.threadId === threadId))
        return true

    if (getPersistedPanelConversationIds(currentCanvasState?.aiChatPanel).includes(threadId))
        return true

    return Boolean(
        currentCanvasState?.nodes.some(node => {
            if (
                (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
                && node.conversationAssetId === threadId
            )
                return true

            if (
                (node.type === 'image' || node.type === 'video')
                && node.generatedBy?.conversationAssetId === threadId
            )
                return true

            return false
        }),
    )
}

export const shouldAcceptGeneratedMediaEvent = ({
    threadId,
    eventWorkspaceId,
    workspaceId,
    currentCanvasState,
    currentAiChatThreads,
}: GeneratedMediaEventWorkspaceGuardInput): boolean => {
    if (
        eventWorkspaceId
        && eventWorkspaceId !== workspaceId
    )
        return false

    return hasCurrentWorkspaceThread({
        threadId,
        currentCanvasState,
        currentAiChatThreads,
        workspaceId,
    })
}
