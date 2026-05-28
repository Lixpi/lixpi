'use strict'

import { info, warn, err } from '@lixpi/debug-tools'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'

// Routes a generate_video tool call from a text model to the configured
// video-model provider (VEO). Mirrors ImageRouter: it spins up a transient
// provider keyed {ws}:{thread}:video with enableVideoGeneration=true so the
// provider runs the async VEO submit/poll path and skips its own stream
// lifecycle — the parent chat stream owns START_STREAM/END_STREAM.
export class VideoRouter {
    constructor(private readonly registry: ProviderRegistry) {}

    async execute(state: ProviderState): Promise<Partial<ProviderState>> {
        const videoProvider = state.videoProviderName
        const videoModel = state.videoModelVersion
        const videoMeta = state.videoModelMetaInfo ?? ({} as any)
        const prompt = state.generatedVideoPrompt ?? ''
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId

        if (!videoProvider || !videoModel || !prompt) {
            err(
                `[VideoRouter] Missing provider, model, or prompt — provider=${videoProvider} ` +
                `model=${videoModel} promptLen=${prompt.length}`,
            )
            return {}
        }

        const instanceKey = `${workspaceId}:${aiChatThreadId}:video`
        const referenceCount = state.videoReferenceImages?.length ?? 0

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
            promptLen: prompt.length,
            hasFirstFrame: !!state.videoFirstFrameImage,
            referenceCount,
            hasSourceVideo: !!state.videoSourceForExtension,
            instanceKey,
        }, null, 0)}`)

        try {
            const provider = this.registry.createTransient(instanceKey, videoProvider)

            const requestData = {
                messages: [{ role: 'user', content: prompt }],
                aiModelMetaInfo: { ...videoMeta, modelVersion: videoModel },
                workspaceId,
                aiChatThreadId,
                enableVideoGeneration: true,
                videoAspectRatio: state.videoAspectRatio,
                videoResolution: state.videoResolution,
                videoDurationSeconds: state.videoDurationSeconds,
                videoFirstFrameImage: state.videoFirstFrameImage,
                videoReferenceImages: state.videoReferenceImages,
                videoSourceForExtension: state.videoSourceForExtension,
                eventMeta: state.eventMeta,
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
        }
    }
}
