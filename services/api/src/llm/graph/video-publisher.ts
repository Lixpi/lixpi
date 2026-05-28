'use strict'

import type NatsService from '@lixpi/nats-service'
import { STREAM_STATUS, type ProviderName } from '@lixpi/constants'

import type { StoreWorkspaceImageFn } from './image-publisher.ts'
import type { StoreVideoInput, StoreVideoResult } from '../../services/video-storage.ts'

export type StoreWorkspaceVideoFn = (input: StoreVideoInput) => Promise<StoreVideoResult>

const subject = (workspaceId: string, aiChatThreadId: string): string =>
    `ai.interaction.chat.receiveMessage.${workspaceId}.${aiChatThreadId}`

// Mirrors ImagePublisher but for the async VEO lifecycle. There are no partial
// frames: the browser sees VIDEO_PENDING (placeholder + traveling outline), then
// periodic VIDEO_GENERATING keepalive pings during the poll loop, then a single
// VIDEO_COMPLETE (or VIDEO_ERROR). The poster image (if ffmpeg produced one) is
// stored as a normal workspace image so the PIXI media layer can render it at low
// LoD before swapping to the live video texture.
export class VideoPublisher {
    constructor(
        private readonly nats: NatsService,
        private readonly storeVideo: StoreWorkspaceVideoFn,
        private readonly storeImage: StoreWorkspaceImageFn,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
    ) {}

    // Placeholder event: UI creates the pending video node + traveling outline.
    pending(): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_PENDING,
                videoUrl: '',
                fileId: '',
                aiProvider: this.provider,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    // Keepalive ping during the (minutes-long) poll so the UI is not frozen.
    generating(): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_GENERATING,
                aiProvider: this.provider,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    async complete(args: {
        videoBuffer: Buffer
        posterBuffer: Buffer | null
        durationSeconds: number
        aspectRatio: string
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModelId: string
    }): Promise<void> {
        const { videoBuffer, posterBuffer, durationSeconds, aspectRatio, hasAudio, responseId, revisedPrompt, videoModelId } = args

        if (!videoBuffer || videoBuffer.length === 0) {
            throw new Error('Video completion failed: provider returned no video bytes')
        }
        // MP4 sanity check: the second box must be `ftyp`.
        const isMp4 = videoBuffer.length > 12
            && videoBuffer[4] === 0x66
            && videoBuffer[5] === 0x74
            && videoBuffer[6] === 0x79
            && videoBuffer[7] === 0x70
        if (!isMp4) {
            throw new Error('Video completion failed: provider returned bytes that are not an MP4 (no ftyp box)')
        }

        const videoResult = await this.storeVideo({
            workspaceId: this.workspaceId,
            buffer: videoBuffer,
            originalName: 'generated-video.mp4',
            mimeType: 'video/mp4',
            useContentHash: true,
        })

        let posterUrl = ''
        let posterFileId = ''
        if (posterBuffer && posterBuffer.length > 0) {
            try {
                const posterResult = await this.storeImage({
                    workspaceId: this.workspaceId,
                    buffer: posterBuffer,
                    originalName: 'generated-video-poster.png',
                    mimeType: 'image/png',
                    useContentHash: true,
                })
                posterUrl = posterResult.url
                posterFileId = posterResult.fileId
            } catch {
                // Poster is best-effort; the video still completes without it.
            }
        }

        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_COMPLETE,
                videoUrl: videoResult.url,
                fileId: videoResult.fileId,
                posterUrl,
                posterFileId,
                durationSeconds,
                aspectRatio,
                hasAudio,
                responseId,
                revisedPrompt,
                aiProvider: this.provider,
                videoModelProvider: this.provider,
                videoModelId,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    error(message: string): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_ERROR,
                error: message,
                aiProvider: this.provider,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }
}
