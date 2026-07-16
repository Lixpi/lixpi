'use strict'

import type NatsService from '@lixpi/nats-service'
import {
    getAiInteractionCanonicalResponseSubject,
    STREAM_STATUS,
    type CanvasGeometryUpdate,
    type MediaGenerationRunMeta,
    type ProviderName,
} from '@lixpi/constants'
import type { ChunkPayload, ProseMirrorContentHandler, ProseMirrorSnapshotProvider } from './stream-publisher.ts'
import { attachGeneratedAssetNode, settleGeneratedAssetOriginal } from '../../services/generated-asset-storage.ts'
import { materializeAssetProvenance } from '../../services/asset-provenance-materializer.ts'
import { enqueueProvenanceRebuild } from '../../services/asset-maintenance-queue.ts'

// Intrinsic pixel size read straight from the PNG IHDR / JPEG SOF header bytes
// (no image library). Lets the API persist final fitted node dimensions so
// clients never re-fit or re-layout after load. Returns null when unreadable.
export function readImageIntrinsicSize(buffer: Buffer): { width: number; height: number } | null {
    // PNG: 8-byte signature, then the IHDR chunk: 4-byte length, 'IHDR',
    // 4-byte width, 4-byte height.
    if (buffer.length >= 24
        && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        return width > 0 && height > 0 ? { width, height } : null
    }

    // JPEG: scan markers for a start-of-frame segment (SOF0-SOF15, excluding
    // DHT/DAC/RST) which carries 2-byte height then width after the precision byte.
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1
                continue
            }
            const marker = buffer[offset + 1]!
            if (marker === 0xff) {
                offset += 1
                continue
            }
            const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
            if (isStartOfFrame) {
                const height = buffer.readUInt16BE(offset + 5)
                const width = buffer.readUInt16BE(offset + 7)
                return width > 0 && height > 0 ? { width, height } : null
            }
            const segmentLength = buffer.readUInt16BE(offset + 2)
            if (segmentLength < 2) return null
            offset += 2 + segmentLength
        }
    }

    return null
}

export class ImagePublisher {
    private pendingCanvasGeometry?: Promise<CanvasGeometryUpdate>

    constructor(
        private readonly nats: NatsService,
        private readonly organizationId: string,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        private readonly generationRun?: MediaGenerationRunMeta,
        private readonly onProseMirrorContent?: ProseMirrorContentHandler,
        private readonly onPipelineContent?: ProseMirrorContentHandler,
        private readonly canvasVisibleArea?: { width: number; height: number },
        private readonly getProseMirrorSnapshot?: ProseMirrorSnapshotProvider,
    ) {}

    private publish(content: ChunkPayload['content']): void {
        if (this.onPipelineContent) {
            this.onPipelineContent(content)
            return
        }

        this.nats.publish(getAiInteractionCanonicalResponseSubject(this.organizationId, this.aiChatThreadId), {
            content,
            conversationAssetId: this.aiChatThreadId,
        })
        this.onProseMirrorContent?.(content)
    }

    // Empty imageBase64 publishes a placeholder event. Non-empty provider
    // partials stay transient; only final bytes settle the preassigned Asset.
    async partial(imageBase64: string, partialIndex: number): Promise<void> {
        if (!this.generationRun) throw new Error('Image partial is missing generationRun')
        const assetId = this.generationRun.lineageAssignment?.assetId
        if (!assetId) throw new Error('Image partial is missing Asset assignment')
        const intrinsicSize = imageBase64
            ? readImageIntrinsicSize(Buffer.from(imageBase64, 'base64'))
            : null
        this.pendingCanvasGeometry ??= attachGeneratedAssetNode({
            assetId,
            workspaceId: this.workspaceId,
            kind: 'image',
            aspectRatio: intrinsicSize ? intrinsicSize.width / intrinsicSize.height : 1,
            generationRun: this.generationRun,
            conversationAssetId: this.aiChatThreadId,
        })
        const canvasGeometry = await this.pendingCanvasGeometry

        if (!imageBase64) {
            this.publish({
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl: '',
                assetId,
                partialIndex,
                aiProvider: this.provider,
                canvasGeometry,
                generationRun: this.generationRun,
            })
            return
        }

        try {
            this.publish({
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl: `data:image/png;base64,${imageBase64}`,
                assetId,
                partialIndex,
                aiProvider: this.provider,
                ...(intrinsicSize ? { aspectRatio: intrinsicSize.width / intrinsicSize.height } : {}),
                canvasGeometry,
                generationRun: this.generationRun,
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
        if (!this.generationRun) throw new Error('Image completion is missing generationRun')
        const result = await settleGeneratedAssetOriginal({
            generationRun: this.generationRun,
            workspaceId: this.workspaceId,
            buffer,
            originalName: isPng ? 'generated-image.png' : 'generated-image.jpg',
            mimeType: isPng ? 'image/png' : 'image/jpeg',
            kind: 'image',
        })

        const intrinsicSize = readImageIntrinsicSize(buffer)
        const canvasGeometry: CanvasGeometryUpdate = await attachGeneratedAssetNode({
            assetId: result.assetId,
            workspaceId: this.workspaceId,
            kind: 'image',
            aspectRatio: intrinsicSize ? intrinsicSize.width / intrinsicSize.height : 1,
            generationRun: this.generationRun,
            conversationAssetId: this.aiChatThreadId,
        })

        console.info('[ImagePublisher] IMAGE_COMPLETE prepared', {
            workspaceId: this.workspaceId,
            conversationAssetId: this.aiChatThreadId,
            generationRequestId: this.generationRun?.generationRequestId ?? '',
            mediaRunId: this.generationRun?.mediaRunId ?? '',
            mediaModelId: this.generationRun?.mediaModelId ?? '',
            responseId,
            assetId: result.assetId,
        })

        this.publish({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            imageUrl: result.url,
            assetId: result.assetId,
            responseId,
            revisedPrompt,
            aiProvider: this.provider,
            imageModelProvider: this.provider,
            imageModelId,
            canvasGeometry,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
        })
        const provenancePayload = {
            assetId: result.assetId,
            organizationId: result.organizationId,
            workspaceId: this.workspaceId,
            conversationAssetId: this.aiChatThreadId,
            generationRun: this.generationRun,
            terminalStatus: 'completed' as const,
        }
        try {
            await this.getProseMirrorSnapshot?.()
            await materializeAssetProvenance(provenancePayload)
        } catch (error) {
            if ((error as { message?: unknown })?.message !== 'PROVENANCE_PROJECTION_NOT_READY') {
                console.error('Image Asset provenance materialization failed; queued retry', error)
            }
            await enqueueProvenanceRebuild(provenancePayload)
        }
    }
}
