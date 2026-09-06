import {
    countProseMirrorNodesByType,
    getBranchMarkerThreadId,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type CanvasState,
} from '@lixpi/constants'
import {
    type WorkspaceCanvasConversation,
    type WorkspaceCanvasDocument,
} from './workspace-canvas-surface.ts'

export type WorkspaceCanvasThreadStatePorts = {
    getState: () => CanvasState | null
    merge: (
        threads: WorkspaceCanvasConversation[],
        state: CanvasState | null,
        workspaceChanged: boolean,
    ) => WorkspaceCanvasConversation[]
    now: () => number
    reattachWindowMs: number
}

export class WorkspaceCanvasThreadState {
    constructor(private readonly ports: WorkspaceCanvasThreadStatePorts) {}

    getDocumentsKey = (documents: WorkspaceCanvasDocument[]): string =>
        documents.map(document => document.documentId)
            .sort()
            .join(',')

    getThreadsKey = (threads: WorkspaceCanvasConversation[]): string => {
        return threads.filter(thread => !this.isDetached(thread.threadId)).map(
            thread => `${thread.threadId}:${thread.content ? 'loaded' : 'pending'}`,
        )
            .sort()
            .join(',')
    }

    merge = (
        threads: WorkspaceCanvasConversation[],
        state: CanvasState | null,
        workspaceChanged: boolean,
    ): WorkspaceCanvasConversation[] => this.ports.merge(
        threads,
        state,
        workspaceChanged,
    )

    isDetached = (threadId: string): boolean => threadId.startsWith('canvas-')

    hasInProgressContent = (thread: WorkspaceCanvasConversation | undefined): boolean => this.contentHasInProgressAiContent(thread?.content)

    hasRecoverableTurn = (thread: WorkspaceCanvasConversation | undefined): boolean => {
        if (!thread?.content)
            return false

        return countProseMirrorNodesByType(
            thread.content,
            new Set(['aiUserMessage']),
        ) > 0
            || this.hasInProgressContent(thread)
    }

    hasCanvasProjection = (threadId: string): boolean => {
        return Boolean(
            this.ports.getState()?.nodes.some(node => {
                if (
                    (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
                    && getBranchMarkerThreadId(node) === threadId
                )
                    return true

                return (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
                    && node.generatedBy?.conversationAssetId === threadId
            }),
        )
    }

    isRecentUpdate = (thread: WorkspaceCanvasConversation): boolean => {
        const updatedAt = Number(thread.updatedAt)

        return Number.isFinite(updatedAt) && this.ports.now() - updatedAt <= this.ports.reattachWindowMs
    }

    private contentHasInProgressAiContent(value: unknown): boolean {
        if (
            !value
            || typeof value !== 'object'
        )
            return false

        const node = value as {
            attrs?: Record<string, unknown>
            content?: unknown[]
        }
        const attrs = node.attrs ?? {}

        if (
            attrs.isReceivingAnimation
            || attrs.isStreaming
            || attrs.isPartial
        )
            return true

        return Boolean(node.content?.some(content => this.contentHasInProgressAiContent(content)))
    }
}
