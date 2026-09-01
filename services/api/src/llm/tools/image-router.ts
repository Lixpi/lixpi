import {
    info,
    warn,
    err,
} from '@lixpi/debug-tools'
import type NatsService from '@lixpi/nats-service'
import {
    type CapabilityMediaExecutionContext,
    type CapabilityMediaStrategyRegistry,
} from '@lixpi/capability-system/backend'
import {
    type CapabilityJsonValue,
    type MediaGenerationProblem,
} from '@lixpi/constants'

import {
    type ProviderRegistry,
} from '../providers/provider-registry.ts'
import {
    type ProviderState,
} from '../graph/state.ts'
import {
    type ProseMirrorContentHandler,
    type ProseMirrorSnapshotProvider,
} from '../graph/stream-publisher.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import {
    buildImageModelPrompt,
    getImageSourceReferenceImages,
    normalizeImageSize,
} from './image-generation-trace.ts'
import {
    buildImageGenerationReferences,
    type ImageGenerationReference,
} from '../image-generation-references.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'
import { settleGeneratedAssetComposition } from '../../services/generated-asset-storage.ts'
import { ImagePublisher } from '../graph/image-publisher.ts'
import {
    createProviderCancellationError,
    isProviderCancellationError,
    throwIfProviderCancelled,
} from '../providers/provider-cancellation.ts'

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
    onCapabilityMediaTrace?: (trace: CapabilityJsonValue) => void
    signal?: AbortSignal
    captureOnly?: boolean
}

// Routes a generate_image tool call from a text model to the configured image-model provider.
// Spins up a transient provider keyed {ws}:{thread}:image with enableImageGeneration=true
// so it skips its own START_STREAM/END_STREAM — the parent text stream owns the lifecycle.
export class ImageRouter {
    private readonly mediaGenerationRunPlanner = new MediaGenerationRunPlanner()

    constructor(
        private readonly registry: ProviderRegistry,
        private readonly capabilityMediaStrategies?: CapabilityMediaStrategyRegistry,
        private readonly natsService?: NatsService,
    ) {}

    async execute(state: ProviderState, options: ImageRouterOptions = {}): Promise<Partial<ProviderState>> {
        const imageProvider = state.imageProviderName
        const imageModel = state.imageModelVersion
        const imageMeta = state.imageModelMetaInfo ?? ({} as any)
        const prompt = state.generatedImagePrompt
            ?? (state.capabilityMediaExecutionPlan ? state.providerSafeMediaIntent?.safePrompt : undefined)
            ?? ''
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

        if (!imageProvider || !imageModel || (!prompt && !state.capabilityMediaExecutionPlan)) {
            err(
                `[ImageRouter] Missing provider, model, or prompt — provider=${imageProvider} `
                    + `model=${imageModel} promptLen=${prompt.length}`,
            )
            return {}
        }

        const requestService = new MediaGenerationRequestService()
        const recordRunStatus = async (
            status: 'running' | 'completed' | 'failed',
            error?: unknown,
        ): Promise<MediaGenerationProblem | undefined> => {
            if (!state.durableGenerationRequestId || !generationRun?.mediaModelId) return
            const problem = error === undefined ? undefined : this.registry.getDefinition(imageProvider).normalizeProblem(error, {
                generationRequestId: state.durableGenerationRequestId,
                modelId: generationRun.mediaModelId,
                stage: 'submit',
            })
            if (problem) {
                warn(`[MediaGenerationProblem] ${
                    JSON.stringify({
                        supportCode: problem.supportCode,
                        category: problem.category,
                        stage: problem.stage,
                        provider: problem.provider,
                        modelId: problem.modelId,
                        providerCode: problem.providerCode,
                        providerReason: problem.providerReason,
                        moderationStage: problem.moderationStage,
                        moderationCategories: problem.moderationCategories,
                    })
                }`)
            }
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
        ): Partial<ProviderState> =>
            state.durableGenerationRequestId && problem
                ? {
                    error: problem.detail,
                    errorCode: problem.providerCode ?? problem.category,
                    errorType: problem.category,
                }
                : {
                    error,
                    ...(errorCode ? { errorCode } : {}),
                    ...(errorType ? { errorType } : {}),
                }

        const instanceKey = generationRun?.mediaRunId
            ? `${workspaceId}:${aiChatThreadId}:${generationRun.mediaRunId}`
            : `${workspaceId}:${aiChatThreadId}:image`
        if (state.capabilityMediaExecutionPlan) {
            if (!this.capabilityMediaStrategies) throw new Error('CAPABILITY_MEDIA_STRATEGY_REGISTRY_REQUIRED')
            const strategy = this.capabilityMediaStrategies.get(state.capabilityMediaExecutionPlan)
            try {
                await recordRunStatus('running')
                const context = buildCapabilityMediaExecutionContext(state, generationRun, prompt)
                const imagePublisher = this.natsService && generationRun
                    ? new ImagePublisher(
                        this.natsService,
                        context.organizationId,
                        workspaceId,
                        aiChatThreadId,
                        imageProvider,
                        generationRun,
                        undefined,
                        options.onProseMirrorContent,
                        undefined,
                        options.getProseMirrorSnapshot,
                        options.captureOnly ?? false,
                    )
                    : undefined
                const result = await strategy.execute(context, state.capabilityMediaExecutionPlan, {
                    ...options,
                    reportProgress: async progress => {
                        if (options.signal?.aborted) return
                        if (!state.durableGenerationRequestId || !generationRun?.mediaModelId) return
                        try {
                            await requestService.recordRunProgress({
                                generationRequestId: state.durableGenerationRequestId,
                                workspaceId,
                                mediaModelId: generationRun.mediaModelId,
                                reasoningIndex: generationRun.reasoningIndex,
                                ...(generationRun.mediaRunId ? { mediaRunId: generationRun.mediaRunId } : {}),
                                progress,
                            })
                        } catch (error) {
                            warn(`[ImageRouter] Unable to persist capability progress: ${(error as Error).message}`)
                        }
                    },
                    publishImagePartial: async (imageBase64, partialIndex) => {
                        if (options.signal?.aborted) return
                        if (!imagePublisher) return
                        try {
                            await imagePublisher.partial(imageBase64, partialIndex)
                        } catch (error) {
                            warn(`[ImageRouter] Unable to publish capability partial: ${(error as Error).message}`)
                        }
                    },
                })
                if (options.signal?.aborted) throw createProviderCancellationError(options.signal)
                if (result.error) {
                    const problem = await recordRunStatus('failed', { message: result.error, code: result.errorCode })
                    return presentFailure(result.error, result.errorCode, result.errorType, problem)
                }
                const finalImage = result.generatedImages?.[0]
                if (!finalImage) throw new Error('CAPABILITY_IMAGE_PROVIDER_OUTPUT_MISSING')
                if (result.capabilityMediaTrace) {
                    try {
                        options.onCapabilityMediaTrace?.(result.capabilityMediaTrace)
                    } catch (error) {
                        warn(`[ImageRouter] Unable to publish capability review trace: ${(error as Error).message}`)
                    }
                }
                if (result.mediaComposition) {
                    if (!generationRun?.lineageAssignment?.assetId) {
                        throw new Error('CAPABILITY_MEDIA_COMPOSITION_ASSET_REQUIRED')
                    }
                    await settleGeneratedAssetComposition({
                        generationRun,
                        composition: result.mediaComposition,
                    })
                }
                if (imagePublisher) {
                    await imagePublisher.complete({
                        imageBase64: finalImage,
                        responseId: `capability:${state.capabilityMediaExecutionPlan.capabilityRunId}`,
                        revisedPrompt: context.sharedState.authoritativePrompt,
                        imageModelId: generationRun?.mediaModelId ?? mediaModelId ?? imageModel,
                    })
                }
                await recordRunStatus('completed')
                return result
            } catch (error) {
                if (options.signal?.aborted) throw createProviderCancellationError(options.signal)
                if (isProviderCancellationError(error)) throw error
                const message = (error as Error).message
                const problem = await recordRunStatus('failed', error)
                return presentFailure(message, undefined, undefined, problem)
            }
        }
        const capabilityReferenceImages = state.capabilityReferenceImages ?? []
        const sourceReferenceImages = getImageSourceReferenceImages(state)
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
        info(`[ImageRouter] invocation chain ${
            JSON.stringify(
                {
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
                },
                null,
                0,
            )
        }`)

        if (referenceImages.length === 0) {
            warn(`[ImageRouter] No reference images attached for ${instanceKey}. If you expected the model to see workspace reference images, check the upstream extractReferenceImages() / messages payload.`)
        }

        const runProviderPass = async (args: {
            passInstanceKey: string
            passPrompt: string
            passReferences: ImageGenerationReference[]
            captureOnly: boolean
        }): Promise<ProviderState> => {
            if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
            const provider = this.registry.createTransient(args.passInstanceKey, imageProvider)
            const stopForAbort = (): void => {
                void this.registry.stop(args.passInstanceKey)
            }
            options.signal?.addEventListener('abort', stopForAbort, { once: true })

            try {
                return await provider.process({
                    messages: [{ role: 'user', content: args.passPrompt }],
                    aiModelMetaInfo: { ...imageMeta, modelVersion: imageModel },
                    organizationId: state.eventMeta.organizationId,
                    workspaceId,
                    aiChatThreadId,
                    enableImageGeneration: true,
                    imageSize,
                    imageGenerationConfig: state.imageGenerationConfig,
                    imageGenerationReferences: args.passReferences,
                    generationRun,
                    isMediaRegenerationRun: Boolean(state.mediaBranchLineagePlan?.regenerationTarget),
                    eventMeta: this.mediaGenerationRunPlanner.buildEventMeta(state.eventMeta, generationRun),
                    proseMirrorContentHandler: options.onProseMirrorContent,
                    proseMirrorSnapshotProvider: options.getProseMirrorSnapshot,
                    captureOnlyImageGeneration: args.captureOnly,
                    capabilityUsageMode: state.capabilityUsageMode,
                    capabilityUsagePrompt: state.capabilityUsagePrompt,
                    durableGenerationRequestId: state.durableGenerationRequestId,
                    providerSafeMediaIntent: state.providerSafeMediaIntent,
                    mediaReferenceBindings: state.mediaReferenceBindings,
                })
            } finally {
                options.signal?.removeEventListener('abort', stopForAbort)
                this.registry.remove?.(args.passInstanceKey)
            }
        }

        try {
            await recordRunStatus('running')
            const finalState = await runProviderPass({
                passInstanceKey: instanceKey,
                passPrompt: imageModelPrompt,
                passReferences: referenceImages,
                captureOnly: options.captureOnly ?? false,
            })
            throwIfProviderCancelled(finalState, options.signal)

            if (finalState.error) {
                err(`[ImageRouter] Image generation failed: ${finalState.error}`)
                const problem = await recordRunStatus('failed', { message: finalState.error, code: finalState.errorCode })
                return presentFailure(finalState.error, finalState.errorCode, finalState.errorType, problem)
            }

            const generatedImages = finalState.generatedImages ?? []
            if (generatedImages.length === 0) {
                const message = 'Image generation failed: provider completed without a generated image'
                err(`[ImageRouter] ${message}`)
                const problem = await recordRunStatus('failed', { message, code: 'PROVIDER_OUTPUT_MISSING' })
                return presentFailure(message, undefined, undefined, problem)
            }

            info(`[ImageRouter] Completed successfully instanceKey=${instanceKey}`)
            await recordRunStatus('completed')
            const generatedCount = finalState.imageUsage?.generatedCount ?? generatedImages.length
            return {
                ...finalState,
                generatedImages,
                imageUsage: generatedImages.length > 0
                    ? { generatedCount, size: imageSize, quality: state.imageGenerationConfig?.quality ?? 'auto' }
                    : undefined,
            }
        } catch (e: any) {
            if (options.signal?.aborted) throw createProviderCancellationError(options.signal)
            if (isProviderCancellationError(e)) throw e
            const message = e?.message ?? String(e)
            err(`[ImageRouter] Image generation failed: ${message}`)
            const problem = await recordRunStatus('failed', e).catch(persistenceError => {
                err(`[ImageRouter] Failed to persist durable media problem: ${(persistenceError as Error).message}`)
                return state.durableGenerationRequestId
                    ? this.registry.getDefinition(imageProvider).normalizeProblem(e, {
                        generationRequestId: state.durableGenerationRequestId,
                        modelId: generationRun?.mediaModelId,
                        stage: 'submit',
                    })
                    : undefined
            })
            return presentFailure(message, undefined, undefined, problem)
        }
    }
}

const buildCapabilityMediaExecutionContext = (
    state: ProviderState,
    generationRun: ProviderState['generationRun'],
    generatedMediaPrompt: string,
): CapabilityMediaExecutionContext => {
    const organizationId = state.eventMeta.organizationId
    const userId = state.eventMeta.userId
    const imageProvider = state.imageProviderName
    const imageModelVersion = state.imageModelVersion
    const imageModelMeta = state.imageModelMetaInfo
    const plan = state.capabilityMediaExecutionPlan
    if (!organizationId || !userId) throw new Error('CAPABILITY_MEDIA_EXECUTION_IDENTITY_REQUIRED')
    if (!imageProvider || !imageModelVersion || !imageModelMeta) {
        throw new Error('CAPABILITY_MEDIA_IMAGE_MODEL_REQUIRED')
    }
    if (!plan) throw new Error('CAPABILITY_MEDIA_EXECUTION_PLAN_REQUIRED')
    const promptAuthority = resolveCapabilityAuthoritativePrompt(state, generatedMediaPrompt)
    const editTargetAssetId = resolveCapabilityEditTargetAssetId(state)
    info(`[ImageRouter] capability media prompt authority ${
        JSON.stringify({
            workspaceId: state.workspaceId,
            aiChatThreadId: state.aiChatThreadId,
            source: promptAuthority.source,
            authoritativePromptLength: promptAuthority.prompt.length,
            generatedMediaPromptLength: generatedMediaPrompt.length,
            ignoredGeneratedMediaPrompt: promptAuthority.source !== 'generated-media-prompt'
                && generatedMediaPrompt.trim().length > 0,
        })
    }`)
    return {
        organizationId,
        userId,
        workspaceId: state.workspaceId,
        conversationAssetId: state.aiChatThreadId,
        generationRequestId: generationRun?.generationRequestId ?? plan.capabilityRunId,
        mediaRunId: generationRun?.mediaRunId ?? plan.capabilityRunId,
        reasoningModel: {
            provider: state.provider,
            modelVersion: state.modelVersion,
            maxCompletionSize: state.maxCompletionSize,
            inferenceCapabilities: state.aiModelMetaInfo.inferenceCapabilities,
        },
        imageModel: {
            provider: imageProvider,
            modelVersion: imageModelVersion,
            meta: imageModelMeta,
            requestedSize: state.imageSize,
        },
        sharedState: {
            authoritativePrompt: promptAuthority.prompt,
            ...(editTargetAssetId ? { editTargetAssetId } : {}),
            mediaReferenceAliases: (state.providerSafeMediaIntent?.bindings
                ?? state.mediaReferenceBindings
                ?? []).map(binding => ({
                    assetId: binding.assetId,
                    alias: binding.alias,
                })),
            sourceSubjectIdentityClassifications: [
                ...new Set(
                    (state.mediaReferenceBindings ?? []).map(binding => binding.subjectIdentity.classification),
                ),
            ],
            capabilityInstructions: state.capabilityUsagePrompt?.trim()
                ? [state.capabilityUsagePrompt.trim()]
                : [],
            capabilityReferences: (state.capabilityReferenceImages ?? []).map((imageUrl, index) => ({
                imageUrl,
                ...(state.capabilityReferenceImageTraceUrls?.[index]
                    ? { traceUrl: state.capabilityReferenceImageTraceUrls[index] }
                    : {}),
            })),
            capabilityOutputs: (state.capabilityToolResults ?? []).map(result => ({
                capabilityId: result.capabilityId,
                runId: result.runId,
                output: result.output,
            })),
        },
        eventMeta: state.eventMeta,
        generationRun,
        workflowId: state.workflowId,
        metricsOperationId: state.metricsOperationId,
        metricsAdmissionApproved: state.metricsAdmissionApproved,
    }
}

const resolveCapabilityEditTargetAssetId = (state: ProviderState): string | undefined => {
    const resolution = state.mediaBranchResolution
    if (resolution?.operationKind !== 'edit_existing') return undefined
    const targetCandidateId = resolution.targetCandidateId
        ?? state.mediaBranchCandidateSnapshot?.activeTargetCandidateId
    if (!targetCandidateId) throw new Error('CAPABILITY_MEDIA_EDIT_TARGET_REQUIRED')
    const target = state.mediaBranchCandidateSnapshot?.candidates.find(candidate => candidate.candidateId === targetCandidateId)
    if (!target) throw new Error('CAPABILITY_MEDIA_EDIT_TARGET_UNKNOWN')
    return target.assetId
}

const resolveCapabilityAuthoritativePrompt = (
    state: ProviderState,
    generatedMediaPrompt: string,
): {
    prompt: string
    source: 'provider-safe-user-prompt' | 'latest-user-message' | 'generated-media-prompt'
} => {
    const providerSafeUserPrompt = state.providerSafeMediaIntent?.safePrompt.trim()
    if (providerSafeUserPrompt) {
        return { prompt: providerSafeUserPrompt, source: 'provider-safe-user-prompt' }
    }
    const latestUserPrompt = [...state.messages].reverse().flatMap(message => {
        if (message.role !== 'user') return []
        if (typeof message.content === 'string') return [message.content.trim()]
        if (!Array.isArray(message.content)) return []
        return [
            message.content.flatMap(part => {
                if (!part || typeof part !== 'object' || Array.isArray(part)) return []
                const value = part as { type?: unknown; text?: unknown }
                return value.type === 'input_text' && typeof value.text === 'string'
                    ? [value.text]
                    : []
            }).join('\n').trim(),
        ]
    }).find(Boolean)
    if (latestUserPrompt) return { prompt: latestUserPrompt, source: 'latest-user-message' }
    return { prompt: generatedMediaPrompt.trim(), source: 'generated-media-prompt' }
}
