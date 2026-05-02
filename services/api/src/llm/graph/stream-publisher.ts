'use strict'

import type NatsService from '@lixpi/nats-service'

import { STREAM_STATUS, type StreamStatus } from '../config.ts'
import type { ProviderName } from '../config.ts'

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
    }
    aiChatThreadId: string
}

// Detects <image_prompt>...</image_prompt> XML tags in a token stream and emits
// COLLAPSIBLE_START/COLLAPSIBLE_END events around the tag content while passing
// the inner text through as STREAMING. Handles partial tags split across chunk
// boundaries by holding back up to BUFFER_SIZE characters.
export class TagAwareStream {
    private static readonly OPEN_TAG = '<image_prompt>'
    private static readonly CLOSE_TAG = '</image_prompt>'
    private static readonly BUFFER_SIZE = TagAwareStream.CLOSE_TAG.length

    private buffer = ''
    private inside = false

    constructor(
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
    ) {}

    private publish(content: ChunkPayload['content']): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content,
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    reset(): void {
        this.buffer = ''
        this.inside = false
    }

    // May hold back up to BUFFER_SIZE characters waiting to confirm whether
    // the chunk's tail is the start of a tag.
    push(text: string): void {
        if (!text) return
        this.buffer += text

        while (this.buffer.length > 0) {
            if (!this.inside) {
                const idx = this.buffer.indexOf(TagAwareStream.OPEN_TAG)
                if (idx === -1) {
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

                if (idx > 0) {
                    const before = this.buffer.slice(0, idx)
                    this.publish({
                        text: before,
                        status: STREAM_STATUS.STREAMING,
                        aiProvider: this.provider,
                    })
                }
                this.buffer = this.buffer.slice(idx + TagAwareStream.OPEN_TAG.length)
                this.inside = true
                this.publish({
                    status: STREAM_STATUS.COLLAPSIBLE_START,
                    collapsibleTitle: 'Image generation prompt',
                    aiProvider: this.provider,
                })
            } else {
                const idx = this.buffer.indexOf(TagAwareStream.CLOSE_TAG)
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
                this.buffer = this.buffer.slice(idx + TagAwareStream.CLOSE_TAG.length)
                this.inside = false
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
        if (this.inside) {
            this.publish({
                status: STREAM_STATUS.COLLAPSIBLE_END,
                aiProvider: this.provider,
            })
            this.inside = false
        }
    }
}

export class StreamPublisher {
    private tagBuffer: TagAwareStream

    constructor(
        private readonly nats: NatsService,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
    ) {
        this.tagBuffer = new TagAwareStream(nats, workspaceId, aiChatThreadId, provider)
    }

    start(): void {
        this.tagBuffer.reset()
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.START_STREAM,
                aiProvider: this.provider,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    chunk(text: string): void {
        this.tagBuffer.push(text)
    }

    end(): void {
        this.tagBuffer.flush()
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                text: '',
                status: STREAM_STATUS.END_STREAM,
                aiProvider: this.provider,
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
    }
}
