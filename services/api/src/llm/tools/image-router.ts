'use strict'

import { info, warn, err } from '@lixpi/debug-tools'
import type { AiModelId, MediaGenerationRunMeta, MediaRunLineageAssignment } from '@lixpi/constants'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'
import {
    buildImageModelPrompt,
    normalizeImageSize,
} from './image-generation-trace.ts'

// Short fingerprint for a reference image URL — enough to spot duplicates
// or wrong-image issues in logs without dumping base64.
const fingerprintRef = (url: string): string => {
    if (!url) return '<empty>'
    if (url.startsWith('data:')) {
        const m = /^data:([^;]+);base64,(.+)$/s.exec(url)
        const mime = m?.[1] ?? 'unknown'
        const b64 = m?.[2] ?? ''
        return `data:${mime};base64;len=${b64.length};head=${b64.slice(0, 16)}…`
    }
    if (url.startsWith('nats-obj://')) {
        const path = url.slice('nats-obj://'.length)
        return `nats-obj://${path.slice(0, 80)}`
    }
    if (url.startsWith('https://') || url.startsWith('http://')) return url.slice(0, 120)
    return `${url.slice(0, 60)}…`
}

// Routes a generate_image tool call from a text model to the configured image-model provider.
// Spins up a transient provider keyed {ws}:{thread}:image with enableImageGeneration=true
// so it skips its own START_STREAM/END_STREAM — the parent text stream owns the lifecycle.
export class ImageRouter {
    constructor(private readonly registry: ProviderRegistry) {}

    async execute(state: ProviderState): Promise<Partial<ProviderState>> {
        const imageProvider = state.imageProviderName
        const imageModel = state.imageModelVersion
        const imageMeta = state.imageModelMetaInfo ?? ({} as any)
        const prompt = state.generatedImagePrompt ?? ''
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const imageSize = normalizeImageSize(imageProvider, state.imageSize)
        const mediaModelId = imageProvider && imageModel
            ? this.buildMediaModelId(imageProvider, imageMeta.model, imageModel)
            : undefined
        const generationRun = mediaModelId
            ? this.buildImageGenerationRun(state.generationRun, mediaModelId)
            : state.generationRun

        if (!imageProvider || !imageModel || !prompt) {
            err(
                `[ImageRouter] Missing provider, model, or prompt — provider=${imageProvider} ` +
                `model=${imageModel} promptLen=${prompt.length}`,
            )
            return {}
        }

        const instanceKey = generationRun?.mediaRunId
            ? `${workspaceId}:${aiChatThreadId}:${generationRun.mediaRunId}`
            : `${workspaceId}:${aiChatThreadId}:image`
        const referenceImages = state.referenceImages ?? []
        const featureReferenceImages = state.featureReferenceImages ?? []
        const hasFeatureReferences = featureReferenceImages.length > 0
        const featureUsagePrompt = state.featureUsagePrompt?.trim()
        const imageModelPrompt = buildImageModelPrompt(state)

        // Structured log of the FULL invocation chain so we can verify exactly
        // which model is being invoked, at what quality, with which references.
        // Audited fields: chat provider/model that emitted the generate_image
        // tool call, the resolved image provider+model+size, the user-prompt vs
        // routed-prompt lengths, the reference fingerprints (no base64 dump).
        info(`[ImageRouter] invocation chain ${JSON.stringify({
            workspaceId,
            aiChatThreadId,
            chatProvider: state.provider,
            chatModel: state.modelVersion,
            imageProvider,
            imageModel,
            imageSize,
            originalPromptLen: prompt.length,
            routedPromptLen: imageModelPrompt.length,
            referenceImagesCount: referenceImages.length,
            referenceImageFingerprints: referenceImages.map(fingerprintRef),
            featureReferenceImagesCount: featureReferenceImages.length,
            featureBriefLen: featureUsagePrompt?.length ?? 0,
            instanceKey,
        }, null, 0)}`)

        if (referenceImages.length === 0) {
            warn(`[ImageRouter] No reference images attached for ${instanceKey}. If you expected the model to see workspace reference images, check the upstream extractReferenceImages() / messages payload.`)
        }

        try {
            const provider = this.registry.createTransient(instanceKey, imageProvider)

            // Build a fresh request: just the prompt + reference images, with
            // enableImageGeneration=true so the provider takes the image path
            // and skips its own stream lifecycle.
            const messages: ProviderState['messages'] = referenceImages.length > 0
                ? [{
                    role: 'user',
                    content: [
                        { type: 'input_text', text: imageModelPrompt },
                        ...referenceImages.map(url => ({
                            type: 'input_image',
                            image_url: url,
                            detail: 'high',
                        })),
                    ],
                }]
                : [{ role: 'user', content: imageModelPrompt }]

            const requestData = {
                messages,
                aiModelMetaInfo: { ...imageMeta, modelVersion: imageModel },
                workspaceId,
                aiChatThreadId,
                enableImageGeneration: true,
                imageSize,
                generationRun,
                eventMeta: this.buildEventMeta(state.eventMeta, generationRun),
            }

            const finalState = await provider.process(requestData)
            if (finalState.error) {
                err(`[ImageRouter] Image generation failed: ${finalState.error}`)
                return {
                    error: finalState.error,
                    errorCode: finalState.errorCode,
                    errorType: finalState.errorType,
                }
            }

            const generatedImages = finalState.generatedImages ?? []
            if (generatedImages.length === 0) {
                const message = 'Image generation failed: provider completed without a generated image'
                err(`[ImageRouter] ${message}`)
                return { error: message }
            }

            info(`[ImageRouter] Completed successfully instanceKey=${instanceKey}`)
            return {
                ...finalState,
                generatedImages,
                imageUsage: finalState.imageUsage ?? (generatedImages.length > 0
                    ? { generatedCount: generatedImages.length, size: imageSize, quality: 'high' }
                    : undefined),
            }
        } catch (e: any) {
            const message = e?.message ?? String(e)
            err(`[ImageRouter] Image generation failed: ${message}`)
            return { error: message }
        } finally {
            this.registry.remove?.(instanceKey)
        }
    }

    private buildMediaModelId(provider: string, model: unknown, fallbackModel: string): AiModelId {
        const modelName = typeof model === 'string' && model.trim().length > 0 ? model.trim() : fallbackModel
        return `${provider}:${modelName}` as AiModelId
    }

    private buildImageGenerationRun(
        generationRun: MediaGenerationRunMeta | undefined,
        mediaModelId: AiModelId,
    ): MediaGenerationRunMeta | undefined {
        if (!generationRun) return undefined
        const mediaRunId = generationRun.mediaRunId ?? `${generationRun.reasoningRunId}:image:0`
        const lineageAssignment = this.buildMediaRunLineageAssignment(
            generationRun.lineageAssignment,
            mediaRunId,
            mediaModelId,
        )
        return {
            ...generationRun,
            mediaRunId,
            mediaModelId,
            mediaType: 'image',
            mediaIndex: generationRun.mediaIndex ?? 0,
            variantIndex: generationRun.variantIndex ?? 0,
            ...(lineageAssignment ? { lineageAssignment } : {}),
        }
    }

    private buildMediaRunLineageAssignment(
        assignment: MediaRunLineageAssignment | undefined,
        mediaRunId: string,
        mediaModelId: AiModelId,
    ): MediaRunLineageAssignment | undefined {
        if (!assignment) return undefined
        return {
            ...assignment,
            mediaRunId,
            mediaModelId,
            mediaType: 'image',
        }
    }

    private buildEventMeta(
        eventMeta: ProviderState['eventMeta'],
        generationRun: MediaGenerationRunMeta | undefined,
    ): ProviderState['eventMeta'] {
        if (!generationRun) return eventMeta
        return {
            ...eventMeta,
            generationRequestId: generationRun.generationRequestId,
            reasoningRunId: generationRun.reasoningRunId,
            mediaRunId: generationRun.mediaRunId,
            reasoningModelId: generationRun.reasoningModelId,
            mediaModelId: generationRun.mediaModelId,
            mediaType: generationRun.mediaType,
            reasoningIndex: generationRun.reasoningIndex,
            mediaIndex: generationRun.mediaIndex,
            variantIndex: generationRun.variantIndex,
        }
    }
}
