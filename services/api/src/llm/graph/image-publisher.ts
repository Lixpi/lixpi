import {
    info as debugInfo,
    err as debugError,
} from '@lixpi/debug-tools'
import type NatsService from '@lixpi/nats-service'
import {
    getAiInteractionCanonicalResponseSubject,
    STREAM_STATUS,
    type CanvasGeometryUpdate,
    type MediaGenerationRunMeta,
    type ProviderName,
} from '@lixpi/constants'
import {
    type ChunkPayload,
    type ProseMirrorContentHandler,
    type ProseMirrorSnapshotProvider,
} from './stream-publisher.ts'
import {
    attachGeneratedAssetNode,
    settleGeneratedAssetOriginal,
} from '../../services/generated-asset-storage.ts'
import { materializeAssetProvenance } from '../../services/asset-provenance-materializer.ts'
import { enqueueProvenanceRebuild } from '../../services/asset-maintenance-queue.ts'
import {
    TransientMediaStore,
    type TransientMediaMimeType,
} from '../../services/transient-media-store.ts'
import { readImageIntrinsicSize } from './image-intrinsic-size.ts'

export { readImageIntrinsicSize } from './image-intrinsic-size.ts'

export type CapturedImagePartialHandler = (
    imageBase64: string,
    providerPartialIndex: number,
) => Promise<void>

const readImageMimeType = (buffer: Buffer): TransientMediaMimeType | null => {
    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
    )
        return 'image/png'

    if (
        buffer.length >= 3
        && buffer[0] === 0xff
        && buffer[1] === 0xd8
        && buffer[2] === 0xff
    )
        return 'image/jpeg'

    if (
        buffer.length >= 12
        && buffer.toString(
            'ascii',
            0,
            4,
        ) === 'RIFF'
        && buffer.toString(
            'ascii',
            8,
            12,
        ) === 'WEBP'
    )
        return 'image/webp'

    if (
        buffer.length >= 6
        && (buffer.toString(
            'ascii',
            0,
            6,
        ) === 'GIF87a' || buffer.toString(
            'ascii',
            0,
            6,
        ) === 'GIF89a')
    )
        return 'image/gif'

    return null
}

export class ImagePublisher {
    private pendingCanvasGeometry?: Promise<CanvasGeometryUpdate>
    private readonly transientMediaStore?: TransientMediaStore

    constructor(
        private readonly nats: NatsService,
        private readonly organizationId: string,
        private readonly workspaceId: string,
        private readonly aiChatThreadId: string,
        private readonly provider: ProviderName,
        private readonly generationRun?: MediaGenerationRunMeta,
        private readonly onProseMirrorContent?: ProseMirrorContentHandler,
        private readonly onPipelineContent?: ProseMirrorContentHandler,
        private readonly canvasVisibleArea?: {
            width: number
            height: number
        },
        private readonly getProseMirrorSnapshot?: ProseMirrorSnapshotProvider,
        private readonly captureOnly = false,
        private readonly onCapturedPartial?: CapturedImagePartialHandler,
    ) {
        if (generationRun) {
            this.transientMediaStore = new TransientMediaStore(
                nats,
                {
                    organizationId,
                    workspaceId,
                    conversationAssetId: aiChatThreadId,
                    generationRequestId: generationRun.generationRequestId,
                    mediaRunId: generationRun.mediaRunId ?? generationRun.generationRequestId,
                },
            )
        }
    }

    private publish(content: ChunkPayload['content']): void {
        if (this.onPipelineContent) {
            this.onPipelineContent(content)

            return
        }

        this.nats.publish(
            getAiInteractionCanonicalResponseSubject(this.organizationId, this.aiChatThreadId),
            {
                content,
                conversationAssetId: this.aiChatThreadId,
            },
        )
        this.onProseMirrorContent?.(content)
    }

    // Capture-only publishers forward provider revisions to their owner without
    // exposing an isolated intermediate as top-level media. Ordinary partials
    // stay transient; only final bytes settle the preassigned Asset.
    async partial(
        imageBase64: string,
        partialIndex: number,
    ): Promise<void> {
        if (this.captureOnly) {
            await this.onCapturedPartial?.(imageBase64, partialIndex)

            return
        }

        if (!this.generationRun)
            throw new Error('Image partial is missing generationRun')

        const assetId = this.generationRun.lineageAssignment?.assetId

        if (!assetId)
            throw new Error('Image partial is missing Asset assignment')

        const partialBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : null
        const intrinsicSize = partialBuffer ? readImageIntrinsicSize(partialBuffer) : null
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
            if (
                !this.transientMediaStore
                || !partialBuffer
            )
                return

            const mimeType = readImageMimeType(partialBuffer) ?? 'image/png'
            const imageUrl = await this.transientMediaStore.put({
                mediaKind: 'image',
                slot: assetId,
                bytes: partialBuffer,
                mimeType,
                revision: partialIndex,
            })
            this.publish({
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl,
                assetId,
                partialIndex,
                aiProvider: this.provider,
                ...(intrinsicSize ? { aspectRatio: intrinsicSize.width / intrinsicSize.height } : {}),
                canvasGeometry,
                generationRun: this.generationRun,
            })
        } catch {
            // Skip a failed partial; the next partial or final image can proceed.
        }
    }

    async clearTransientMedia(): Promise<void> {
        await this.transientMediaStore?.clear()
    }

    async complete(args: {
        imageBase64: string
        responseId: string
        revisedPrompt: string
        imageModelId: string
        generationSeed?: number
    }): Promise<void> {
        const {
            imageBase64,
            responseId,
            revisedPrompt,
            imageModelId,
            generationSeed,
        } = args

        if (!imageBase64)
            throw new Error('Image completion failed: provider returned no final image bytes')

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

        if (
            !isPng
            && !isJpeg
        )
            throw new Error('Image completion failed: provider returned bytes that are not a PNG or JPEG image')

        if (this.captureOnly)
            return

        if (!this.generationRun)
            throw new Error('Image completion is missing generationRun')

        const result = await settleGeneratedAssetOriginal({
            generationRun: this.generationRun,
            workspaceId: this.workspaceId,
            buffer,
            originalName: isPng ? 'generated-image.png' : 'generated-image.jpg',
            mimeType: isPng ? 'image/png' : 'image/jpeg',
            kind: 'image',
            ...(readImageIntrinsicSize(buffer) ?? {}),
            ...(generationSeed !== undefined ? { generationSeed } : {}),
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

        debugInfo(
            '[ImagePublisher] IMAGE_COMPLETE prepared',
            {
                workspaceId: this.workspaceId,
                conversationAssetId: this.aiChatThreadId,
                generationRequestId: this.generationRun?.generationRequestId ?? '',
                mediaRunId: this.generationRun?.mediaRunId ?? '',
                mediaModelId: this.generationRun?.mediaModelId ?? '',
                responseId,
                assetId: result.assetId,
            },
        )

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

        try {
            await this.clearTransientMedia()
        } catch {
            // Provider teardown retries failed terminal cleanup.
        }

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
            if ((error as { message?: unknown })?.message !== 'PROVENANCE_PROJECTION_NOT_READY')
                debugError('Image Asset provenance materialization failed; queued retry', error)

            await enqueueProvenanceRebuild(provenancePayload)
        }
    }
}
