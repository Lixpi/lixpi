'use strict'

import * as process from 'process'

import {
    info,
    warn,
    err,
} from '@lixpi/debug-tools'
import type { ProviderName } from '@lixpi/constants'

import {
    BaseProvider,
    type BaseProviderDeps,
} from './base-provider.ts'
import type {
    ProviderState,
    VideoUsage,
} from '../graph/state.ts'
import {
    BYTEPLUS_ARK_BASE_URL,
    BYTEPLUS_VIDEO_POLL_INTERVAL_MS,
} from '../config.ts'
import {
    BytePlusModelArkError,
    buildSeedanceContent,
    createVideoGenerationTask,
    downloadLastFrame,
    downloadVideo,
    pollVideoGenerationTask,
    retrieveVideoGenerationTask,
    type BytePlusClientConfig,
    type CreateVideoGenerationTaskPayload,
} from './byteplus-video-types.ts'
import { readReportedSeed } from './media-generation-seed.ts'

// First-party video provider for BytePlus ModelArk's official Seedance 2.x API.
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

    // No transportFaultNames override: ModelArk is reached with bare fetch, so
    // socket failures arrive as `TypeError: fetch failed` with the real code on
    // `cause`, which the shared layer covers.

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const modelVersion = state.modelVersion
        const enableVideoGeneration = state.enableVideoGeneration ?? false
        const isSeedanceVideo = enableVideoGeneration && /seedance/i.test(modelVersion)

        if (!isSeedanceVideo) {
            // Video-only provider: there is no text/image streaming path. The
            // router only ever dispatches Seedance video here, so anything else
            // is a misconfiguration worth surfacing loudly.
            throw new Error(
                `BytePlus provider supports Seedance video generation only `
                    + `(model="${modelVersion}", enableVideoGeneration=${enableVideoGeneration}).`,
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
        const providerPrompt = prompt.replace(/\bREFERENCE_(\d+)\b/gu, 'image $1')
        const accountScope = process.env.BYTEPLUS_ACCOUNT_SCOPE
        const now = Date.now()
        const verifiedAssetUris = (state.providerSafeMediaIntent?.bindings ?? []).flatMap(binding => {
            if (
                binding.subjectIdentity.classification !== 'self'
                && binding.subjectIdentity.classification !== 'authorized-real-person'
            ) return []
            const verification = binding.subjectIdentity.providerVerifications.find(candidate => (
                candidate.provider === 'BytePlus'
                && candidate.providerAccountScope === accountScope
                && candidate.status === 'valid'
                && (!candidate.expiresAt || candidate.expiresAt > now)
            ))
            if (!verification) throw new Error(`BYTEPLUS_PROVIDER_ASSET_HANDLE_REQUIRED:${binding.assetId}`)
            return [`asset://${verification.subjectHandle}`]
        })
        const existingFrames = [state.videoFirstFrameImage, ...(state.videoReferenceImages ?? [])]
            .filter((value): value is string => Boolean(value))
        const providerFrames = verifiedAssetUris.length > 0
            ? [...verifiedAssetUris, ...existingFrames.slice(verifiedAssetUris.length)]
            : existingFrames

        // References reaching the provider are already capped to the provider-aware
        // budget upstream by the VideoRouter (which holds the full model metadata).
        const content = buildSeedanceContent(providerPrompt, {
            videoSourceForExtension: state.videoSourceForExtension,
            videoFirstFrameImage: providerFrames[0],
            videoReferenceImages: providerFrames.slice(1, 2),
        })
        const duration = Number(state.videoDurationSeconds) || undefined
        const generationConfig = state.videoGenerationConfig ?? {}
        const hasFirstFrame = content.some(item => item.type === 'image_url' && item.role === 'first_frame')
        const hasLastFrame = content.some(item => item.type === 'image_url' && item.role === 'last_frame')
        const isSeedance25 = modelVersion === 'dreamina-seedance-2-5-260628'
        const outputFormat = isSeedance25
                && (generationConfig.outputFormat === 'mp4' || generationConfig.outputFormat === 'mov')
            ? generationConfig.outputFormat
            : undefined
        const ratio = isSeedance25 && (hasFirstFrame || hasLastFrame)
            ? 'adaptive'
            : state.videoAspectRatio

        const payload: CreateVideoGenerationTaskPayload = {
            model: modelVersion,
            content,
            ...(state.videoResolution ? { resolution: state.videoResolution } : {}),
            ...(ratio ? { ratio } : {}),
            ...(duration ? { duration } : {}),
            generate_audio: generationConfig.generateAudio !== 'false',
            watermark: generationConfig.watermark === 'true',
            return_last_frame: generationConfig.returnLastFrame === 'true',
            ...(outputFormat ? { output_format: outputFormat } : {}),
        }

        info(`[BytePlus:${this.instanceKey}] Seedance submit ${
            JSON.stringify(
                {
                    model: modelVersion,
                    ratio: payload.ratio,
                    resolution: payload.resolution,
                    duration: payload.duration,
                    generateAudio: payload.generate_audio,
                    outputFormat: payload.output_format,
                    promptLen: providerPrompt.length,
                    hasFirstFrame,
                    hasLastFrame,
                },
                null,
                0,
            )
        }`)

        try {
            const created = await this.retryTransport(
                'video-create',
                async () => await createVideoGenerationTask(this.clientConfig, payload, this.signal),
            )
            const taskId = created.id
            if (!taskId) throw new BytePlusModelArkError('ModelArk did not return a task id')

            await this.videoPub.pending()

            const task = await pollVideoGenerationTask(this.clientConfig, taskId, {
                pollIntervalMs: BYTEPLUS_VIDEO_POLL_INTERVAL_MS,
                signal: this.signal,
                shouldStop: () => this.shouldStop,
                onKeepalive: () => this.videoPub.generating(),
                // A blip while polling must not discard a video ModelArk is
                // already rendering — each retrieve is idempotent.
                retrieve: async (config, id, signal) =>
                    await this.retryTransport(
                        'video-poll',
                        async () => await retrieveVideoGenerationTask(config, id, signal),
                    ),
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
            const videoBuffer = await this.retryTransport(
                'video-download',
                async () => await downloadVideo(videoUrl, this.signal),
            )
            if (!videoBuffer || videoBuffer.length === 0) {
                throw new Error('Seedance: empty video bytes after download')
            }
            let frameBuffer: Buffer | null = null
            if (payload.return_last_frame) {
                const lastFrameUrl = task.content?.last_frame_url
                if (lastFrameUrl) {
                    try {
                        frameBuffer = await this.retryTransport(
                            'last-frame-download',
                            async () => await downloadLastFrame(lastFrameUrl, this.signal),
                        )
                    } catch (error) {
                        warn(`[BytePlus:${this.instanceKey}] Seedance last-frame download failed: ${(error as Error).message}`)
                    }
                } else {
                    warn(`[BytePlus:${this.instanceKey}] Seedance returned no last_frame_url for return_last_frame=true`)
                }
            }

            const durationSeconds = Number(task.duration ?? state.videoDurationSeconds) || 0
            const aspectRatio = task.ratio ?? state.videoAspectRatio ?? ''
            const resolution = task.resolution ?? state.videoResolution ?? ''
            const hasAudio = payload.generate_audio ?? true
            const generationSeed = readReportedSeed(task.seed)
            const containerFormat = task.output_format === 'mp4' || task.output_format === 'mov'
                ? task.output_format
                : payload.output_format ?? 'mp4'

            await this.videoPub.complete({
                videoBuffer,
                posterBuffer: null,
                frameBuffer,
                durationSeconds,
                aspectRatio,
                hasAudio,
                responseId: taskId,
                revisedPrompt: providerPrompt,
                videoModelId: modelVersion,
                ...(generationSeed !== undefined ? { generationSeed } : {}),
                containerFormat,
            })

            info(`[BytePlus:${this.instanceKey}] Seedance complete ${
                JSON.stringify(
                    {
                        taskId,
                        durationSeconds,
                        generationSeed,
                        totalTokens: task.usage?.total_tokens,
                    },
                    null,
                    0,
                )
            }`)

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
            try {
                this.videoPub.error(message)
            } catch { /* publisher may not be initialized */ }
            throw e
        }
    }
}
