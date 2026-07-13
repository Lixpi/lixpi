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

// Mirrors ImagePublisher but for the async VEO lifecycle. There are no partial
// frames: the browser sees VIDEO_PENDING (placeholder + traveling outline), then
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

    // Placeholder event: UI creates the pending video node + traveling outline.
    pending(): void {
        this.publish({
            status: STREAM_STATUS.VIDEO_PENDING,
            videoUrl: '',
            assetId: this.generationRun?.lineageAssignment?.assetId,
            aiProvider: this.provider,
            ...(this.generationRun ? { generationRun: this.generationRun } : {}),
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
    }): Promise<void> {
        const { videoBuffer, durationSeconds, aspectRatio, hasAudio, responseId, revisedPrompt, videoModelId } = args

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

        if (!this.generationRun) throw new Error('Video completion is missing generationRun')
        const videoResult = await settleGeneratedAssetOriginal({
            generationRun: this.generationRun,
            workspaceId: this.workspaceId,
            buffer: videoBuffer,
            originalName: 'generated-video.mp4',
            mimeType: 'video/mp4',
            kind: 'video',
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
