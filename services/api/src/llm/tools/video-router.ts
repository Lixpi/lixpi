'use strict'

import { info, warn, err } from '@lixpi/debug-tools'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'
import type { ProseMirrorContentHandler } from '../graph/stream-publisher.ts'
import { getVideoMaxReferenceImages } from '../graph/state.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import { buildVideoModelPrompt } from './video-generation-trace.ts'

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
}

const buildRoutedVideoReferenceImages = (state: ProviderState): string[] | undefined => {
    // Provider-aware cap from the selected video model's metadata (VEO 3,
    // Seedance 9); defaults to 3 so VEO and any model without the field are
    // unchanged. Without this, Seedance would silently receive at most 3 refs.
    const max = getVideoMaxReferenceImages(state.videoModelMetaInfo)
    const referenceImages = addUniqueReferenceImages([], state.videoReferenceImages ?? [], max)
    if (!state.videoSourceForExtension && !state.videoFirstFrameImage) {
        addUniqueReferenceImages(referenceImages, state.featureReferenceImages ?? [], max)
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

        const instanceKey = generationRun?.mediaRunId
            ? `${workspaceId}:${aiChatThreadId}:${generationRun.mediaRunId}`
            : `${workspaceId}:${aiChatThreadId}:video`
        const videoReferenceImages = buildRoutedVideoReferenceImages(state)
        const featureReferenceImages = state.featureReferenceImages ?? []
        const featureUsagePrompt = state.featureUsagePrompt?.trim()
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
            referenceCount,
            referenceImageFingerprints: (videoReferenceImages ?? []).map(fingerprintRef),
            featureReferenceImagesCount: featureReferenceImages.length,
            featureBriefLen: featureUsagePrompt?.length ?? 0,
            hasSourceVideo: !!state.videoSourceForExtension,
            instanceKey,
        }, null, 0)}`)

        if (featureReferenceImages.length > 0 && (state.videoSourceForExtension || state.videoFirstFrameImage)) {
            warn(`[VideoRouter] Feature reference images are represented in the prompt only for ${instanceKey}; VEO extension/first-frame inputs are mutually exclusive with referenceImages.`)
        }

        try {
            const provider = this.registry.createTransient(instanceKey, videoProvider)

            const requestData = {
                messages: [{ role: 'user', content: videoModelPrompt }],
                aiModelMetaInfo: { ...videoMeta, modelVersion: videoModel },
                workspaceId,
                aiChatThreadId,
                enableVideoGeneration: true,
                videoAspectRatio: state.videoAspectRatio,
                videoResolution: state.videoResolution,
                videoDurationSeconds: state.videoDurationSeconds,
                videoFirstFrameImage: state.videoFirstFrameImage,
                videoReferenceImages,
                videoSourceForExtension: state.videoSourceForExtension,
                generationRun,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
                proseMirrorContentHandler: options.onProseMirrorContent,
            }

            const finalState = await provider.process(requestData)
            if (finalState.error) {
                err(`[VideoRouter] Video generation failed: ${finalState.error}`)
                return {
                    error: finalState.error,
                    errorCode: finalState.errorCode,
                    errorType: finalState.errorType,
                }
            }

            const generatedVideos = finalState.generatedVideos ?? []
            if (generatedVideos.length === 0) {
                const message = 'Video generation failed: provider completed without a generated video'
                err(`[VideoRouter] ${message}`)
                return { error: message }
            }

            info(`[VideoRouter] Completed successfully instanceKey=${instanceKey}`)
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
            const message = e?.message ?? String(e)
            err(`[VideoRouter] Video generation failed: ${message}`)
            return { error: message }
        } finally {
            this.registry.remove?.(instanceKey)
        }
    }
}
