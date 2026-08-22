'use strict'

import * as process from 'node:process'

import { info, warn, err } from '@lixpi/debug-tools'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'
import type { ProseMirrorContentHandler, ProseMirrorSnapshotProvider } from '../graph/stream-publisher.ts'
import {
    createProviderCancellationError,
    isProviderCancellationError,
    throwIfProviderCancelled,
} from '../providers/provider-cancellation.ts'
import { getVideoMaxReferenceImages } from '../graph/state.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import { buildVideoModelPrompt } from './video-generation-trace.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'
import type { MediaGenerationProblem } from '@lixpi/constants'

const fingerprintRef = (url: string): string => {
    if (!url) return '<empty>'
    if (url.startsWith('data:')) {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(url)
        const mime = match?.[1] ?? 'unknown'
        const base64 = match?.[2] ?? ''
        return `data:${mime};base64;len=${base64.length};head=${base64.slice(0, 16)}...`
    }
    if (url.startsWith('nats-obj://')) return url.slice(0, 120)
    if (url.startsWith('https://') || url.startsWith('http://')) return url.slice(0, 120)
    return `${url.slice(0, 60)}...`
}

const addUniqueReferenceImages = (target: string[], source: string[], max: number): string[] => {
    for (const imageUrl of source) {
        if (target.length >= max) break
        if (!target.includes(imageUrl)) target.push(imageUrl)
    }
    return target
}

type VideoRouterOptions = {
    onProseMirrorContent?: ProseMirrorContentHandler
    getProseMirrorSnapshot?: ProseMirrorSnapshotProvider
    signal?: AbortSignal
}

const buildRoutedVideoReferenceImages = (state: ProviderState): string[] | undefined => {
    // Provider-aware cap from the selected video model's metadata (VEO 3,
    // Seedance 9); defaults to 3 so VEO and any model without the field are
    // unchanged. Without this, Seedance would silently receive at most 3 refs.
    const max = getVideoMaxReferenceImages(state.videoModelMetaInfo)
    const referenceImages = addUniqueReferenceImages([], state.videoReferenceImages ?? [], max)
    if (!state.videoSourceForExtension && !state.videoFirstFrameImage) {
        addUniqueReferenceImages(referenceImages, state.capabilityReferenceImages ?? [], max)
    }
    return referenceImages.length > 0 ? referenceImages : undefined
}

// Routes a generate_video tool call from a text model to the configured
// video-model provider (VEO). Mirrors ImageRouter: it spins up a transient
// provider keyed {ws}:{thread}:video with enableVideoGeneration=true so the
// provider runs the async VEO submit/poll path and skips its own stream
// lifecycle — the parent chat stream owns START_STREAM/END_STREAM.
export class VideoRouter {
    private readonly mediaGenerationRunPlanner = new MediaGenerationRunPlanner()

    constructor(private readonly registry: ProviderRegistry) {}

    async execute(state: ProviderState, options: VideoRouterOptions = {}): Promise<Partial<ProviderState>> {
        const videoProvider = state.videoProviderName
        const videoModel = state.videoModelVersion
        const videoMeta = state.videoModelMetaInfo ?? ({} as any)
        const prompt = state.generatedVideoPrompt ?? ''
        const videoModelPrompt = buildVideoModelPrompt(state)
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const mediaModelId = videoProvider && videoModel
            ? this.mediaGenerationRunPlanner.buildMediaModelId(videoProvider, videoMeta.model, videoModel)
            : undefined
        const generationRun = mediaModelId
            ? this.mediaGenerationRunPlanner.buildProviderMediaRun({
                generationRun: state.generationRun,
                mediaModelId,
                mediaType: 'video',
                lineageAssignments: state.mediaBranchLineagePlan?.runAssignments,
            })
            : state.generationRun

        if (!videoProvider || !videoModel || !prompt) {
            err(
                `[VideoRouter] Missing provider, model, or prompt — provider=${videoProvider} ` +
                `model=${videoModel} promptLen=${prompt.length}`,
            )
            return {}
        }

        const requestService = new MediaGenerationRequestService()
        const recordRunStatus = async (
            status: 'running' | 'completed' | 'failed',
            error?: unknown,
        ): Promise<MediaGenerationProblem | undefined> => {
            if (!state.durableGenerationRequestId || !generationRun?.mediaModelId) return
            const problem = error === undefined ? undefined : this.registry.getDefinition(videoProvider).normalizeProblem(error, {
                generationRequestId: state.durableGenerationRequestId,
                modelId: generationRun.mediaModelId,
                stage: 'submit',
            })
            if (problem) warn(`[MediaGenerationProblem] ${JSON.stringify({
                supportCode: problem.supportCode,
                category: problem.category,
                stage: problem.stage,
                provider: problem.provider,
                modelId: problem.modelId,
                providerCode: problem.providerCode,
                providerReason: problem.providerReason,
            })}`)
            await requestService.recordRunStatus({
                generationRequestId: state.durableGenerationRequestId,
                workspaceId,
                mediaModelId: generationRun.mediaModelId,
                reasoningIndex: generationRun.reasoningIndex,
                ...(generationRun.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
                status,
                ...(problem ? { problem } : {}),
            })
            return problem
        }
        const presentFailure = (
            error: string,
            errorCode: string | undefined,
            errorType: string | undefined,
            problem: MediaGenerationProblem | undefined,
        ): Partial<ProviderState> => state.durableGenerationRequestId && problem ? {
            error: problem.detail,
            errorCode: problem.providerCode ?? problem.category,
            errorType: problem.category,
        } : {
            error,
            ...(errorCode ? { errorCode } : {}),
            ...(errorType ? { errorType } : {}),
        }
        if (videoProvider === 'BytePlus' && state.durableGenerationRequestId && generationRun?.mediaModelId) {
            const accountScope = process.env.BYTEPLUS_ACCOUNT_SCOPE
            const now = Date.now()
            const requiredAssetIds = (state.providerSafeMediaIntent?.bindings ?? [])
                .filter(binding => ['self', 'authorized-real-person'].includes(binding.subjectIdentity.classification))
                .filter(binding => !binding.subjectIdentity.providerVerifications.some(verification =>
                    verification.provider === 'BytePlus'
                    && verification.providerAccountScope === accountScope
                    && verification.status === 'valid'
                    && (!verification.expiresAt || verification.expiresAt > now)))
                .map(binding => binding.assetId)
            if (requiredAssetIds.length > 0) {
                await requestService.requireProviderVerification({
                    generationRequestId: state.durableGenerationRequestId,
                    workspaceId,
                    mediaModelId: generationRun.mediaModelId,
                    reasoningIndex: generationRun.reasoningIndex,
                    assetIds: requiredAssetIds,
                })
                return {
                    error: 'PROVIDER_VERIFICATION_REQUIRED',
                    errorCode: 'PROVIDER_VERIFICATION_REQUIRED',
                    errorType: 'action-required',
                }
            }
        }

        const instanceKey = generationRun?.mediaRunId
            ? `${workspaceId}:${aiChatThreadId}:${generationRun.mediaRunId}`
            : `${workspaceId}:${aiChatThreadId}:video`
        const videoReferenceImages = buildRoutedVideoReferenceImages(state)
        const capabilityReferenceImages = state.capabilityReferenceImages ?? []
        const capabilityUsagePrompt = state.capabilityUsagePrompt?.trim()
        const referenceCount = videoReferenceImages?.length ?? 0

        info(`[VideoRouter] invocation chain ${JSON.stringify({
            workspaceId,
            aiChatThreadId,
            chatProvider: state.provider,
            chatModel: state.modelVersion,
            videoProvider,
            videoModel,
            aspectRatio: state.videoAspectRatio,
            resolution: state.videoResolution,
            durationSeconds: state.videoDurationSeconds,
            originalPromptLen: prompt.length,
            routedPromptLen: videoModelPrompt.length,
            hasFirstFrame: !!state.videoFirstFrameImage,
            firstFrameFingerprint: state.videoFirstFrameImage
                ? fingerprintRef(state.videoFirstFrameImage)
                : null,
            referenceCount,
            referenceImageFingerprints: (videoReferenceImages ?? []).map(fingerprintRef),
            capabilityReferenceImagesCount: capabilityReferenceImages.length,
            capabilityBriefLen: capabilityUsagePrompt?.length ?? 0,
            hasSourceVideo: !!state.videoSourceForExtension,
            instanceKey,
        }, null, 0)}`)

        if (capabilityReferenceImages.length > 0 && (state.videoSourceForExtension || state.videoFirstFrameImage)) {
            warn(`[VideoRouter] Capability reference images are represented in the prompt only for ${instanceKey}; VEO extension/first-frame inputs are mutually exclusive with referenceImages.`)
        }

        try {
            await recordRunStatus('running')
            const provider = this.registry.createTransient(instanceKey, videoProvider)

            const requestData = {
                messages: [{ role: 'user', content: videoModelPrompt }],
                aiModelMetaInfo: { ...videoMeta, modelVersion: videoModel },
                organizationId: state.eventMeta.organizationId,
                workspaceId,
                aiChatThreadId,
                enableVideoGeneration: true,
                videoAspectRatio: state.videoAspectRatio,
                videoResolution: state.videoResolution,
                videoDurationSeconds: state.videoDurationSeconds,
                videoGenerationConfig: state.videoGenerationConfig,
                videoFirstFrameImage: state.videoFirstFrameImage,
                videoReferenceImages,
                videoSourceForExtension: state.videoSourceForExtension,
                videoSourceDurationSeconds: state.videoSourceDurationSeconds,
                generationRun,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
                proseMirrorContentHandler: options.onProseMirrorContent,
                proseMirrorSnapshotProvider: options.getProseMirrorSnapshot,
                abortSignal: options.signal,
                durableGenerationRequestId: state.durableGenerationRequestId,
                providerSafeMediaIntent: state.providerSafeMediaIntent,
                mediaReferenceBindings: state.mediaReferenceBindings,
            }

            const finalState = await provider.process(requestData)
            throwIfProviderCancelled(finalState, options.signal)
            if (finalState.error) {
                err(`[VideoRouter] Video generation failed: ${finalState.error}`)
                const problem = await recordRunStatus('failed', { message: finalState.error, code: finalState.errorCode })
                return presentFailure(finalState.error, finalState.errorCode, finalState.errorType, problem)
            }

            const generatedVideos = finalState.generatedVideos ?? []
            if (generatedVideos.length === 0) {
                const message = 'Video generation failed: provider completed without a generated video'
                err(`[VideoRouter] ${message}`)
                const problem = await recordRunStatus('failed', { message, code: 'PROVIDER_OUTPUT_MISSING' })
                return presentFailure(message, undefined, undefined, problem)
            }

            info(`[VideoRouter] Completed successfully instanceKey=${instanceKey}`)
            await recordRunStatus('completed')
            return {
                ...finalState,
                generatedVideos,
                videoUsage: finalState.videoUsage ?? {
                    durationSeconds: state.videoDurationSeconds ?? 0,
                    resolution: state.videoResolution ?? '',
                    aspectRatio: state.videoAspectRatio ?? '',
                },
            }
        } catch (e: any) {
            if (options.signal?.aborted) throw createProviderCancellationError(options.signal)
            if (isProviderCancellationError(e)) throw e
            const message = e?.message ?? String(e)
            err(`[VideoRouter] Video generation failed: ${message}`)
            const problem = await recordRunStatus('failed', e).catch(persistenceError => {
                err(`[VideoRouter] Failed to persist durable media problem: ${(persistenceError as Error).message}`)
                return state.durableGenerationRequestId
                    ? this.registry.getDefinition(videoProvider).normalizeProblem(e, {
                        generationRequestId: state.durableGenerationRequestId,
                        modelId: generationRun?.mediaModelId,
                        stage: 'submit',
                    })
                    : undefined
            })
            return presentFailure(message, undefined, undefined, problem)
        } finally {
            this.registry.remove?.(instanceKey)
        }
    }
}
