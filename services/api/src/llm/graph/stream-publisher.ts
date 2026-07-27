'use strict'

import { randomUUID } from 'node:crypto'
import type NatsService from '@lixpi/nats-service'
import { err, info } from '@lixpi/debug-tools'
import {
    getAiInteractionCanonicalResponseSubject,
    STREAM_STATUS,
    type CapabilityGenerationTrace,
    type CanvasGeometryUpdate,
    type MediaBranchVlmResolution,
    type ImageGenerationTrace,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type ProviderName,
    type StreamStatus,
    type VideoGenerationTrace,
    type WorkspaceContextResolution,
} from '@lixpi/constants'

import { AiChatProseMirrorStreamAssembler } from '../../prosemirror/ai-chat-stream-assembler.ts'
import {
    logCanvasProjectionError,
    settleMediaGenerationRequestOnCanvas,
    upsertMediaLineagePlanToCanvas,
} from '../../services/asset-canvas-projection.ts'
import { PipelineEventLog } from './pipeline-event-log.ts'
import {
    materializeAssetProvenance,
    settleUnfinishedGeneratedAssets,
} from '../../services/asset-provenance-materializer.ts'
import { enqueueProvenanceRebuild } from '../../services/asset-maintenance-queue.ts'
import { attachPlannedGeneratedAssetNodes } from '../../services/generated-asset-storage.ts'

const PIPELINE_EVENT_PURGE_RETRY_MS = 60_000

const MEDIA_RESPONSE_PUBLISH_STATUSES: ReadonlySet<StreamStatus> = new Set([
    STREAM_STATUS.IMAGE_GENERATION_TRACE,
    STREAM_STATUS.IMAGE_PARTIAL,
    STREAM_STATUS.IMAGE_COMPLETE,
    STREAM_STATUS.IMAGE_ERROR,
    STREAM_STATUS.VIDEO_GENERATION_TRACE,
    STREAM_STATUS.VIDEO_PENDING,
    STREAM_STATUS.VIDEO_GENERATING,
    STREAM_STATUS.VIDEO_COMPLETE,
    STREAM_STATUS.VIDEO_ERROR,
])

export type ChunkPayload = {
    content: {
        text?: string
        status: StreamStatus
        aiProvider: ProviderName
        collapsibleTitle?: string
        imageUrl?: string
        assetId?: string
        partialIndex?: number
        videoUrl?: string
        posterUrl?: string
        frameUrl?: string
        durationSeconds?: number
        aspectRatio?: string | number
        hasAudio?: boolean
        responseId?: string
        revisedPrompt?: string
        imageModelProvider?: string
        imageModelId?: string
        videoModelProvider?: string
        videoModelId?: string
        resolution?: MediaBranchVlmResolution
        workspaceContextResolution?: WorkspaceContextResolution
        imageGenerationTrace?: ImageGenerationTrace
        lineagePlan?: MediaBranchLineagePlan
        canvasGeometry?: CanvasGeometryUpdate
        videoGenerationTrace?: VideoGenerationTrace
        capabilityGenerationTrace?: CapabilityGenerationTrace
        error?: string
        generationRequestId?: string
        generationRun?: MediaGenerationRunMeta
    }
    conversationAssetId: string
}

type PipelineChunkPayload = ChunkPayload & {
    pipelineEventId: string
    pipelineStreamSeq?: number
}

export type StreamPublisherOptions = {
    organizationId?: string
    assetLeaseId?: string
    assetLeaseHolderId?: string
    enableProseMirrorStream?: boolean
    proseMirrorBaseVersion?: number
    proseMirrorInitialDoc?: object
    deferProseMirrorEnd?: boolean
    canvasVisibleArea?: { width: number; height: number }
    proseMirrorContentMirror?: ProseMirrorContentHandler
}

type MediaGenerationRequestCompleteOptions = {
    removeProjectedPendingNodes?: boolean
}

export type ProseMirrorContentHandler = (content: ChunkPayload['content']) => void
export type ProseMirrorSnapshotProvider = () => object | null | Promise<object | null>

type PublishChatContentOptions = {
    mirrorProseMirror?: boolean
}

type EndStreamOptions = {
    deferPipelineFinish?: boolean
}

// A collapsible-wrapped prompt tag pair. The text model wraps the enhanced
// image/video prompt it is about to send in these XML tags so the UI can render
// it inside a collapsible instead of as raw inline text.
type CollapsiblePromptTag = {
    open: string
    close: string
    title: string
}

const COLLAPSIBLE_PROMPT_TAGS: readonly CollapsiblePromptTag[] = [
    { open: '<image_prompt>', close: '</image_prompt>', title: 'Image generation prompt' },
    { open: '<video_prompt>', close: '</video_prompt>', title: 'Video generation prompt' },
]

// Detects <image_prompt>…</image_prompt> and <video_prompt>…</video_prompt> XML tags
// in a token stream and emits COLLAPSIBLE_START/COLLAPSIBLE_END events around the tag
// content while passing the inner text through as STREAMING. Handles partial tags
// split across chunk boundaries by holding back up to BUFFER_SIZE characters.
export class TagAwareStream {
    // Hold back enough characters that no open or close tag can be split across a flush.
    private static readonly BUFFER_SIZE = Math.max(
        ...COLLAPSIBLE_PROMPT_TAGS.flatMap(tag => [tag.open.length, tag.close.length]),
    )

    private buffer = ''
    private active: CollapsiblePromptTag | null = null

    constructor(
        private readonly provider: ProviderName,
        private generationRun?: MediaGenerationRunMeta,
        private readonly onContent?: (content: ChunkPayload['content']) => void,
    ) {}

    setGenerationRun(generationRun: MediaGenerationRunMeta | undefined): void {
        this.generationRun = generationRun
    }

    private publish(content: ChunkPayload['content']): void {
        const publishedContent = {
            ...content,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
        }
        this.onContent?.(publishedContent)
    }

    reset(): void {
        this.buffer = ''
        this.active = null
    }

    // Finds the earliest-starting open tag in the buffer across all known specs.
    private findEarliestOpenTag(): { index: number; tag: CollapsiblePromptTag } | null {
        let best: { index: number; tag: CollapsiblePromptTag } | null = null
        for (const tag of COLLAPSIBLE_PROMPT_TAGS) {
            const index = this.buffer.indexOf(tag.open)
            if (index !== -1 && (best === null || index < best.index)) best = { index, tag }
        }
        return best
    }

    // May hold back up to BUFFER_SIZE characters waiting to confirm whether
    // the chunk's tail is the start of a tag.
    push(text: string): void {
        if (!text) return
        this.buffer += text

        while (this.buffer.length > 0) {
            if (!this.active) {
                const match = this.findEarliestOpenTag()
                if (!match) {
                    // No tag found — flush the safe portion (everything except a
                    // possible partial tag at the tail) and keep the rest buffered.
                    const safeLen = this.buffer.length - TagAwareStream.BUFFER_SIZE
                    if (safeLen > 0) {
                        const flush = this.buffer.slice(0, safeLen)
                        this.buffer = this.buffer.slice(safeLen)
                        this.publish({
                            text: flush,
                            status: STREAM_STATUS.STREAMING,
                            aiProvider: this.provider,
                        })
                    }
                    break
                }

                if (match.index > 0) {
                    const before = this.buffer.slice(0, match.index)
                    this.publish({
                        text: before,
                        status: STREAM_STATUS.STREAMING,
                        aiProvider: this.provider,
                    })
                }
                this.buffer = this.buffer.slice(match.index + match.tag.open.length)
                this.active = match.tag
                this.publish({
                    status: STREAM_STATUS.COLLAPSIBLE_START,
                    collapsibleTitle: match.tag.title,
                    aiProvider: this.provider,
                })
            } else {
                const idx = this.buffer.indexOf(this.active.close)
                if (idx === -1) {
                    const safeLen = this.buffer.length - TagAwareStream.BUFFER_SIZE
                    if (safeLen > 0) {
                        const flush = this.buffer.slice(0, safeLen)
                        this.buffer = this.buffer.slice(safeLen)
                        this.publish({
                            text: flush,
                            status: STREAM_STATUS.STREAMING,
                            aiProvider: this.provider,
                        })
                    }
                    break
                }

                if (idx > 0) {
                    const before = this.buffer.slice(0, idx)
                    this.publish({
                        text: before,
                        status: STREAM_STATUS.STREAMING,
                        aiProvider: this.provider,
                    })
                }
                this.buffer = this.buffer.slice(idx + this.active.close.length)
                this.active = null
                this.publish({
                    status: STREAM_STATUS.COLLAPSIBLE_END,
                    aiProvider: this.provider,
                })
            }
        }
    }

    // Flushes remaining buffer; emits a graceful COLLAPSIBLE_END if stream ends inside a tag.
    flush(): void {
        if (this.buffer.length > 0) {
            this.publish({
                text: this.buffer,
                status: STREAM_STATUS.STREAMING,
                aiProvider: this.provider,
            })
            this.buffer = ''
        }
        if (this.active) {
            this.publish({
                status: STREAM_STATUS.COLLAPSIBLE_END,
                aiProvider: this.provider,
            })
            this.active = null
        }
    }
}

export class StreamPublisher {
    private tagBuffer: TagAwareStream
    private readonly proseMirrorAssembler: AiChatProseMirrorStreamAssembler | null
    private readonly pipelineEventLog: PipelineEventLog
    private currentGenerationRun: MediaGenerationRunMeta | undefined
    private hasStarted = false
    private hasEnded = false
    private proseMirrorConversationFinishPromise: Promise<void> | null = null
    private proseMirrorFinishPromise: Promise<void> | null = null
    private responsePublishChain: Promise<void> = Promise.resolve()
    private readonly mediaResponsePublishChains = new Map<string, Promise<void>>()
    private canvasProjectionChain: Promise<void> = Promise.resolve()
    private readonly mediaGenerationRequestIds = new Set<string>()
    private readonly mediaLineagePlans = new Map<string, MediaBranchLineagePlan>()
    private readonly completedMediaGenerationRequestIds = new Set<string>()
    private readonly cancelledMediaGenerationRequestIds = new Set<string>()

    constructor(
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        generationRun?: MediaGenerationRunMeta,
        private readonly options: StreamPublisherOptions = {},
    ) {
        if (options.enableProseMirrorStream
            && (!options.organizationId || !options.assetLeaseId || !options.assetLeaseHolderId)) {
            throw new Error('Conversation Asset streaming requires organizationId, assetLeaseId, and assetLeaseHolderId')
        }
        this.currentGenerationRun = generationRun
        this.pipelineEventLog = new PipelineEventLog(nats)
        this.proseMirrorAssembler = options.enableProseMirrorStream
            ? new AiChatProseMirrorStreamAssembler({
                organizationId: options.organizationId!,
                workspaceId,
                aiChatThreadId,
                leaseId: options.assetLeaseId!,
                leaseHolderId: options.assetLeaseHolderId!,
                provider,
                generationRun,
                baseVersion: options.proseMirrorBaseVersion,
                initialDoc: options.proseMirrorInitialDoc,
            })
            : null
        this.tagBuffer = new TagAwareStream(
            provider,
            generationRun,
            content => this.publishChatContent(content),
        )
    }

    setGenerationRun(generationRun: MediaGenerationRunMeta | undefined): void {
        if (!generationRun) return
        this.currentGenerationRun = generationRun
        this.tagBuffer.setGenerationRun(generationRun)
    }

    async getProseMirrorSnapshot(): Promise<object | null> {
        if (!this.proseMirrorAssembler) return null
        await this.proseMirrorAssembler.flushPendingWork()
        return this.proseMirrorAssembler.snapshotForProjection()
    }

    publishChatContent(content: ChunkPayload['content'], options: PublishChatContentOptions = {}): void {
        if (options.mirrorProseMirror !== false) {
            this.proseMirrorAssembler?.handleContent(content)
            if (this.options.proseMirrorContentMirror && content.status !== STREAM_STATUS.END_STREAM) {
                this.options.proseMirrorContentMirror(content)
            }
        }

        this.enqueueResponsePublish({
            content,
            conversationAssetId: this.aiChatThreadId,
        })
        if (content.status === STREAM_STATUS.IMAGE_ERROR || content.status === STREAM_STATUS.VIDEO_ERROR) {
            const generationRun = content.generationRun
            const assetId = generationRun?.lineageAssignment?.assetId
            const organizationId = this.options.organizationId
            if (generationRun && assetId && organizationId) {
                const payload = {
                    organizationId,
                    assetId,
                    workspaceId: this.workspaceId,
                    conversationAssetId: this.aiChatThreadId,
                    generationRun,
                    terminalStatus: 'failed' as const,
                }
                void materializeAssetProvenance(payload).catch(async (error) => {
                    err('[StreamPublisher] failed provenance materialization; queued retry:', error)
                    await enqueueProvenanceRebuild(payload)
                })
            }
        }
    }

    private enqueueResponsePublish(payload: ChunkPayload): void {
        const queueKey = this.getResponsePublishQueueKey(payload.content)
        if (!queueKey) {
            this.responsePublishChain = this.publishResponseAfterCurrent(this.responsePublishChain, payload)
            return
        }

        const previous = this.mediaResponsePublishChains.get(queueKey) ?? Promise.resolve()
        const next = this.publishResponseAfterCurrent(previous, payload)
        this.mediaResponsePublishChains.set(queueKey, next)
        void this.forgetSettledMediaResponsePublishChain(queueKey, next)
    }

    private getResponsePublishQueueKey(content: ChunkPayload['content']): string | null {
        const mediaRunId = content.generationRun?.mediaRunId
        if (!mediaRunId || !MEDIA_RESPONSE_PUBLISH_STATUSES.has(content.status)) return null
        return `media:${mediaRunId}`
    }

    private async forgetSettledMediaResponsePublishChain(queueKey: string, promise: Promise<void>): Promise<void> {
        try {
            await promise
        } catch {
            // publishResponseNow already logs and falls back to live publish.
        }
        if (this.mediaResponsePublishChains.get(queueKey) === promise) {
            this.mediaResponsePublishChains.delete(queueKey)
        }
    }

    private async publishResponseAfterCurrent(previous: Promise<void>, payload: ChunkPayload): Promise<void> {
        try {
            await previous
        } catch {
            // A failed previous JetStream write falls back to live publish and should
            // not prevent later pipeline events from being delivered in order.
        }
        await this.publishResponseNow(payload)
    }

    private async publishResponseNow(payload: ChunkPayload): Promise<void> {
        const pipelineEventId = randomUUID()
        const pipelinePayload: PipelineChunkPayload = {
            ...payload,
            pipelineEventId,
        }
        try {
            const event = await this.pipelineEventLog.publishEvent({
                workspaceId: this.workspaceId,
                pipelineId: this.aiChatThreadId,
                eventId: pipelineEventId,
                payload: pipelinePayload as unknown as Record<string, any>,
            })
            this.nats.publish(getAiInteractionCanonicalResponseSubject(
                this.options.organizationId ?? this.workspaceId,
                this.aiChatThreadId,
            ), {
                ...pipelinePayload,
                pipelineStreamSeq: event.streamSequence,
            })
        } catch (error) {
            err('[StreamPublisher] Failed to persist pipeline event before live publish:', error)
            this.nats.publish(getAiInteractionCanonicalResponseSubject(
                this.options.organizationId ?? this.workspaceId,
                this.aiChatThreadId,
            ), pipelinePayload)
        }
    }

    private async drainResponsePublishes(): Promise<void> {
        while (true) {
            const chains = [
                this.responsePublishChain,
                ...this.mediaResponsePublishChains.values(),
            ]
            await Promise.all(chains.map(chain => this.ignorePublishChainFailure(chain)))
            const nextChains = [
                this.responsePublishChain,
                ...this.mediaResponsePublishChains.values(),
            ]
            if (nextChains.length === chains.length && nextChains.every((chain, index) => chain === chains[index])) {
                return
            }
        }
    }

    private async ignorePublishChainFailure(chain: Promise<void>): Promise<void> {
        try {
            await chain
        } catch {
            // publishResponseNow already logs and falls back to live publish.
        }
    }

    private enqueueCanvasProjection(write: () => Promise<void>, errorContext: string): void {
        this.canvasProjectionChain = this.canvasProjectionChain
            .catch(() => undefined)
            .then(async () => {
                try {
                    await write()
                } catch (error) {
                    logCanvasProjectionError(errorContext, error)
                }
            })
    }

    private async drainCanvasProjectionWrites(): Promise<void> {
        try {
            await this.canvasProjectionChain
        } catch {
            // enqueueCanvasProjection already logs and swallows individual failures.
        }
    }

    start(): void {
        if (this.hasStarted) return

        this.hasStarted = true
        this.hasEnded = false
        this.proseMirrorConversationFinishPromise = null
        this.proseMirrorFinishPromise = null
        this.tagBuffer.reset()
        const content: ChunkPayload['content'] = {
            status: STREAM_STATUS.START_STREAM,
            aiProvider: this.provider,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        }
        this.publishChatContent(content)
    }

    publishProseMirrorContent(content: ChunkPayload['content']): void {
        this.proseMirrorAssembler?.handleContent(content)
    }

    finishProseMirrorStream(): Promise<void> {
        if (this.proseMirrorFinishPromise) return this.proseMirrorFinishPromise

        this.proseMirrorFinishPromise = this.finishPipelineStream()
        return this.proseMirrorFinishPromise
    }

    finishProseMirrorConversation(): Promise<void> {
        if (this.proseMirrorConversationFinishPromise) return this.proseMirrorConversationFinishPromise

        this.proseMirrorConversationFinishPromise = this.proseMirrorAssembler?.end() ?? Promise.resolve()
        return this.proseMirrorConversationFinishPromise
    }

    async drainPendingWrites(): Promise<void> {
        await this.drainResponsePublishes()
        await this.drainCanvasProjectionWrites()
        // Canvas projection writes can enqueue authoritative geometry events.
        await this.drainResponsePublishes()
    }

    async cancelProseMirrorGenerationRequest(generationRequestId: string): Promise<void> {
        await this.proseMirrorAssembler?.cancelGenerationRequest(generationRequestId)
    }

    private async finishPipelineStream(): Promise<void> {
        await this.drainPendingWrites()
        await this.finishProseMirrorConversation()
        // Matrix child publishers share the request publisher's pipeline subject.
        // Only the publisher that owns the persisted conversation lifecycle may
        // purge after the complete request, including every sibling, has settled.
        if (this.options.enableProseMirrorStream) {
            await this.purgePipelineEventLog()
        }
    }

    private async purgePipelineEventLog(): Promise<void> {
        try {
            await this.pipelineEventLog.purgePipelineEvents(this.workspaceId, this.aiChatThreadId)
        } catch (error) {
            err('[StreamPublisher] Failed to purge finished pipeline event log; retrying:', error)
            this.schedulePipelineEventPurgeRetry()
        }
    }

    private schedulePipelineEventPurgeRetry(): void {
        const timer = setTimeout(() => {
            void this.purgePipelineEventLog()
        }, PIPELINE_EVENT_PURGE_RETRY_MS)
        if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
            timer.unref()
        }
    }

    chunk(text: string): void {
        this.tagBuffer.push(text)
    }

    end(options: EndStreamOptions = {}): void {
        if (!this.hasStarted || this.hasEnded) return

        this.hasEnded = true
        this.tagBuffer.flush()
        const deferPipelineFinish = this.options.deferProseMirrorEnd || options.deferPipelineFinish === true
        const content: ChunkPayload['content'] = {
            text: '',
            status: STREAM_STATUS.END_STREAM,
            aiProvider: this.provider,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        }
        this.publishChatContent(content, { mirrorProseMirror: !deferPipelineFinish })
        if (deferPipelineFinish) {
            void this.proseMirrorAssembler?.finishTextPhase()
        } else {
            void this.finishProseMirrorStream()
        }
    }

    mediaBranchResolved(resolution: MediaBranchVlmResolution, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_BRANCH_RESOLVED,
            aiProvider: this.provider,
            resolution,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    // Broadcasts the API-resolved geometry once an async canvas projection has
    // persisted it, so every connected client applies authoritative positions
    // instead of computing its own layout.
    canvasGeometryResolved(canvasGeometry: CanvasGeometryUpdate | null, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        if (
            !canvasGeometry
            || (
                canvasGeometry.nodes.length === 0
                && (canvasGeometry.nodeSnapshots?.length ?? 0) === 0
                && (canvasGeometry.edgeSnapshots?.length ?? 0) === 0
                && (canvasGeometry.removedNodeIds?.length ?? 0) === 0
                && (canvasGeometry.removedEdgeIds?.length ?? 0) === 0
            )
        ) return
        this.publishChatContent({
            status: STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED,
            aiProvider: this.provider,
            canvasGeometry,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    mediaLineagePlanned(lineagePlan: MediaBranchLineagePlan, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        this.setGenerationRun(generationRun)
        this.mediaLineagePlans.set(lineagePlan.generationRequestId, lineagePlan)
        if (lineagePlan.generationRequestId) {
            this.mediaGenerationRequestIds.add(lineagePlan.generationRequestId)
        }
        this.enqueueCanvasProjection(
            async () => {
                const proseMirrorThreadContent = await this.getProseMirrorSnapshot()
                const markerCanvasGeometry = await upsertMediaLineagePlanToCanvas({
                    workspaceId: this.workspaceId,
                    conversationAssetId: this.aiChatThreadId,
                    lineagePlan,
                    ...(proseMirrorThreadContent ? { proseMirrorThreadContent } : {}),
                    ...(this.options.canvasVisibleArea ? { canvasVisibleArea: this.options.canvasVisibleArea } : {}),
                })
                const plannedMediaCanvasGeometry = await attachPlannedGeneratedAssetNodes({
                    lineagePlan,
                    workspaceId: this.workspaceId,
                    conversationAssetId: this.aiChatThreadId,
                })
                this.canvasGeometryResolved(plannedMediaCanvasGeometry ?? markerCanvasGeometry, generationRun)
            },
            'failed to persist media lineage plan to canvas',
        )

        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_LINEAGE_PLANNED,
            aiProvider: this.provider,
            lineagePlan,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    // The reasoning model finished without emitting a media tool call after a
    // lineage plan was already published; the planned runs will never start.
    mediaGenerationSkipped(generationRequestId: string, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        this.mediaGenerationRequestIds.add(generationRequestId)
        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_GENERATION_SKIPPED,
            aiProvider: this.provider,
            generationRequestId,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    mediaGenerationRequestComplete(
        generationRequestId: string,
        options: MediaGenerationRequestCompleteOptions = {},
    ): void {
        if (!generationRequestId) return

        const alreadyCompleted = this.completedMediaGenerationRequestIds.has(generationRequestId)
        const requiresCancellationCleanup = options.removeProjectedPendingNodes === true
            && !this.cancelledMediaGenerationRequestIds.has(generationRequestId)
        if (alreadyCompleted && !requiresCancellationCleanup) return

        this.mediaGenerationRequestIds.add(generationRequestId)
        this.completedMediaGenerationRequestIds.add(generationRequestId)
        if (requiresCancellationCleanup) this.cancelledMediaGenerationRequestIds.add(generationRequestId)
        this.enqueueCanvasProjection(
            async () => {
                const proseMirrorThreadContent = await this.getProseMirrorSnapshot()
                const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
                    workspaceId: this.workspaceId,
                    generationRequestId,
                    ...(proseMirrorThreadContent ? { proseMirrorThreadContent } : {}),
                    ...(requiresCancellationCleanup ? { removeProjectedPendingNodes: true } : {}),
                    ...(this.mediaLineagePlans.get(generationRequestId)
                        ? { lineagePlan: this.mediaLineagePlans.get(generationRequestId) }
                        : {}),
                })
                this.canvasGeometryResolved(canvasGeometry)
            },
            'failed to settle media generation request on canvas',
        )
        if (alreadyCompleted) return

        info(`[StreamPublisher] media generation request complete ${JSON.stringify({
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            generationRequestId,
            generationRun: this.currentGenerationRun,
        })}`)
        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_GENERATION_REQUEST_COMPLETE,
            aiProvider: this.provider,
            generationRequestId,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
        const plan = this.mediaLineagePlans.get(generationRequestId)
        const organizationId = this.options.organizationId
        if (plan && organizationId) {
            void settleUnfinishedGeneratedAssets({
                plan,
                organizationId,
                workspaceId: this.workspaceId,
                conversationAssetId: this.aiChatThreadId,
                terminalStatus: requiresCancellationCleanup ? 'cancelled' : 'failed',
            }).catch((error) => err('[StreamPublisher] failed to settle unfinished generated Assets:', error))
        }
    }

    completeKnownMediaGenerationRequests(): void {
        for (const generationRequestId of Array.from(this.mediaGenerationRequestIds)) {
            this.mediaGenerationRequestComplete(generationRequestId)
        }
    }

    contextRelevanceResolved(workspaceContextResolution: WorkspaceContextResolution, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        this.publishChatContent({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
            aiProvider: this.provider,
            workspaceContextResolution,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    contextRelevanceError(message: string): void {
        this.publishChatContent({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
            aiProvider: this.provider,
            error: message,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
    }

    imageGenerationTrace(trace: ImageGenerationTrace, generationRun: MediaGenerationRunMeta | undefined = trace.generationRun ?? this.currentGenerationRun): void {
        const content: ChunkPayload['content'] = {
            status: STREAM_STATUS.IMAGE_GENERATION_TRACE,
            aiProvider: this.provider,
            imageGenerationTrace: generationRun ? { ...trace, generationRun } : trace,
            ...(generationRun ? { generationRun } : {}),
        }
        this.publishChatContent(content)
    }

    imageGenerationError(message: string, generationRun: MediaGenerationRunMeta | undefined = this.currentGenerationRun): void {
        this.publishChatContent({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: this.provider,
            error: message,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    videoGenerationTrace(trace: VideoGenerationTrace, generationRun: MediaGenerationRunMeta | undefined = trace.generationRun ?? this.currentGenerationRun): void {
        const content: ChunkPayload['content'] = {
            status: STREAM_STATUS.VIDEO_GENERATION_TRACE,
            aiProvider: this.provider,
            videoGenerationTrace: generationRun ? { ...trace, generationRun } : trace,
            ...(generationRun ? { generationRun } : {}),
        }
        this.publishChatContent(content)
    }

    capabilityGenerationTrace(
        trace: CapabilityGenerationTrace,
        generationRun: MediaGenerationRunMeta | undefined = trace.generationRun ?? this.currentGenerationRun,
    ): void {
        this.publishChatContent({
            status: STREAM_STATUS.CAPABILITY_GENERATION_TRACE,
            aiProvider: this.provider,
            capabilityGenerationTrace: generationRun ? { ...trace, generationRun } : trace,
            ...(generationRun ? { generationRun } : {}),
        })
    }

    mediaBranchResolutionError(message: string): void {
        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_BRANCH_RESOLUTION_ERROR,
            aiProvider: this.provider,
            error: message,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
    }

    error(message: string, code?: string, type?: string): void {
        const instanceKey = `${this.workspaceId}:${this.aiChatThreadId}`
        const payload: Record<string, unknown> = {
            error: message,
            instanceKey,
        }
        if (code) payload.errorCode = code
        if (type) payload.errorType = type
        this.nats.publish(`ai.interaction.chat.error.${instanceKey}`, payload)
        const content: ChunkPayload['content'] = {
            text: message,
            status: STREAM_STATUS.ERROR,
            aiProvider: this.provider,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        }
        this.publishChatContent(content)
    }
}
