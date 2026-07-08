'use strict'

import { randomUUID } from 'node:crypto'
import type NatsService from '@lixpi/nats-service'
import { err } from '@lixpi/debug-tools'
import {
    STREAM_STATUS,
    type CanvasGeometryUpdate,
    type MediaBranchVlmResolution,
    type ImageGenerationTrace,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type ProviderName,
    type StageTraceEvent,
    type StreamStatus,
    type VideoGenerationTrace,
    type WorkspaceContextResolution,
} from '@lixpi/constants'

import { AiChatProseMirrorStreamAssembler } from '../../prosemirror/ai-chat-stream-assembler.ts'
import {
    logCanvasProjectionError,
    refreshMediaGenerationRequestCanvasGeometry,
    settleMediaGenerationRequestOnCanvas,
    upsertMediaLineagePlanToCanvas,
} from '../../services/media-generation-canvas-projection.ts'
import { PipelineEventLog } from './pipeline-event-log.ts'

const subject = (workspaceId: string, aiChatThreadId: string): string =>
    `ai.interaction.chat.receiveMessage.${workspaceId}.${aiChatThreadId}`

const COMPLETED_PIPELINE_EVENT_RETENTION_MS = 10 * 60 * 1000

export type ChunkPayload = {
    content: {
        text?: string
        status: StreamStatus
        aiProvider: ProviderName
        collapsibleTitle?: string
        imageUrl?: string
        fileId?: string
        partialIndex?: number
        videoUrl?: string
        posterUrl?: string
        posterFileId?: string
        frameUrl?: string
        frameFileId?: string
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
        error?: string
        generationRequestId?: string
        extractionStatus?: string
        extractionDetail?: string
        stageTraceEvent?: StageTraceEvent
        featureCard?: Record<string, any>
        generationRun?: MediaGenerationRunMeta
    }
    aiChatThreadId: string
}

type PipelineChunkPayload = ChunkPayload & {
    pipelineEventId: string
    pipelineStreamSeq?: number
}

export type StreamPublisherOptions = {
    enableProseMirrorStream?: boolean
    proseMirrorBaseVersion?: number
    proseMirrorInitialDoc?: object
    deferProseMirrorEnd?: boolean
    canvasVisibleArea?: { width: number; height: number }
    proseMirrorContentMirror?: ProseMirrorContentHandler
}

export type ProseMirrorContentHandler = (content: ChunkPayload['content']) => void
export type ProseMirrorSnapshotProvider = () => object | null | Promise<object | null>

type PublishChatContentOptions = {
    mirrorProseMirror?: boolean
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
    private proseMirrorFinishPromise: Promise<void> | null = null
    private responsePublishChain: Promise<void> = Promise.resolve()
    private canvasProjectionChain: Promise<void> = Promise.resolve()
    private streamCanvasGeometryRefreshScheduled = false
    private readonly mediaGenerationRequestIds = new Set<string>()
    private readonly completedMediaGenerationRequestIds = new Set<string>()

    constructor(
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        generationRun?: MediaGenerationRunMeta,
        private readonly options: StreamPublisherOptions = {},
    ) {
        this.currentGenerationRun = generationRun
        this.pipelineEventLog = new PipelineEventLog(nats)
        this.proseMirrorAssembler = options.enableProseMirrorStream
            ? new AiChatProseMirrorStreamAssembler({
                workspaceId,
                aiChatThreadId,
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
                console.info('[StreamPublisher][prosemirror-mirror] forwarding', {
                    workspaceId: this.workspaceId,
                    aiChatThreadId: this.aiChatThreadId,
                    status: content.status,
                    textLength: content.text?.length ?? 0,
                    generationRequestId: content.generationRun?.generationRequestId ?? this.currentGenerationRun?.generationRequestId ?? '',
                    reasoningRunId: content.generationRun?.reasoningRunId ?? this.currentGenerationRun?.reasoningRunId ?? '',
                    hasLocalAssembler: Boolean(this.proseMirrorAssembler),
                })
                this.options.proseMirrorContentMirror(content)
            } else if (this.options.proseMirrorContentMirror) {
                console.info('[StreamPublisher][prosemirror-mirror] skip', {
                    workspaceId: this.workspaceId,
                    aiChatThreadId: this.aiChatThreadId,
                    status: content.status,
                    reason: 'shared-matrix-publisher-owns-stream-end',
                    generationRequestId: content.generationRun?.generationRequestId ?? this.currentGenerationRun?.generationRequestId ?? '',
                    reasoningRunId: content.generationRun?.reasoningRunId ?? this.currentGenerationRun?.reasoningRunId ?? '',
                })
            }
            this.requestStreamCanvasGeometryRefresh(content)
        }

        this.responsePublishChain = this.publishResponseAfterCurrent(this.responsePublishChain, {
            content,
            aiChatThreadId: this.aiChatThreadId,
        })
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
            this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
                ...pipelinePayload,
                pipelineStreamSeq: event.streamSequence,
            })
        } catch (error) {
            err('[StreamPublisher] Failed to persist pipeline event before live publish:', error)
            this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), pipelinePayload)
        }
    }

    private async drainResponsePublishes(): Promise<void> {
        try {
            await this.responsePublishChain
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

    private requestStreamCanvasGeometryRefresh(content: ChunkPayload['content']): void {
        const generationRun = content.generationRun ?? this.currentGenerationRun
        const generationRequestId = generationRun?.generationRequestId
        const debugBase = {
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            status: content.status,
            textLength: content.text?.length ?? 0,
            generationRequestId: generationRequestId ?? '',
            trackedGenerationRequestIds: Array.from(this.mediaGenerationRequestIds),
            completedGenerationRequestIds: Array.from(this.completedMediaGenerationRequestIds),
            scheduled: this.streamCanvasGeometryRefreshScheduled,
            enableProseMirrorStream: Boolean(this.options.enableProseMirrorStream),
        }
        if (content.status !== STREAM_STATUS.STREAMING || !content.text) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'not-streaming-text',
            })
            return
        }
        if (!this.options.enableProseMirrorStream) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'prosemirror-stream-disabled',
            })
            return
        }
        if (!generationRequestId) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'missing-generation-request-id',
            })
            return
        }
        if (!this.mediaGenerationRequestIds.has(generationRequestId)) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'generation-request-not-tracked',
            })
            return
        }
        if (this.completedMediaGenerationRequestIds.has(generationRequestId)) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'generation-request-completed',
            })
            return
        }
        if (this.streamCanvasGeometryRefreshScheduled) {
            console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                ...debugBase,
                reason: 'refresh-already-scheduled',
            })
            return
        }

        this.streamCanvasGeometryRefreshScheduled = true
        console.info('[StreamPublisher][canvas-geometry-refresh] scheduled', debugBase)
        this.enqueueCanvasProjection(
            async () => {
                this.streamCanvasGeometryRefreshScheduled = false
                const proseMirrorThreadContent = await this.getProseMirrorSnapshot()
                if (!proseMirrorThreadContent) {
                    console.info('[StreamPublisher][canvas-geometry-refresh] skip', {
                        ...debugBase,
                        reason: 'missing-prosemirror-snapshot',
                    })
                    return
                }
                console.info('[StreamPublisher][canvas-geometry-refresh] executing', {
                    ...debugBase,
                    proseMirrorSnapshotPresent: true,
                })
                const canvasGeometry = await refreshMediaGenerationRequestCanvasGeometry({
                    workspaceId: this.workspaceId,
                    generationRequestId,
                    aiChatThreadId: this.aiChatThreadId,
                    proseMirrorThreadContent,
                })
                console.info('[StreamPublisher][canvas-geometry-refresh] resolved', {
                    ...debugBase,
                    hasCanvasGeometry: Boolean(canvasGeometry),
                    geometryNodeCount: canvasGeometry?.nodes.length ?? 0,
                    nodeSnapshotCount: canvasGeometry?.nodeSnapshots?.length ?? 0,
                    edgeSnapshotCount: canvasGeometry?.edgeSnapshots?.length ?? 0,
                    removedNodeCount: canvasGeometry?.removedNodeIds?.length ?? 0,
                    removedEdgeCount: canvasGeometry?.removedEdgeIds?.length ?? 0,
                })
                this.canvasGeometryResolved(canvasGeometry, generationRun)
            },
            'failed to refresh media generation canvas geometry from stream content',
        )
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
        console.info('[StreamPublisher][prosemirror-mirror] received-shared-content', {
            workspaceId: this.workspaceId,
            aiChatThreadId: this.aiChatThreadId,
            status: content.status,
            textLength: content.text?.length ?? 0,
            generationRequestId: content.generationRun?.generationRequestId ?? this.currentGenerationRun?.generationRequestId ?? '',
            reasoningRunId: content.generationRun?.reasoningRunId ?? this.currentGenerationRun?.reasoningRunId ?? '',
            hasAssembler: Boolean(this.proseMirrorAssembler),
        })
        this.proseMirrorAssembler?.handleContent(content)
        this.requestStreamCanvasGeometryRefresh(content)
    }

    finishProseMirrorStream(): Promise<void> {
        if (this.proseMirrorFinishPromise) return this.proseMirrorFinishPromise

        this.proseMirrorFinishPromise = this.finishPipelineStream()
        return this.proseMirrorFinishPromise
    }

    async drainPendingWrites(): Promise<void> {
        await this.drainResponsePublishes()
        await this.drainCanvasProjectionWrites()
    }

    private async finishPipelineStream(): Promise<void> {
        await this.drainResponsePublishes()
        await this.drainCanvasProjectionWrites()
        if (this.proseMirrorAssembler) {
            await this.proseMirrorAssembler.end()
        }
        this.schedulePipelineEventPurge()
    }

    private schedulePipelineEventPurge(): void {
        const timer = setTimeout(() => {
            const purgeCompletedPipeline = async (): Promise<void> => {
                try {
                    await this.pipelineEventLog.purgePipelineEvents(this.workspaceId, this.aiChatThreadId)
                } catch (error) {
                    err('[StreamPublisher] Failed to purge completed pipeline event log:', error)
                }
            }
            void purgeCompletedPipeline()
        }, COMPLETED_PIPELINE_EVENT_RETENTION_MS)
        if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
            timer.unref()
        }
    }

    chunk(text: string): void {
        this.tagBuffer.push(text)
    }

    end(): void {
        if (!this.hasStarted || this.hasEnded) return

        this.hasEnded = true
        this.tagBuffer.flush()
        const content: ChunkPayload['content'] = {
            text: '',
            status: STREAM_STATUS.END_STREAM,
            aiProvider: this.provider,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        }
        this.publishChatContent(content, { mirrorProseMirror: !this.options.deferProseMirrorEnd })
        if (this.options.deferProseMirrorEnd) {
            void this.proseMirrorAssembler?.finishTextPhase()
        } else {
            void this.finishProseMirrorStream()
        }
    }

    extractionProgress(status: string, detail: string): void {
        this.publishChatContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: this.provider,
            extractionStatus: status,
            extractionDetail: detail,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
    }

    stageTrace(event: StageTraceEvent): void {
        this.publishChatContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: this.provider,
            stageTraceEvent: event,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
    }

    // Publishes the extracted feature as structured content. Sent this way (not as JSON
    // embedded in the token stream) so TagAwareStream's tail buffering can't truncate it.
    featureCard(payload: Record<string, any>): void {
        this.publishChatContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: this.provider,
            featureCard: payload,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
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
        if (lineagePlan.generationRequestId) {
            this.mediaGenerationRequestIds.add(lineagePlan.generationRequestId)
        }
        this.enqueueCanvasProjection(
            async () => {
                const proseMirrorThreadContent = await this.getProseMirrorSnapshot()
                const canvasGeometry = await upsertMediaLineagePlanToCanvas({
                    workspaceId: this.workspaceId,
                    aiChatThreadId: this.aiChatThreadId,
                    lineagePlan,
                    ...(proseMirrorThreadContent ? { proseMirrorThreadContent } : {}),
                    ...(this.options.canvasVisibleArea ? { canvasVisibleArea: this.options.canvasVisibleArea } : {}),
                })
                this.canvasGeometryResolved(canvasGeometry, generationRun)
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

    mediaGenerationRequestComplete(generationRequestId: string): void {
        if (!generationRequestId || this.completedMediaGenerationRequestIds.has(generationRequestId)) return

        this.mediaGenerationRequestIds.add(generationRequestId)
        this.completedMediaGenerationRequestIds.add(generationRequestId)
        this.enqueueCanvasProjection(
            async () => {
                const proseMirrorThreadContent = await this.getProseMirrorSnapshot()
                const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
                    workspaceId: this.workspaceId,
                    generationRequestId,
                    aiChatThreadId: this.aiChatThreadId,
                    ...(proseMirrorThreadContent ? { proseMirrorThreadContent } : {}),
                })
                this.canvasGeometryResolved(canvasGeometry)
            },
            'failed to settle media generation request on canvas',
        )
        this.publishChatContent({
            status: STREAM_STATUS.MEDIA_GENERATION_REQUEST_COMPLETE,
            aiProvider: this.provider,
            generationRequestId,
            ...(this.currentGenerationRun ? { generationRun: this.currentGenerationRun } : {}),
        })
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
