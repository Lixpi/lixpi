'use strict'

import type NatsService from '@lixpi/nats-service'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

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
        private readonly generationRun?: MediaGenerationRunMeta,
    ) {}

    // Placeholder event: UI creates the pending video node + traveling outline.
    pending(): void {
        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_PENDING,
                videoUrl: '',
                fileId: '',
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
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
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }

    async complete(args: {
        videoBuffer: Buffer
        posterBuffer: Buffer | null
        frameBuffer?: Buffer | null
        durationSeconds: number
        aspectRatio: string
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModelId: string
    }): Promise<void> {
        const { videoBuffer, posterBuffer, frameBuffer, durationSeconds, aspectRatio, hasAudio, responseId, revisedPrompt, videoModelId } = args

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

        // Both the poster (frame 0, for the PIXI low-LoD preview) and the
        // representative mid-frame (for the branch resolver / VEO anchor) are
        // stored as ordinary workspace images. Both are best-effort: the video
        // still completes without either.
        const storeFrameImage = async (buffer: Buffer | null | undefined, originalName: string): Promise<{ url: string; fileId: string }> => {
            if (!buffer || buffer.length === 0) return { url: '', fileId: '' }
            try {
                const result = await this.storeImage({
                    workspaceId: this.workspaceId,
                    buffer,
                    originalName,
                    mimeType: 'image/png',
                    useContentHash: true,
                })
                return { url: result.url, fileId: result.fileId }
            } catch {
                return { url: '', fileId: '' }
            }
        }

        const poster = await storeFrameImage(posterBuffer, 'generated-video-poster.png')
        const frame = await storeFrameImage(frameBuffer, 'generated-video-frame.png')

        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.VIDEO_COMPLETE,
                videoUrl: videoResult.url,
                fileId: videoResult.fileId,
                posterUrl: poster.url,
                posterFileId: poster.fileId,
                frameUrl: frame.url,
                frameFileId: frame.fileId,
                durationSeconds,
                aspectRatio,
                hasAudio,
                responseId,
                revisedPrompt,
                aiProvider: this.provider,
                videoModelProvider: this.provider,
                videoModelId,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
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
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }
}
