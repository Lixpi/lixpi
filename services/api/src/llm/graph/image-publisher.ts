'use strict'

import type NatsService from '@lixpi/nats-service'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

import {
    logCanvasProjectionError,
    upsertGeneratedImageToCanvas,
} from '../../services/media-generation-canvas-projection.ts'
import type { ChunkPayload, ProseMirrorContentHandler } from './stream-publisher.ts'

// Store-function contract for the generation pipeline. The concrete
// implementation injected at the composition root is a storeWorkspaceFile
// adapter (see services/store-media-adapters.ts); the result is a superset of
// these fields.
export type StoreImageInput = {
    workspaceId: string
    buffer: Buffer
    originalName?: string
    mimeType?: string
    useContentHash?: boolean
}

export type StoreImageResult = {
    fileId: string
    url: string
    isDuplicate: boolean
    size: number
    mimeType: string
}

export type StoreWorkspaceImageFn = (input: StoreImageInput) => Promise<StoreImageResult>

const subject = (workspaceId: string, aiChatThreadId: string): string =>
    `ai.interaction.chat.receiveMessage.${workspaceId}.${aiChatThreadId}`

export class ImagePublisher {
    constructor(
        private readonly nats: NatsService,
        private readonly storeImage: StoreWorkspaceImageFn,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        private readonly generationRun?: MediaGenerationRunMeta,
        private readonly onProseMirrorContent?: ProseMirrorContentHandler,
        private readonly onPipelineContent?: ProseMirrorContentHandler,
        private readonly canvasVisibleArea?: { width: number; height: number },
    ) {}

    private publish(content: ChunkPayload['content']): void {
        if (this.onPipelineContent) {
            this.onPipelineContent(content)
            return
        }

        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content,
            aiChatThreadId: this.aiChatThreadId,
        })
        this.onProseMirrorContent?.(content)
    }

    // Empty imageBase64 publishes a placeholder event (UI shows animated border).
    // Non-empty uploads to NATS Object Store with content-hash dedup, then publishes IMAGE_PARTIAL.
    async partial(imageBase64: string, partialIndex: number): Promise<void> {
        if (!imageBase64) {
            this.publish({
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl: '',
                fileId: '',
                partialIndex,
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            })
            return
        }

        try {
            const buffer = Buffer.from(imageBase64, 'base64')
            const result = await this.storeImage({
                workspaceId: this.workspaceId,
                buffer,
                originalName: 'generated-image.png',
                mimeType: 'image/png',
                useContentHash: true,
            })

            this.publish({
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl: result.url,
                fileId: result.fileId,
                partialIndex,
                aiProvider: this.provider,
                ...(this.generationRun ? { generationRun: this.generationRun } : {}),
            })
        } catch {
            // Match Python behavior: log-and-skip on partial failure rather than
            // killing the entire stream. The next partial or the final image
            // will arrive shortly anyway.
        }
    }

    async complete(args: {
        imageBase64: string
        responseId: string
        revisedPrompt: string
        imageModelId: string
    }): Promise<void> {
        const { imageBase64, responseId, revisedPrompt, imageModelId } = args
        if (!imageBase64) {
            throw new Error('Image completion failed: provider returned no final image bytes')
        }
        const buffer = Buffer.from(imageBase64, 'base64')
        const isPng = buffer.length > 8
            && buffer[0] === 0x89
            && buffer[1] === 0x50
            && buffer[2] === 0x4e
            && buffer[3] === 0x47
        const isJpeg = buffer.length > 3
            && buffer[0] === 0xff
            && buffer[1] === 0xd8
            && buffer[2] === 0xff
        if (!isPng && !isJpeg) {
            throw new Error('Image completion failed: provider returned bytes that are not a PNG or JPEG image')
        }
        const result = await this.storeImage({
            workspaceId: this.workspaceId,
            buffer,
            originalName: isPng ? 'generated-image.png' : 'generated-image.jpg',
            mimeType: isPng ? 'image/png' : 'image/jpeg',
            useContentHash: true,
        })

        try {
            await upsertGeneratedImageToCanvas({
                workspaceId: this.workspaceId,
                aiChatThreadId: this.aiChatThreadId,
                imageUrl: result.url,
                fileId: result.fileId,
                responseId,
                revisedPrompt,
                aiProvider: this.provider,
                imageModelProvider: this.provider,
                imageModelId,
                generationRun: this.generationRun,
                ...(this.canvasVisibleArea ? { canvasVisibleArea: this.canvasVisibleArea } : {}),
            })
        } catch (error) {
            logCanvasProjectionError('failed to persist generated image to canvas', error)
        }

        this.publish({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            imageUrl: result.url,
            fileId: result.fileId,
            responseId,
            revisedPrompt,
            aiProvider: this.provider,
            imageModelProvider: this.provider,
            imageModelId,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
        })
    }
}
