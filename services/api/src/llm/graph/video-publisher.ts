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

const isPng = (buffer: Buffer): boolean =>
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a

// Mirrors ImagePublisher but for the async VEO lifecycle. There are no partial
// frames: the API projects VIDEO_PENDING (placeholder + traveling outline), then
// periodic VIDEO_GENERATING keepalive pings during the poll loop, then a single
// VIDEO_COMPLETE (or VIDEO_ERROR). NEX materializes poster/preview renditions on
// the same Asset for low-cost initial paint and later visual grounding.
export class VideoPublisher {
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

    // Persist the placeholder before publishing it so every connected client
    // receives the same node, edge, and coordinates.
    async pending(): Promise<void> {
        if (!this.generationRun) throw new Error('Video pending is missing generationRun')
        const assetId = this.generationRun.lineageAssignment?.assetId
        if (!assetId) throw new Error('Video pending is missing Asset assignment')
        const canvasGeometry = await attachGeneratedAssetNode({
            assetId,
            workspaceId: this.workspaceId,
            kind: 'video',
            aspectRatio: 1,
            generationRun: this.generationRun,
            conversationAssetId: this.aiChatThreadId,
        })
        this.publish({
            status: STREAM_STATUS.VIDEO_PENDING,
            videoUrl: '',
            assetId,
            aiProvider: this.provider,
            canvasGeometry,
            generationRun: this.generationRun,
        })
    }

    // Keepalive ping during the (minutes-long) poll so the UI is not frozen.
    generating(): void {
        this.publish({
            status: STREAM_STATUS.VIDEO_GENERATING,
            aiProvider: this.provider,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
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
        generationSeed?: number
        containerFormat?: 'mp4' | 'mov'
    }): Promise<void> {
        const {
            videoBuffer,
            posterBuffer,
            frameBuffer,
            durationSeconds,
            aspectRatio,
            hasAudio,
            responseId,
            revisedPrompt,
            videoModelId,
            generationSeed,
            containerFormat = 'mp4',
        } = args

        if (!videoBuffer || videoBuffer.length === 0) {
            throw new Error('Video completion failed: provider returned no video bytes')
        }
        // MP4 and QuickTime MOV are ISO base-media containers with an `ftyp` box.
        const isIsoBaseMedia = videoBuffer.length > 12
            && videoBuffer[4] === 0x66
            && videoBuffer[5] === 0x74
            && videoBuffer[6] === 0x79
            && videoBuffer[7] === 0x70
        if (!isIsoBaseMedia) {
            throw new Error('Video completion failed: provider returned bytes without an ISO base-media ftyp box')
        }
        if (posterBuffer && !isPng(posterBuffer)) throw new Error('Video completion failed: provider poster is not a PNG')
        if (frameBuffer && !isPng(frameBuffer)) throw new Error('Video completion failed: provider frame is not a PNG')

        if (!this.generationRun) throw new Error('Video completion is missing generationRun')
        const originalName = `generated-video.${containerFormat}`
        const mimeType = containerFormat === 'mov' ? 'video/quicktime' : 'video/mp4'
        const videoResult = await settleGeneratedAssetOriginal({
            generationRun: this.generationRun,
            workspaceId: this.workspaceId,
            buffer: videoBuffer,
            originalName,
            mimeType,
            kind: 'video',
            ...(generationSeed !== undefined ? { generationSeed } : {}),
            posterBuffer,
            representativeFrameBuffer: frameBuffer,
        })
        const parsedAspectRatio = aspectRatio.includes(':')
            ? Number(aspectRatio.split(':')[0]) / Number(aspectRatio.split(':')[1])
            : Number(aspectRatio)
        const canvasGeometry: CanvasGeometryUpdate = await attachGeneratedAssetNode({
            assetId: videoResult.assetId,
            workspaceId: this.workspaceId,
            kind: 'video',
            aspectRatio: Number.isFinite(parsedAspectRatio) ? parsedAspectRatio : 16 / 9,
            generationRun: this.generationRun,
            conversationAssetId: this.aiChatThreadId,
        })

        this.publish({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            videoUrl: videoResult.url,
            assetId: videoResult.assetId,
            durationSeconds,
            aspectRatio,
            hasAudio,
            responseId,
            revisedPrompt,
            aiProvider: this.provider,
            videoModelProvider: this.provider,
            videoModelId,
            canvasGeometry,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
        })
        const provenancePayload = {
            assetId: videoResult.assetId,
            organizationId: videoResult.organizationId,
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
                console.error('Video Asset provenance materialization failed; queued retry', error)
            }
            await enqueueProvenanceRebuild(provenancePayload)
        }
    }

    error(message: string): void {
        this.publish({
            status: STREAM_STATUS.VIDEO_ERROR,
            error: message,
            aiProvider: this.provider,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
        })
    }
}
