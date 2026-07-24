'use strict'

import { info, warn, err } from '@lixpi/debug-tools'

import type { ProviderRegistry } from '../providers/provider-registry.ts'
import type { ProviderState } from '../graph/state.ts'
import type { ProseMirrorContentHandler, ProseMirrorSnapshotProvider } from '../graph/stream-publisher.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import {
    buildImageModelPrompt,
    normalizeImageSize,
} from './image-generation-trace.ts'
import { buildImageGenerationReferences } from '../image-generation-references.ts'

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

type ImageRouterOptions = {
    onProseMirrorContent?: ProseMirrorContentHandler
    getProseMirrorSnapshot?: ProseMirrorSnapshotProvider
    signal?: AbortSignal
    captureOnly?: boolean
}

// Routes a generate_image tool call from a text model to the configured image-model provider.
// Spins up a transient provider keyed {ws}:{thread}:image with enableImageGeneration=true
// so it skips its own START_STREAM/END_STREAM — the parent text stream owns the lifecycle.
export class ImageRouter {
    private readonly mediaGenerationRunPlanner = new MediaGenerationRunPlanner()

    constructor(private readonly registry: ProviderRegistry) {}

    async execute(state: ProviderState, options: ImageRouterOptions = {}): Promise<Partial<ProviderState>> {
        const imageProvider = state.imageProviderName
        const imageModel = state.imageModelVersion
        const imageMeta = state.imageModelMetaInfo ?? ({} as any)
        const prompt = state.generatedImagePrompt ?? ''
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const imageSize = normalizeImageSize(imageProvider, state.imageSize)
        const mediaModelId = imageProvider && imageModel
            ? this.mediaGenerationRunPlanner.buildMediaModelId(imageProvider, imageMeta.model, imageModel)
            : undefined
        const generationRun = mediaModelId
            ? this.mediaGenerationRunPlanner.buildProviderMediaRun({
                generationRun: state.generationRun,
                mediaModelId,
                mediaType: 'image',
                lineageAssignments: state.mediaBranchLineagePlan?.runAssignments,
            })
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
        const capabilityReferenceImages = state.capabilityReferenceImages ?? []
        const sourceReferenceImages = state.referenceImages ?? []
        const referenceImages = buildImageGenerationReferences({
            sourceReferenceImages,
            capabilityReferenceImages,
            capabilityUsageMode: state.capabilityUsageMode,
        })
        const capabilityUsagePrompt = state.capabilityUsagePrompt?.trim()
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
            referenceImages: referenceImages.map(reference => ({
                role: reference.role,
                fileName: reference.fileName,
                fingerprint: fingerprintRef(reference.url),
            })),
            capabilityReferenceImagesCount: capabilityReferenceImages.length,
            capabilityBriefLen: capabilityUsagePrompt?.length ?? 0,
            instanceKey,
        }, null, 0)}`)

        if (referenceImages.length === 0) {
            warn(`[ImageRouter] No reference images attached for ${instanceKey}. If you expected the model to see workspace reference images, check the upstream extractReferenceImages() / messages payload.`)
        }

        try {
            if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
            const provider = this.registry.createTransient(instanceKey, imageProvider)
            const stopForAbort = (): void => { void this.registry.stop(instanceKey) }
            options.signal?.addEventListener('abort', stopForAbort, { once: true })

            // Build a fresh request with the provider-neutral prompt and typed
            // references. BaseProvider resolves every reference exactly once;
            // each vendor adapter only serializes those resolved bytes.
            // enableImageGeneration=true so the provider takes the image path
            // and skips its own stream lifecycle.
            const messages: ProviderState['messages'] = [{ role: 'user', content: imageModelPrompt }]

            const requestData = {
                messages,
                aiModelMetaInfo: { ...imageMeta, modelVersion: imageModel },
                organizationId: state.eventMeta.organizationId,
                workspaceId,
                aiChatThreadId,
                enableImageGeneration: true,
                imageSize,
                imageGenerationReferences: referenceImages,
                generationRun,
                eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
                proseMirrorContentHandler: options.onProseMirrorContent,
                proseMirrorSnapshotProvider: options.getProseMirrorSnapshot,
                captureOnlyImageGeneration: options.captureOnly ?? false,
            }

            const finalState = await provider.process(requestData).finally(() => {
                options.signal?.removeEventListener('abort', stopForAbort)
            })
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
}
