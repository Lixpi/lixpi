'use strict'

import * as process from 'process'

import { info, err } from '@lixpi/debug-tools'
import type { ProviderName } from '@lixpi/constants'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderState, VideoUsage } from '../graph/state.ts'
import { extractPosterFrame, extractRepresentativeFrame } from '../../services/video-storage.ts'
import { BYTEPLUS_ARK_BASE_URL, BYTEPLUS_VIDEO_POLL_INTERVAL_MS } from '../config.ts'
import {
    BytePlusModelArkError,
    buildSeedanceContent,
    createVideoGenerationTask,
    downloadVideo,
    pollVideoGenerationTask,
    type BytePlusClientConfig,
    type CreateVideoGenerationTaskPayload,
} from './byteplus-video-types.ts'

// First-party video provider for BytePlus ModelArk's official Seedance 2.0 API.
// A clean peer of GoogleProvider: it is invoked as a transient provider by the
// VideoRouter (instanceKey {ws}:{thread}:video, enableVideoGeneration=true) and
// runs the async create+poll+download path inside the request, publishing the
// shared video NATS lifecycle. It is video-only — text streaming throws a
// capability error.
export class BytePlusProvider extends BaseProvider {
    readonly providerName: ProviderName = 'BytePlus'
    private readonly clientConfig: BytePlusClientConfig

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.BYTEPLUS_ARK_API_KEY || process.env.ARK_API_KEY
        if (!apiKey) {
            throw new Error('BYTEPLUS_ARK_API_KEY (or ARK_API_KEY) environment variable is required')
        }
        this.clientConfig = { baseUrl: BYTEPLUS_ARK_BASE_URL, apiKey }
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const modelVersion = state.modelVersion
        const enableVideoGeneration = state.enableVideoGeneration ?? false
        const isSeedanceVideo = enableVideoGeneration && /seedance/i.test(modelVersion)

        if (!isSeedanceVideo) {
            // Video-only provider: there is no text/image streaming path. The
            // router only ever dispatches Seedance video here, so anything else
            // is a misconfiguration worth surfacing loudly.
            throw new Error(
                `BytePlus provider supports Seedance video generation only ` +
                `(model="${modelVersion}", enableVideoGeneration=${enableVideoGeneration}).`,
            )
        }

        const videoUsage = await this.runSeedanceGeneration(state)
        const responseId = videoUsage.responseId
        return {
            generatedVideos: ['seedance-complete'],
            videoUsage,
            aiVendorRequestId: responseId ? `byteplus-${responseId}` : undefined,
        }
    }

    // Create + poll + download a Seedance task, then store the MP4 and publish
    // the video lifecycle. Mirrors GoogleProvider.runVeoGeneration: emit
    // VIDEO_PENDING on accept, VIDEO_GENERATING keepalives during the poll,
    // VIDEO_COMPLETE on success (or VIDEO_ERROR + throw on failure, which the
    // streamImpl catch in BaseProvider converts to update.error).
    private async runSeedanceGeneration(state: ProviderState): Promise<VideoUsage & { responseId?: string }> {
        const modelVersion = state.modelVersion
        // VideoRouter passes the final prompt as the first user message's content.
        const first = state.messages[0]
        const prompt = typeof first?.content === 'string' ? first.content : ''
        if (!prompt) throw new Error('Seedance: missing prompt in user message')

        // References reaching the provider are already capped to the provider-aware
        // budget upstream by the VideoRouter (which holds the full model metadata).
        const content = buildSeedanceContent(prompt, {
            videoSourceForExtension: state.videoSourceForExtension,
            videoFirstFrameImage: state.videoFirstFrameImage,
            videoReferenceImages: state.videoReferenceImages,
        })
        const duration = Number(state.videoDurationSeconds) || undefined

        const payload: CreateVideoGenerationTaskPayload = {
            model: modelVersion,
            content,
            ...(state.videoResolution ? { resolution: state.videoResolution } : {}),
            ...(state.videoAspectRatio ? { ratio: state.videoAspectRatio } : {}),
            ...(duration ? { duration } : {}),
            generate_audio: true,
            watermark: false,
        }

        const referenceCount = content.filter((c) => c.type === 'image_url' && c.role === 'reference_image').length
        const hasFirstFrame = content.some((c) => c.type === 'image_url' && c.role === 'first_frame')
        info(`[BytePlus:${this.instanceKey}] Seedance submit ${JSON.stringify({
            model: modelVersion,
            ratio: payload.ratio,
            resolution: payload.resolution,
            duration: payload.duration,
            promptLen: prompt.length,
            hasFirstFrame,
            referenceCount,
        }, null, 0)}`)

        try {
            const created = await createVideoGenerationTask(this.clientConfig, payload, this.signal)
            const taskId = created.id
            if (!taskId) throw new BytePlusModelArkError('ModelArk did not return a task id')

            this.videoPub.pending()

            const task = await pollVideoGenerationTask(this.clientConfig, taskId, {
                pollIntervalMs: BYTEPLUS_VIDEO_POLL_INTERVAL_MS,
                signal: this.signal,
                shouldStop: () => this.shouldStop,
                onKeepalive: () => this.videoPub.generating(),
            })

            if (task.status !== 'succeeded') {
                const detail = task.error?.message ?? `task ${task.status}`
                throw new BytePlusModelArkError(
                    `Seedance task ${taskId} ${task.status}: ${detail}`,
                    { code: task.error?.code },
                )
            }

            const videoUrl = task.content?.video_url
            if (!videoUrl) throw new BytePlusModelArkError('Seedance task succeeded but returned no video_url')

            // Output URLs are cleaned after 24h — download immediately.
            const videoBuffer = await downloadVideo(videoUrl, this.signal)
            if (!videoBuffer || videoBuffer.length === 0) {
                throw new Error('Seedance: empty video bytes after download')
            }

            const durationSeconds = Number(task.duration ?? state.videoDurationSeconds) || 0
            const aspectRatio = task.ratio ?? state.videoAspectRatio ?? ''
            const resolution = task.resolution ?? state.videoResolution ?? ''
            const hasAudio = payload.generate_audio ?? true

            const posterBuffer = await extractPosterFrame(videoBuffer)
            const frameBuffer = await extractRepresentativeFrame(videoBuffer, durationSeconds > 0 ? durationSeconds / 2 : undefined)

            await this.videoPub.complete({
                videoBuffer,
                posterBuffer,
                frameBuffer,
                durationSeconds,
                aspectRatio,
                hasAudio,
                responseId: taskId,
                revisedPrompt: prompt,
                videoModelId: modelVersion,
            })

            info(`[BytePlus:${this.instanceKey}] Seedance complete ${JSON.stringify({
                taskId,
                durationSeconds,
                totalTokens: task.usage?.total_tokens,
            }, null, 0)}`)

            return {
                durationSeconds,
                resolution,
                aspectRatio,
                completionTokens: task.usage?.completion_tokens,
                totalTokens: task.usage?.total_tokens,
                responseId: taskId,
            }
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`[BytePlus:${this.instanceKey}] Seedance failed: ${message}`)
            try { this.videoPub.error(message) } catch { /* publisher may not be initialized */ }
            throw e
        }
    }
}
