'use strict'

import type NatsService from '@lixpi/nats-service'

import { STREAM_STATUS } from '../config.ts'
import type { ProviderName } from '../config.ts'
import type { StoreImageInput, StoreImageResult } from '../../services/image-storage.ts'

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
    ) {}

    // Empty imageBase64 publishes a placeholder event (UI shows animated border).
    // Non-empty uploads to NATS Object Store with content-hash dedup, then publishes IMAGE_PARTIAL.
    async partial(imageBase64: string, partialIndex: number): Promise<void> {
        if (!imageBase64) {
            this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
                content: {
                    status: STREAM_STATUS.IMAGE_PARTIAL,
                    imageUrl: '',
                    fileId: '',
                    partialIndex,
                    aiProvider: this.provider,
                },
                aiChatThreadId: this.aiChatThreadId,
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

            this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
                content: {
                    status: STREAM_STATUS.IMAGE_PARTIAL,
                    imageUrl: result.url,
                    fileId: result.fileId,
                    partialIndex,
                    aiProvider: this.provider,
                },
                aiChatThreadId: this.aiChatThreadId,
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
        const buffer = Buffer.from(imageBase64, 'base64')
        const result = await this.storeImage({
            workspaceId: this.workspaceId,
            buffer,
            originalName: 'generated-image.png',
            mimeType: 'image/png',
            useContentHash: true,
        })

        this.nats.publish(subject(this.workspaceId, this.aiChatThreadId), {
            content: {
                status: STREAM_STATUS.IMAGE_COMPLETE,
                imageUrl: result.url,
                fileId: result.fileId,
                responseId,
                revisedPrompt,
                aiProvider: this.provider,
                imageModelProvider: this.provider,
                imageModelId,
            },
            aiChatThreadId: this.aiChatThreadId,
        })
    }
}
