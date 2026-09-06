import {
    type CanvasNode,
    type CanvasState,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
} from '@lixpi/constants'
import { getBranchMarkerConversationPreviewFromThreadContent } from '@lixpi/prosemirror/shared/thread-doc'
import {
    countProseMirrorNodesByType,
    getBranchMarkerThreadId,
    getBranchMarkerTurnDescriptor,
} from '../review/workspace-history.ts'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
export type CanvasConversationProjectionRecord = {
    threadId: string
    workspaceId: string
    content?: object
    proseMirrorVersion?: number
    updatedAt: number
}
export type CanvasConversationProjectionScope = {
    workspaceId: string
    sceneKey: string
}
export type WorkspaceConversationProjectionPorts<Thread extends CanvasConversationProjectionRecord> = {
    readScope: () => CanvasConversationProjectionScope | null
    getThreads: () => Thread[]
    setThreads: (threads: Thread[]) => void
    getNodes: () => CanvasNode[]
    retainedThreadIds: () => Iterable<string>
    canUseLatestTurnFallback: (
        node: BranchMarkerNode,
        content: unknown,
    ) => boolean
    fetchThread: (request: {
        workspaceId: string
        threadId: string
    }) => Promise<Thread | null>
    refreshProjection: (threadId: string) => void
    setTimer: (
        callback: () => void,
        delay: number,
    ) => () => void
    now: () => number
    reportError: (
        error: unknown,
        threadId: string,
    ) => void
}

type Refresh = {
    scope: CanvasConversationProjectionScope
    cancelTimer?: () => void
}

export const readCanvasConversationVersion = (record: { proseMirrorVersion?: unknown } | undefined): number => {
    const version = record?.proseMirrorVersion

    return typeof version === 'number'
        && Number.isInteger(version)
        && version >= 0
        ? version
        : 0
}

const isMarker = (node: CanvasNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const contentWeight = (record: CanvasConversationProjectionRecord): number => {
    if (!record.content)
        return 0

    const messageCount = countProseMirrorNodesByType(
        record.content,
        new Set([
            'aiUserMessage',
            'aiResponseMessage',
            'aiReasoningSection',
            'prompt_reference',
        ]),
    )

    return messageCount * 1000000 + JSON.stringify(record.content).length
}

export class WorkspaceConversationProjection<Thread extends CanvasConversationProjectionRecord> {
    private readonly liveContent = new Map<string, object>()
    private readonly refreshes = new Map<string, Refresh>()
    private destroyed = false

    constructor(private readonly ports: WorkspaceConversationProjectionPorts<Thread>) {}

    get(threadId: string): Thread | undefined {
        return this.ports.getThreads().find(thread => thread.threadId === threadId)
    }
    content(threadId: string): unknown {
        return this.liveContent.get(threadId) ?? this.get(threadId)?.content
    }
    liveIds(): IterableIterator<string> {
        return this.liveContent.keys()
    }

    remember(thread: Thread): void {
        if (this.destroyed)
            return

        const threads = this.ports.getThreads()
        this.ports.setThreads(
            threads.some(candidate => candidate.threadId === thread.threadId)
                ? threads.map(candidate => candidate.threadId === thread.threadId ? thread : candidate)
                : [...threads, thread],
        )
    }

    rememberContent(
        threadId: string,
        content: object,
        streaming: boolean | null = null,
    ): void {
        if (this.destroyed)
            return

        if (streaming === true)
            this.liveContent.set(threadId, content)
        else if (streaming === false)
            this.liveContent.delete(threadId)

        const thread = this.get(threadId)

        if (thread)
            this.remember({
                ...thread,
                content,
                updatedAt: Math.max(
                    thread.updatedAt,
                    this.ports.now(),
                ),
            })
    }

    merge(
        incoming: Thread[],
        canvasState: CanvasState | null,
        workspaceChanged: boolean,
    ): Thread[] {
        if (workspaceChanged)
            return incoming

        const next = new Map(
            incoming.map(thread => [thread.threadId, thread]),
        )
        const retained = new Set([
            ...this.ports.retainedThreadIds(),
            ...this.liveContent.keys(),
        ])

        for (const node of canvasState?.nodes ?? []) {
            if (
                isMarker(node)
                && node.conversationAssetId
            )
                retained.add(node.conversationAssetId)
            else if (
                (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
                && node.generatedBy?.conversationAssetId
            )
                retained.add(node.generatedBy.conversationAssetId)
        }

        for (const current of this.ports.getThreads()) {
            const incoming = next.get(current.threadId)

            if (!incoming) {
                if (retained.has(current.threadId))
                    next.set(current.threadId, current)

                continue
            }

            const currentVersion = readCanvasConversationVersion(current)
            const incomingVersion = readCanvasConversationVersion(incoming)
            const preserve = currentVersion > incomingVersion
                || (currentVersion === incomingVersion && contentWeight(current) > contentWeight(incoming))
                || (!incoming.content && Boolean(current.content))

            if (preserve) {
                next.set(
                    current.threadId,
                    {
                        ...incoming,
                        content: current.content,
                        proseMirrorVersion: currentVersion,
                        updatedAt: Math.max(incoming.updatedAt, current.updatedAt),
                    },
                )
            }
        }

        return [...next.values()]
    }

    snapshotIsComplete(
        threadId: string,
        content: unknown,
    ): boolean {
        const markers = this.ports.getNodes().filter((node): node is BranchMarkerNode => isMarker(node) && getBranchMarkerThreadId(node) === threadId)

        return markers.every(marker => {
            const preview = getBranchMarkerConversationPreviewFromThreadContent(
                content,
                threadId,
                getBranchMarkerTurnDescriptor(marker),
                {
                    allowLatestTurnFallback: this.ports.canUseLatestTurnFallback(marker, content),
                },
            )

            return Boolean(preview?.userMessage && preview.responseText.trim())
        })
    }

    async refresh(threadId: string): Promise<void> {
        if (this.destroyed)
            return

        const scope = this.ports.readScope()

        if (!scope)
            return

        this.release(threadId)
        const refresh: Refresh = { scope: { ...scope } }
        this.refreshes.set(threadId, refresh)
        await this.attempt(
            threadId,
            refresh,
            0,
        )
    }

    schedule(threadId: string): void {
        if (this.destroyed)
            return

        const scope = this.ports.readScope()

        if (!scope)
            return

        this.release(threadId)
        const refresh: Refresh = { scope: { ...scope } }
        this.refreshes.set(threadId, refresh)
        this.scheduleAttempt(
            threadId,
            refresh,
            0,
        )
    }

    clear(): void {
        const refreshes = [...this.refreshes.values()]
        this.refreshes.clear()
        this.liveContent.clear()
        const errors: unknown[] = []

        for (const refresh of refreshes) {
            try {
                refresh.cancelTimer?.()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length)
            throw new AggregateError(errors, 'Canvas conversation projection cleanup failed')
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.clear()
    }

    private scheduleAttempt(
        threadId: string,
        refresh: Refresh,
        attempt: number,
    ): void {
        if (!this.isCurrent(threadId, refresh))
            return

        const delay = [400, 1000, 1600, 3000][attempt]

        if (delay === undefined) {
            this.release(threadId)

            return
        }

        try {
            refresh.cancelTimer = this.ports.setTimer(
                () => void this.attempt(
                    threadId,
                    refresh,
                    attempt,
                ),
                delay,
            )
        } catch (error) {
            this.release(threadId)
            this.ports.reportError(error, threadId)
        }
    }

    private async attempt(
        threadId: string,
        refresh: Refresh,
        attempt: number,
    ): Promise<void> {
        if (!this.isCurrent(threadId, refresh))
            return

        refresh.cancelTimer = undefined
        let complete = false

        try {
            const thread = await this.ports.fetchThread({
                workspaceId: refresh.scope.workspaceId,
                threadId,
            })

            if (!this.isCurrent(threadId, refresh))
                return

            if (thread) {
                if (
                    thread.threadId !== threadId
                    || thread.workspaceId !== refresh.scope.workspaceId
                )
                    throw new Error('Conversation refresh returned another workspace or thread')

                if (readCanvasConversationVersion(thread) >= readCanvasConversationVersion(
                    this.get(threadId),
                )) {
                    this.remember(thread)

                    if (!this.isCurrent(threadId, refresh))
                        return

                    complete = this.snapshotIsComplete(threadId, thread.content)

                    if (complete)
                        this.liveContent.delete(threadId)

                    this.ports.refreshProjection(threadId)
                }
            }
        } catch (error) {
            if (this.isCurrent(threadId, refresh))
                this.ports.reportError(error, threadId)
        }

        if (!this.isCurrent(threadId, refresh))
            return

        if (complete)
            this.release(threadId)
        else
            this.scheduleAttempt(
                threadId,
                refresh,
                attempt + 1,
            )
    }

    private isCurrent(
        threadId: string,
        refresh: Refresh,
    ): boolean {
        if (
            this.destroyed
            || this.refreshes.get(threadId) !== refresh
        )
            return false

        const scope = this.ports.readScope()

        return scope?.workspaceId === refresh.scope.workspaceId && scope.sceneKey === refresh.scope.sceneKey
    }

    private release(threadId: string): void {
        const refresh = this.refreshes.get(threadId)
        this.refreshes.delete(threadId)
        refresh?.cancelTimer?.()
    }
}
