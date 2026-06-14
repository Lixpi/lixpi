'use strict'

import type NatsService from '@lixpi/nats-service'
import {
    STREAM_STATUS,
    type ImageBranchVlmResolution,
    type ImageGenerationTrace,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
    type ProviderName,
    type StageTraceEvent,
    type StreamStatus,
    type VideoGenerationTrace,
    type WorkspaceContextResolution,
} from '@lixpi/constants'

const subject = (workspaceId: string, aiChatThreadId: string): string =>
    `ai.interaction.chat.receiveMessage.${workspaceId}.${aiChatThreadId}`

export type ChunkPayload = {
    content: {
        text?: string
        status: StreamStatus
        aiProvider: ProviderName
        collapsibleTitle?: string
        imageUrl?: string
        fileId?: string
        partialIndex?: number
        responseId?: string
        revisedPrompt?: string
        imageModelProvider?: string
        imageModelId?: string
        resolution?: ImageBranchVlmResolution
        workspaceContextResolution?: WorkspaceContextResolution
        imageGenerationTrace?: ImageGenerationTrace
        lineagePlan?: MediaBranchLineagePlan
        videoGenerationTrace?: VideoGenerationTrace
        error?: string
        extractionStatus?: string
        extractionDetail?: string
        stageTraceEvent?: StageTraceEvent
        featureCard?: Record<string, any>
        generationRun?: MediaGenerationRunMeta
    }
    aiChatThreadId: string
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
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        private readonly generationRun?: MediaGenerationRunMeta,
    ) {}

    private publish(content: ChunkPayload['content']): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                ...content,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
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
    private hasStarted = false
    private hasEnded = false

    constructor(
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        private readonly generationRun?: MediaGenerationRunMeta,
    ) {
        this.tagBuffer = new TagAwareStream(nats, workspaceId, aiChatThreadId, provider, generationRun)
    }

    start(): void {
        if (this.hasStarted) return

        this.hasStarted = true
        this.hasEnded = false
        this.tagBuffer.reset()
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.START_STREAM,
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    chunk(text: string): void {
        this.tagBuffer.push(text)
    }

    end(): void {
        if (!this.hasStarted || this.hasEnded) return

        this.hasEnded = true
        this.tagBuffer.flush()
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                text: '',
                status: STREAM_STATUS.END_STREAM,
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    extractionProgress(status: string, detail: string): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.STREAMING,
                aiProvider: this.provider,
                extractionStatus: status,
                extractionDetail: detail,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    stageTrace(event: StageTraceEvent): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.STREAMING,
                aiProvider: this.provider,
                stageTraceEvent: event,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    // Publishes the extracted feature as structured content. Sent this way (not as JSON
    // embedded in the token stream) so TagAwareStream's tail buffering can't truncate it.
    featureCard(payload: Record<string, any>): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.STREAMING,
                aiProvider: this.provider,
                featureCard: payload,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    imageBranchResolved(resolution: ImageBranchVlmResolution, generationRun: MediaGenerationRunMeta | undefined = this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.IMAGE_BRANCH_RESOLVED,
                aiProvider: this.provider,
                resolution,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    mediaLineagePlanned(lineagePlan: MediaBranchLineagePlan, generationRun: MediaGenerationRunMeta | undefined = this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.MEDIA_LINEAGE_PLANNED,
                aiProvider: this.provider,
                lineagePlan,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    contextRelevanceResolved(workspaceContextResolution: WorkspaceContextResolution, generationRun: MediaGenerationRunMeta | undefined = this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
                aiProvider: this.provider,
                workspaceContextResolution,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    contextRelevanceError(message: string): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                aiProvider: this.provider,
                error: message,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    imageGenerationTrace(trace: ImageGenerationTrace, generationRun: MediaGenerationRunMeta | undefined = trace.generationRun ?? this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.IMAGE_GENERATION_TRACE,
                aiProvider: this.provider,
                imageGenerationTrace: generationRun ? { ...trace, generationRun } : trace,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    imageGenerationError(message: string, generationRun: MediaGenerationRunMeta | undefined = this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.IMAGE_ERROR,
                aiProvider: this.provider,
                error: message,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    videoGenerationTrace(trace: VideoGenerationTrace, generationRun: MediaGenerationRunMeta | undefined = trace.generationRun ?? this.generationRun): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_GENERATION_TRACE,
                aiProvider: this.provider,
                videoGenerationTrace: generationRun ? { ...trace, generationRun } : trace,
                ...(generationRun ? { generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    imageBranchResolutionError(message: string): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.IMAGE_BRANCH_RESOLUTION_ERROR,
                aiProvider: this.provider,
                error: message,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
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
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                text: message,
                status: STREAM_STATUS.ERROR,
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }
}
