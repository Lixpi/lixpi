'use strict'

import { v4 as uuid } from 'uuid'
import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import type {
    AiInteractionMediaGenerationRequest,
    AiModel,
    AiModelId,
    ImageGenerationSize,
    MediaBranchLineagePlan,
    MediaGenerationConfigSelectionGroup,
    MediaRunLineageAssignment,
    ProviderName,
} from '@lixpi/constants'

import AiModelModel from '../../models/ai-model.ts'
import { settlePersistedAiChatGenerationRequest } from '../../prosemirror/ai-chat-stream-assembler.ts'
import { settleMediaGenerationRequestOnCanvas } from '../../services/asset-canvas-projection.ts'
import { ensurePendingGeneratedAssets } from '../../services/generated-asset-storage.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'
import { resolveMediaBranch } from '../graph/media-branch-resolver.ts'
import { StreamPublisher, type ProseMirrorContentHandler, type ProseMirrorSnapshotProvider } from '../graph/stream-publisher.ts'
import type { ProviderState } from '../graph/state.ts'
import { MediaBranchLineagePlanner } from '../lineage/media-branch-lineage-planner.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import { resolveCapabilityOutputMediaRuns } from '../lineage/capability-output-media-runs.ts'
import { resolveWorkspaceContext } from '../graph/workspace-context-resolver.ts'
import type { ProviderRegistry } from '../providers/provider-registry.ts'
import { getCapabilityDispatcher } from '../../capability-system/capability-runtime.ts'
import {
    executeRequiredCapabilitiesForState,
    hasPendingModelRequiredCapabilityOnlyOutput,
    requiredCapabilityProducedCapabilityOnlyOutput,
    resolveCapabilitiesForState,
} from '../../capability-system/capability-state-resolver.ts'

export type MatrixRequestData = Record<string, any> & {
    workspaceId: string
    aiChatThreadId: string
    // Ordered per-section selections (length 1 = singular). Used as the scalar
    // fallback (index 0) when `mediaGenerationRequest` omits a section's list.
    aiReasoningModels?: AiModelId[]
    aiImageModels?: AiModelId[]
    aiVideoModels?: AiModelId[]
    imageSize?: string
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string | number
    videoSourceForExtension?: string
    mediaGenerationRequest?: AiInteractionMediaGenerationRequest
}

type ParsedAiModelId = {
    modelId: AiModelId
    provider: ProviderName
    model: string
}

type SharedPreflightResult = {
    state: Partial<ProviderState>
    publisher: StreamPublisher
}

type ResolvedAiModel = ParsedAiModelId & {
    meta: AiModel
}

type NormalizedMatrixRequest = {
    generationRequestId: string
    requestGroupKey: string
    outputMediaTypes: Array<'image' | 'video'>
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    reasoningModelIds: AiModelId[]
    imageModelIds: AiModelId[]
    videoModelIds: AiModelId[]
    imageSize: ImageGenerationSize
    imageConfigGroups: MediaGenerationConfigSelectionGroup[]
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string | number
    videoSourceForExtension?: string
    videoConfigGroups: MediaGenerationConfigSelectionGroup[]
    regeneration?: AiInteractionMediaGenerationRequest['regeneration']
}

type ResolvedMatrixRequest = NormalizedMatrixRequest & {
    reasoningModels: ResolvedAiModel[]
    imageModels: ResolvedAiModel[]
    videoModels: ResolvedAiModel[]
    imageModelOptions: Record<AiModelId, { imageSize?: string }>
    videoModelOptions: Record<AiModelId, { aspectRatio?: string; resolution?: string; duration?: string | number }>
}

type StopMatrixRequestParams = {
    workspaceId: string
    aiChatThreadId: string
    generationRequestId?: string
}

const uniqueModelIds = (modelIds: Array<string | undefined>): AiModelId[] =>
    Array.from(new Set(
        modelIds
            .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
            .map((modelId) => modelId.trim() as AiModelId)
    ))

const normalizeModelIdsForMode = (
    useMultipleForSection: boolean,
    requestedModelIds: AiModelId[] | undefined,
    scalarModelId: AiModelId | undefined,
): AiModelId[] => {
    if (useMultipleForSection) return uniqueModelIds(requestedModelIds ?? [])
    return uniqueModelIds([scalarModelId ?? requestedModelIds?.[0]])
}

const normalizeConfigGroupsForModels = (
    configGroups: MediaGenerationConfigSelectionGroup[] | undefined,
    modelIds: AiModelId[],
): MediaGenerationConfigSelectionGroup[] => {
    if (!configGroups?.length || modelIds.length === 0) return []

    const modelIdSet = new Set(modelIds)
    return configGroups.flatMap((group): MediaGenerationConfigSelectionGroup[] => {
        const selectedModelIds = uniqueModelIds(group.modelIds)
            .filter(modelId => modelIdSet.has(modelId))
        if (!group.groupId || selectedModelIds.length === 0) return []

        const values = Object.fromEntries(
            Object.entries(group.values ?? {})
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
        ) as MediaGenerationConfigSelectionGroup['values']

        return [{
            groupId: group.groupId,
            modelIds: selectedModelIds,
            values,
        }]
    })
}

const parseAiModelId = (modelId: AiModelId): ParsedAiModelId => {
    const [provider, ...modelParts] = modelId.split(':')
    const model = modelParts.join(':')
    if (!provider || !model) {
        throw new Error(`Invalid AI model id: ${modelId}`)
    }
    return {
        modelId,
        provider: provider as ProviderName,
        model,
    }
}

const modelHasGenerationModality = (meta: AiModel, modality: 'image_generation' | 'video_generation'): boolean =>
    meta.modalities?.some((entry) => entry.modality === modality) ?? false

const assertReasoningModel = (model: ResolvedAiModel): void => {
    if (modelHasGenerationModality(model.meta, 'image_generation') || modelHasGenerationModality(model.meta, 'video_generation')) {
        throw new Error(`Model is not a reasoning model: ${model.modelId}`)
    }
}

const assertImageModel = (model: ResolvedAiModel): void => {
    if (!modelHasGenerationModality(model.meta, 'image_generation')) {
        throw new Error(`Model is not an image generation model: ${model.modelId}`)
    }
}

const assertVideoModel = (model: ResolvedAiModel): void => {
    if (!modelHasGenerationModality(model.meta, 'video_generation')) {
        throw new Error(`Model is not a video generation model: ${model.modelId}`)
    }
}

const normalizeModelOption = (
    requested: string | number | undefined,
    options: Array<{ value?: string; label?: string }> | undefined,
): string | undefined => {
    const requestedValue = requested == null ? '' : String(requested)
    if (!Array.isArray(options) || options.length === 0) return requestedValue || undefined

    const values = options
        .map(option => option.value)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (values.length === 0) return requestedValue || undefined
    if (requestedValue && values.includes(requestedValue)) return requestedValue
    return values[0]
}

const findConfigGroupValue = (
    configGroups: MediaGenerationConfigSelectionGroup[],
    modelId: AiModelId,
    key: 'imageSize' | 'aspectRatio' | 'resolution' | 'duration',
): string | undefined => {
    const group = configGroups.find(configGroup => configGroup.modelIds.includes(modelId))
    const value = group?.values?.[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const buildMediaGenerationRequestGroupKey = (
    workspaceId: string,
    aiChatThreadId: string,
    generationRequestId: string,
): string => `${workspaceId}:${aiChatThreadId}:${generationRequestId}`

export const buildMediaGenerationThreadGroupPrefix = (
    workspaceId: string,
    aiChatThreadId: string,
): string => `${workspaceId}:${aiChatThreadId}:`

const buildReasoningInstanceKey = (requestGroupKey: string, reasoningIndex: number): string =>
    `${requestGroupKey}:reasoning:${reasoningIndex}`

const COMPLETED_REQUEST_PUBLISHER_RETENTION_MS = 10 * 60 * 1000

export class MediaGenerationMatrixOrchestrator {
    private readonly lineagePlanner = new MediaBranchLineagePlanner()
    private readonly runPlanner = new MediaGenerationRunPlanner()
    private readonly cancelledRequestGroupKeys = new Set<string>()
    private readonly requestPublishers = new Map<string, StreamPublisher>()
    private readonly requestPublisherCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

    constructor(
        private readonly registry: ProviderRegistry,
        private readonly natsService: NatsService,
    ) {}

    async process(requestData: MatrixRequestData): Promise<void> {
        const normalized = await this.resolveRequest(this.normalizeRequest(requestData))
        const primaryImageModel = normalized.imageModels[0]
        const primaryVideoModel = normalized.videoModels[0]
        const primaryImageOptions = primaryImageModel ? normalized.imageModelOptions[primaryImageModel.modelId] : undefined
        const primaryVideoOptions = primaryVideoModel ? normalized.videoModelOptions[primaryVideoModel.modelId] : undefined
        const admissionInstanceKeys = normalized.reasoningModels.map((_reasoningModel, reasoningIndex) => (
            buildReasoningInstanceKey(normalized.requestGroupKey, reasoningIndex)
        ))
        let admissions: Partial<ProviderState>[]
        try {
            admissions = await Promise.all(normalized.reasoningModels.map(async (reasoningModel, reasoningIndex) => {
                const instanceKey = buildReasoningInstanceKey(normalized.requestGroupKey, reasoningIndex)
                const provider = this.registry.getOrCreate(instanceKey, reasoningModel.provider)
                return provider.preflightAdmission({
                    ...requestData,
                    workspaceId: requestData.workspaceId,
                    aiChatThreadId: requestData.aiChatThreadId,
                    instanceKey,
                    provider: reasoningModel.provider,
                    modelVersion: reasoningModel.meta.modelVersion,
                    aiModelMetaInfo: reasoningModel.meta,
                    messages: requestData.messages ?? [],
                    eventMeta: requestData.eventMeta ?? {},
                    enableImageGeneration: normalized.imageModels.length > 0,
                    enableVideoGeneration: normalized.videoModels.length > 0,
                } as ProviderState)
            }))
        } catch (error) {
            admissionInstanceKeys.forEach(instanceKey => this.registry.remove(instanceKey))
            throw error
        }
        info('[MEDIA_MATRIX] Normalized media generation request', {
            generationRequestId: normalized.generationRequestId,
            aiChatThreadId: requestData.aiChatThreadId,
            useMultipleReasoningModels: normalized.useMultipleReasoningModels,
            useMultipleImageModels: normalized.useMultipleImageModels,
            useMultipleVideoModels: normalized.useMultipleVideoModels,
            outputMediaTypes: normalized.outputMediaTypes,
            requestedReasoningModelIds: requestData.mediaGenerationRequest?.reasoningModelIds ?? requestData.aiReasoningModels ?? [],
            requestedImageModelIds: requestData.mediaGenerationRequest?.imageModelIds ?? requestData.aiImageModels ?? [],
            requestedVideoModelIds: requestData.mediaGenerationRequest?.videoModelIds ?? requestData.aiVideoModels ?? [],
            normalizedReasoningModelIds: normalized.reasoningModelIds,
            normalizedImageModelIds: normalized.imageModelIds,
            normalizedVideoModelIds: normalized.videoModelIds,
            imageConfigGroups: normalized.imageConfigGroups,
            videoConfigGroups: normalized.videoConfigGroups,
            imageModelOptions: normalized.imageModelOptions,
            videoModelOptions: normalized.videoModelOptions,
        })
        const sharedPreflight = await this.runSharedPreflight({
            requestData,
            normalized,
            primaryImageModel,
            primaryVideoModel,
            primaryImageOptions,
            primaryVideoOptions,
        })
        this.rememberRequestPublisher(normalized.requestGroupKey, sharedPreflight.publisher)
        const sharedPreflightState = sharedPreflight.state

        info('[MEDIA_MATRIX] Starting media generation matrix request', {
            generationRequestId: normalized.generationRequestId,
            aiChatThreadId: requestData.aiChatThreadId,
            reasoningCount: normalized.reasoningModels.length,
            imageModelCount: normalized.imageModels.length,
            videoModelCount: normalized.videoModels.length,
        })

        try {
            const results = await Promise.allSettled(normalized.reasoningModels.map((reasoningModel, reasoningIndex) => {
                const reasoningRunId = this.runPlanner.buildReasoningRunId(normalized.generationRequestId, reasoningIndex)
                const instanceKey = buildReasoningInstanceKey(normalized.requestGroupKey, reasoningIndex)
                const lineageAssignment = this.getRunLineageAssignment(sharedPreflightState.mediaBranchLineagePlan, reasoningRunId)
                const generationRun = this.runPlanner.buildMatrixReasoningRun({
                    generationRequestId: normalized.generationRequestId,
                    reasoningRunId,
                    reasoningModelId: reasoningModel.modelId,
                    reasoningIndex,
                    ...(lineageAssignment ? { lineageAssignment } : {}),
                })
                return this.registry.process(instanceKey, reasoningModel.provider, {
                    ...requestData,
                    ...admissions[reasoningIndex],

                    // ── Shared-preflight → fanout propagation (CRITICAL INVARIANT) ──
                    // `runSharedPreflight()` resolves workspace context, sealed
                    // Capabilities and required Tools, the image branch (which also selects the video
                    // first-frame / reference images), and media lineage EXACTLY ONCE,
                    // then every reasoning child is dispatched with
                    // `preflightResolved: true`. That flag makes each child's provider
                    // graph SKIP all resolver nodes (see `BaseProvider.buildWorkflow`),
                    // so a child can only ever observe resolution outputs that are
                    // forwarded right here — anything omitted is silently lost before
                    // the image/video routers run.
                    //
                    // Regression this prevents: the resolver correctly chose reference
                    // images into `videoReferenceImages` / `videoFirstFrameImage`, but
                    // an earlier hand-maintained field list here forwarded only a
                    // subset and never forwarded those two, so every Seedance/VEO call
                    // ran as pure text-to-video (zero references) and quality collapsed.
                    //
                    // Fix / future-proofing: spread the ENTIRE resolved patch returned
                    // by `runSharedPreflight()` rather than cherry-picking named fields.
                    // `sharedPreflightState` is precisely what the resolvers emitted
                    // (single source of truth), so reference inputs for images, video,
                    // and any media modality added later propagate automatically.
                    ...sharedPreflightState,

                    // Per-child identity + primary-model media options. These are
                    // model-specific and MUST win over anything above, so they are set
                    // last (the spreads above never contain these keys today, but
                    // ordering keeps that guarantee robust).
                    aiModelMetaInfo: reasoningModel.meta,
                    imageModelMetaInfo: primaryImageModel?.meta,
                    videoModelMetaInfo: primaryVideoModel?.meta,
                    imageSize: primaryImageOptions?.imageSize ?? normalized.imageSize,
                    videoAspectRatio: primaryVideoOptions?.aspectRatio,
                    videoResolution: primaryVideoOptions?.resolution,
                    videoDurationSeconds: primaryVideoOptions?.duration ? Number(primaryVideoOptions.duration) : undefined,
                    videoSourceForExtension: normalized.videoSourceForExtension,
                    preflightResolved: true,
                    mediaFanoutPlan: {
                        generationRequestId: normalized.generationRequestId,
                        imageModels: normalized.imageModels.map((model) => model.meta),
                        videoModels: normalized.videoModels.map((model) => model.meta),
                        imageSize: normalized.imageSize,
                        imageModelOptions: normalized.imageModelOptions,
                        ...(normalized.videoAspectRatio ? { videoAspectRatio: normalized.videoAspectRatio } : {}),
                        ...(normalized.videoResolution ? { videoResolution: normalized.videoResolution } : {}),
                        ...(normalized.videoDuration ? { videoDuration: normalized.videoDuration } : {}),
                        videoModelOptions: normalized.videoModelOptions,
                        ...(normalized.videoSourceForExtension ? { videoSourceForExtension: normalized.videoSourceForExtension } : {}),
                        imageConfigGroups: normalized.imageConfigGroups,
                        videoConfigGroups: normalized.videoConfigGroups,
                        ...(normalized.regeneration?.mode === 'existing-prompt' ? {
                            replayPrompts: normalized.regeneration.replayPrompts.filter(
                                replayPrompt => replayPrompt.reasoningModelId === reasoningModel.modelId
                            ),
                        } : {}),
                    },
                    ...(normalized.regeneration?.mode === 'existing-prompt' ? {
                        replayMediaPrompts: normalized.regeneration.replayPrompts.filter(
                            replayPrompt => replayPrompt.reasoningModelId === reasoningModel.modelId
                        ),
                    } : {}),
                    mediaGenerationRequest: {
                        requestVersion: 'media-generation-matrix-v1',
                        generationRequestId: normalized.generationRequestId,
                        outputMediaTypes: normalized.outputMediaTypes,
                        useMultipleReasoningModels: normalized.useMultipleReasoningModels,
                        useMultipleImageModels: normalized.useMultipleImageModels,
                        useMultipleVideoModels: normalized.useMultipleVideoModels,
                        reasoningModelIds: normalized.reasoningModelIds,
                        imageModelIds: normalized.imageModelIds,
                        videoModelIds: normalized.videoModelIds,
                        imageOptions: {
                            imageSize: normalized.imageSize,
                            configGroups: normalized.imageConfigGroups,
                        },
                        videoOptions: {
                            ...(normalized.videoAspectRatio ? { aspectRatio: normalized.videoAspectRatio } : {}),
                            ...(normalized.videoResolution ? { resolution: normalized.videoResolution } : {}),
                            ...(normalized.videoDuration ? { duration: String(normalized.videoDuration) } : {}),
                            ...(normalized.videoSourceForExtension ? { sourceForExtension: normalized.videoSourceForExtension } : {}),
                            configGroups: normalized.videoConfigGroups,
                        },
                        ...(normalized.regeneration ? { regeneration: normalized.regeneration } : {}),
                    },
                    generationRun,
                    eventMeta: this.runPlanner.buildEventMeta(requestData.eventMeta ?? {}, generationRun),
                }, { requestGroupKey: normalized.requestGroupKey })
            }))
            const rejectedResult = results.find(result => result.status === 'rejected')
            if (rejectedResult?.status === 'rejected') throw rejectedResult.reason
        } finally {
            const removeProjectedPendingNodes = this.cancelledRequestGroupKeys.delete(normalized.requestGroupKey)
            sharedPreflight.publisher.mediaGenerationRequestComplete(normalized.generationRequestId, {
                removeProjectedPendingNodes,
            })
            await sharedPreflight.publisher.drainPendingWrites()
            await sharedPreflight.publisher.finishProseMirrorStream()
            this.scheduleRequestPublisherCleanup(normalized.requestGroupKey)
        }
    }

    async stop({ workspaceId, aiChatThreadId, generationRequestId }: StopMatrixRequestParams): Promise<void> {
        if (generationRequestId) {
            const requestGroupKey = buildMediaGenerationRequestGroupKey(workspaceId, aiChatThreadId, generationRequestId)
            this.cancelledRequestGroupKeys.add(requestGroupKey)
            await this.registry.stopGroup(requestGroupKey)
            const publisher = this.requestPublishers.get(requestGroupKey)
            if (publisher) {
                await publisher.cancelProseMirrorGenerationRequest(generationRequestId)
                publisher.mediaGenerationRequestComplete(generationRequestId, {
                    removeProjectedPendingNodes: true,
                })
                await publisher.drainPendingWrites()
                await publisher.finishProseMirrorStream()
                this.cancelledRequestGroupKeys.delete(requestGroupKey)
                this.scheduleRequestPublisherCleanup(requestGroupKey)
            } else {
                const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
                    workspaceId,
                    generationRequestId,
                    removeProjectedPendingNodes: true,
                })
                info('[MEDIA_MATRIX] Persisted cancellation without a live request publisher', {
                    requestGroupKey,
                    generationRequestId,
                    removedNodeIds: canvasGeometry?.removedNodeIds ?? [],
                })
                this.scheduleRequestPublisherCleanup(requestGroupKey)
            }
            const persistedThreadCancellation = await settlePersistedAiChatGenerationRequest({
                workspaceId,
                aiChatThreadId,
                generationRequestId,
            })
            info('[MEDIA_MATRIX] Persisted cancelled transcript state', {
                requestGroupKey,
                generationRequestId,
                ...persistedThreadCancellation,
            })
            return
        }

        await this.registry.stopGroupsWithPrefix(buildMediaGenerationThreadGroupPrefix(workspaceId, aiChatThreadId))
    }

    private rememberRequestPublisher(requestGroupKey: string, publisher: StreamPublisher): void {
        const cleanupTimer = this.requestPublisherCleanupTimers.get(requestGroupKey)
        if (cleanupTimer) clearTimeout(cleanupTimer)
        this.requestPublisherCleanupTimers.delete(requestGroupKey)
        this.requestPublishers.set(requestGroupKey, publisher)
    }

    private scheduleRequestPublisherCleanup(requestGroupKey: string): void {
        const currentTimer = this.requestPublisherCleanupTimers.get(requestGroupKey)
        if (currentTimer) clearTimeout(currentTimer)
        const cleanupTimer = setTimeout(() => {
            this.requestPublishers.delete(requestGroupKey)
            this.requestPublisherCleanupTimers.delete(requestGroupKey)
            this.cancelledRequestGroupKeys.delete(requestGroupKey)
        }, COMPLETED_REQUEST_PUBLISHER_RETENTION_MS)
        if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer && typeof cleanupTimer.unref === 'function') {
            cleanupTimer.unref()
        }
        this.requestPublisherCleanupTimers.set(requestGroupKey, cleanupTimer)
    }

    private normalizeRequest(requestData: MatrixRequestData): NormalizedMatrixRequest {
        const request = requestData.mediaGenerationRequest
        const generationRequestId = request?.generationRequestId || uuid()
        const useMultipleReasoningModels = request?.useMultipleReasoningModels ?? ((request?.reasoningModelIds?.length ?? 0) > 1)
        const useMultipleImageModels = request?.useMultipleImageModels ?? ((request?.imageModelIds?.length ?? 0) > 1)
        const hasExplicitVideoSource = Boolean(request?.videoOptions?.sourceForExtension ?? requestData.videoSourceForExtension)
        const useMultipleVideoModels = request?.useMultipleVideoModels ?? ((request?.videoModelIds?.length ?? 0) > 1)
        const hasExplicitMediaFanout = useMultipleImageModels || useMultipleVideoModels
        const outputMediaTypes = request?.outputMediaTypes?.length
            ? Array.from(new Set(request.outputMediaTypes))
            : [
                ...((hasExplicitMediaFanout
                    ? useMultipleImageModels
                    : (request?.imageModelIds?.length ?? requestData.aiImageModels?.length ?? 0) > 0
                ) ? ['image' as const] : []),
                ...((hasExplicitMediaFanout
                    ? useMultipleVideoModels || hasExplicitVideoSource
                    : (request?.videoModelIds?.length ?? requestData.aiVideoModels?.length ?? 0) > 0 || hasExplicitVideoSource
                )
                    ? ['video' as const]
                    : []),
            ]
        const includeVideoModels = request
            ? outputMediaTypes.includes('video') && ((request.videoModelIds?.length ?? 0) > 0 || hasExplicitVideoSource)
            : (requestData.aiVideoModels?.length ?? 0) > 0
        const reasoningModelIds = normalizeModelIdsForMode(useMultipleReasoningModels, request?.reasoningModelIds, requestData.aiReasoningModels?.[0])
        const imageModelIds = outputMediaTypes.includes('image')
            ? normalizeModelIdsForMode(useMultipleImageModels, request?.imageModelIds, requestData.aiImageModels?.[0])
            : []
        const videoModelIds = includeVideoModels
            ? normalizeModelIdsForMode(useMultipleVideoModels, request?.videoModelIds, requestData.aiVideoModels?.[0])
            : []

        if (reasoningModelIds.length === 0) {
            throw new Error('mediaGenerationRequest requires at least one reasoning model')
        }
        const hasCapabilityTool = requestData.capabilityReferences?.some((reference: { kind?: string }) => (
            reference.kind === 'tool'
        )) === true
        if (imageModelIds.length === 0 && videoModelIds.length === 0 && !hasCapabilityTool) {
            throw new Error('mediaGenerationRequest requires at least one image or video generation model')
        }

        return {
            generationRequestId,
            requestGroupKey: buildMediaGenerationRequestGroupKey(
                requestData.workspaceId,
                requestData.aiChatThreadId,
                generationRequestId,
            ),
            outputMediaTypes,
            useMultipleReasoningModels,
            useMultipleImageModels,
            useMultipleVideoModels,
            reasoningModelIds,
            imageModelIds,
            videoModelIds,
            imageSize: (request?.imageOptions?.imageSize ?? requestData.imageSize ?? 'auto') as ImageGenerationSize,
            imageConfigGroups: useMultipleImageModels
                ? normalizeConfigGroupsForModels(request?.imageOptions?.configGroups, imageModelIds)
                : [],
            videoAspectRatio: request?.videoOptions?.aspectRatio ?? requestData.videoAspectRatio,
            videoResolution: request?.videoOptions?.resolution ?? requestData.videoResolution,
            videoDuration: request?.videoOptions?.duration ?? requestData.videoDuration,
            videoSourceForExtension: request?.videoOptions?.sourceForExtension ?? requestData.videoSourceForExtension,
            videoConfigGroups: useMultipleVideoModels
                ? normalizeConfigGroupsForModels(request?.videoOptions?.configGroups, videoModelIds)
                : [],
            regeneration: request?.regeneration,
        }
    }

    private async resolveRequest(normalized: NormalizedMatrixRequest): Promise<ResolvedMatrixRequest> {
        const [reasoningModels, imageModels, videoModels] = await Promise.all([
            this.resolveModels(normalized.reasoningModelIds),
            this.resolveModels(normalized.imageModelIds),
            this.resolveModels(normalized.videoModelIds),
        ])

        reasoningModels.forEach(assertReasoningModel)
        imageModels.forEach(assertImageModel)
        videoModels.forEach(assertVideoModel)

        return {
            ...normalized,
            reasoningModels,
            imageModels,
            videoModels,
            imageModelOptions: this.resolveImageModelOptions(normalized, imageModels),
            videoModelOptions: this.resolveVideoModelOptions(normalized, videoModels),
        }
    }

    private resolveImageModelOptions(
        normalized: NormalizedMatrixRequest,
        imageModels: ResolvedAiModel[],
    ): Record<AiModelId, { imageSize?: string }> {
        const optionsByModelId: Record<AiModelId, { imageSize?: string }> = {}
        for (const imageModel of imageModels) {
            const requestedImageSize = findConfigGroupValue(
                normalized.imageConfigGroups,
                imageModel.modelId,
                'imageSize',
            ) ?? normalized.imageSize
            optionsByModelId[imageModel.modelId] = {
                imageSize: normalizeModelOption(requestedImageSize, imageModel.meta.imageSizes) ?? 'auto',
            }
        }
        return optionsByModelId
    }

    private resolveVideoModelOptions(
        normalized: NormalizedMatrixRequest,
        videoModels: ResolvedAiModel[],
    ): Record<AiModelId, { aspectRatio?: string; resolution?: string; duration?: string | number }> {
        const optionsByModelId: Record<AiModelId, { aspectRatio?: string; resolution?: string; duration?: string | number }> = {}
        for (const videoModel of videoModels) {
            const requestedAspectRatio = findConfigGroupValue(
                normalized.videoConfigGroups,
                videoModel.modelId,
                'aspectRatio',
            ) ?? normalized.videoAspectRatio
            const requestedResolution = findConfigGroupValue(
                normalized.videoConfigGroups,
                videoModel.modelId,
                'resolution',
            ) ?? normalized.videoResolution
            const requestedDuration = findConfigGroupValue(
                normalized.videoConfigGroups,
                videoModel.modelId,
                'duration',
            ) ?? normalized.videoDuration

            const aspectRatio = normalizeModelOption(requestedAspectRatio, videoModel.meta.videoAspectRatios)
            const resolution = normalizeModelOption(requestedResolution, videoModel.meta.videoResolutions)
            const duration = normalizeModelOption(requestedDuration, videoModel.meta.videoDurations)

            optionsByModelId[videoModel.modelId] = {
                ...(aspectRatio ? { aspectRatio } : {}),
                ...(resolution ? { resolution } : {}),
                ...(duration ? { duration } : {}),
            }
        }
        return optionsByModelId
    }

    private async resolveModels(modelIds: AiModelId[]): Promise<ResolvedAiModel[]> {
        return Promise.all(modelIds.map(async (modelId) => {
            const parsed = parseAiModelId(modelId)
            const meta = await AiModelModel.getAiModel({
                provider: parsed.provider,
                model: parsed.model,
                omitPricing: false,
            }) as AiModel | undefined

            if (!meta || !meta.modelVersion) {
                throw new Error(`AI model not found: ${modelId}`)
            }

            return {
                ...parsed,
                meta,
            }
        }))
    }

    private async runSharedPreflight({
        requestData,
        normalized,
        primaryImageModel,
        primaryVideoModel,
        primaryImageOptions,
        primaryVideoOptions,
    }: {
        requestData: MatrixRequestData
        normalized: ResolvedMatrixRequest
        primaryImageModel?: ResolvedAiModel
        primaryVideoModel?: ResolvedAiModel
        primaryImageOptions?: { imageSize?: string }
        primaryVideoOptions?: { aspectRatio?: string; resolution?: string; duration?: string | number }
    }): Promise<SharedPreflightResult> {
        const reasoningModel = normalized.reasoningModels[0]
        const abortController = new AbortController()
        const generationRun = this.runPlanner.buildMatrixReasoningRun({
            generationRequestId: normalized.generationRequestId,
            reasoningRunId: this.runPlanner.buildReasoningRunId(normalized.generationRequestId, 0),
            reasoningModelId: reasoningModel.modelId,
            reasoningIndex: 0,
        })
        const publisher = new StreamPublisher(
            this.natsService,
            requestData.workspaceId,
            requestData.aiChatThreadId,
            reasoningModel.provider,
            generationRun,
            {
                organizationId: requestData.organizationId,
                assetLeaseId: requestData.assetLeaseId,
                assetLeaseHolderId: requestData.assetLeaseHolderId,
                enableProseMirrorStream: Boolean(requestData.proseMirrorInitialDoc),
                proseMirrorBaseVersion: requestData.proseMirrorBaseVersion,
                proseMirrorInitialDoc: requestData.proseMirrorInitialDoc,
                deferProseMirrorEnd: true,
                canvasVisibleArea: requestData.canvasVisibleArea,
            },
        )
        let state: ProviderState = {
            messages: requestData.messages ?? [],
            aiModelMetaInfo: reasoningModel.meta,
            eventMeta: requestData.eventMeta ?? {},
            workspaceId: requestData.workspaceId,
            aiChatThreadId: requestData.aiChatThreadId,
            instanceKey: `${normalized.requestGroupKey}:preflight`,
            provider: reasoningModel.provider,
            modelVersion: reasoningModel.meta.modelVersion,
            maxCompletionSize: reasoningModel.meta.maxCompletionSize,
            temperature: reasoningModel.meta.defaultTemperature ?? 0.7,
            streamActive: false,
            aiRequestReceivedAt: Date.now(),
            enableImageGeneration: requestData.enableImageGeneration ?? false,
            imageSize: primaryImageOptions?.imageSize ?? normalized.imageSize,
            imageModelMetaInfo: primaryImageModel?.meta,
            imageModelVersion: primaryImageModel?.meta.modelVersion,
            imageProviderName: primaryImageModel?.provider,
            imagePromptRetryCount: 0,
            workspaceContextSnapshot: requestData.workspaceContextSnapshot,
            mediaBranchCandidateSnapshot: requestData.mediaBranchCandidateSnapshot,
            promptReferenceAssetIds: requestData.promptReferenceAssetIds,
            canvasVisibleArea: requestData.canvasVisibleArea,
            capabilityReferences: requestData.capabilityReferences,
            capabilityInputs: requestData.capabilityInputs,
            capabilityInvocationDepth: requestData.capabilityInvocationDepth ?? 0,
            capabilityOutputAssetIds: requestData.capabilityOutputAssetIds,
            capabilityOutputMediaAssetIds: requestData.capabilityOutputMediaAssetIds,
            capabilityReferenceImages: requestData.capabilityReferenceImages,
            capabilityReferenceImageTraceUrls: requestData.capabilityReferenceImageTraceUrls,
            capabilityUsageMode: requestData.capabilityUsageMode,
            capabilityUsagePrompt: requestData.capabilityUsagePrompt,
            enableVideoGeneration: requestData.enableVideoGeneration ?? false,
            videoModelMetaInfo: primaryVideoModel?.meta,
            videoModelVersion: primaryVideoModel?.meta.modelVersion,
            videoProviderName: primaryVideoModel?.provider,
            videoAspectRatio: primaryVideoOptions?.aspectRatio,
            videoResolution: primaryVideoOptions?.resolution,
            videoDurationSeconds: primaryVideoOptions?.duration ? Number(primaryVideoOptions.duration) : undefined,
            videoSourceForExtension: normalized.videoSourceForExtension,
            generationRun,
            durableGenerationRequestId: requestData.durableGenerationRequestId,
            durableMediaRuns: requestData.durableMediaRuns,
            providerSafeMediaIntent: requestData.providerSafeMediaIntent,
            mediaReferenceBindings: requestData.mediaReferenceBindings,
        }

        // Each resolver runs against the accumulating `state` because later
        // resolvers depend on earlier outputs (e.g. the media-branch resolver
        // reads the messages rewritten by required Capability execution). Separately
        // we capture the RAW resolver patches into `resolved`: this is the exact,
        // complete set of fields the shared preflight produced and is the single
        // source of truth forwarded to every reasoning child in `process()`.
        //
        // Deriving the forwarded set from the patches — instead of a hand-listed
        // field allow-list — is what makes it structurally impossible to drop a
        // resolver output on the way to the per-model children. Children run with
        // `preflightResolved: true`, which makes their provider graph SKIP every
        // resolver node (see `BaseProvider.buildWorkflow`), so a field the
        // preflight resolved but did not forward is lost forever. That is exactly
        // how `videoReferenceImages` / `videoFirstFrameImage` got dropped and made
        // every video generate as text-to-video. Capturing patches guarantees the
        // reference images for images, video, and ANY media modality added later
        // ride along automatically. `undefined` values are skipped to mirror
        // `applyStatePatch` and avoid clobbering already-forwarded request data.
        const resolved: Partial<ProviderState> = {}
        const resolvedRecord = resolved as Record<string, unknown>
        const applyResolved = (patch: Partial<ProviderState>): void => {
            state = this.applyStatePatch(state, patch)
            for (const [key, value] of Object.entries(patch)) {
                if (value !== undefined) resolvedRecord[key] = value
            }
        }

        applyResolved(await resolveWorkspaceContext(state, {
            natsService: this.natsService,
            publisher,
            abortSignal: abortController.signal,
        }))
        applyResolved(await resolveCapabilitiesForState(state, abortController.signal))
        applyResolved(await executeRequiredCapabilitiesForState(
            state,
            getCapabilityDispatcher(),
            abortController.signal,
            normalized.reasoningModels.map((model, reasoningIndex) => ({
                axis: 'reasoning-model',
                variantKey: `reasoning:${reasoningIndex}:${model.modelId}`,
                reasoningIndex,
                reasoningModelId: model.modelId,
                provider: model.provider,
                modelVersion: model.meta.modelVersion,
                contextWindow: model.meta.contextWindow,
                maxCompletionSize: model.meta.maxCompletionSize,
                inferenceCapabilities: model.meta.inferenceCapabilities,
            })),
        ))
        const capabilityOnlyOutput = requiredCapabilityProducedCapabilityOnlyOutput(state)
            || hasPendingModelRequiredCapabilityOnlyOutput(state)
        if (capabilityOnlyOutput) {
            const matrixProseMirrorContentHandler: ProseMirrorContentHandler = content => publisher.publishProseMirrorContent(content)
            const matrixProseMirrorSnapshotProvider: ProseMirrorSnapshotProvider = () => publisher.getProseMirrorSnapshot()
            resolvedRecord.proseMirrorContentHandler = matrixProseMirrorContentHandler
            resolvedRecord.proseMirrorSnapshotProvider = matrixProseMirrorSnapshotProvider
            await publisher.drainPendingWrites()
            return { state: resolved, publisher }
        }
        applyResolved(await resolveMediaBranch(state, {
            natsService: this.natsService,
            publisher,
            abortSignal: abortController.signal,
        }))
        const capabilityOutputMediaAssetIds = state.capabilityOutputMediaAssetIds
            ?? state.capabilityOutputAssetIds
            ?? []
        const preassignedMediaRuns = capabilityOutputMediaAssetIds.length > 0
            ? await resolveCapabilityOutputMediaRuns(capabilityOutputMediaAssetIds)
            : undefined
        const mediaBranchLineagePlan = this.lineagePlanner.buildPlan({
            generationRequestId: normalized.generationRequestId,
            reasoningModelIds: preassignedMediaRuns
                ? [...new Set(preassignedMediaRuns.map(run => run.reasoningModelId))]
                : normalized.reasoningModelIds,
            ...(preassignedMediaRuns
                ? { preassignedMediaRuns }
                : {
                    imageModelIds: normalized.imageModelIds,
                    videoModelIds: state.capabilityUsageMode === 'character-creator'
                        ? []
                        : normalized.videoModelIds,
                }),
            mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
            mediaBranchResolution: state.mediaBranchResolution,
            referenceAssetIds: state.promptReferenceAssetIds,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
            ...(normalized.regeneration?.mode === 'existing-prompt' ? {
                regenerationTarget: {
                    branchId: normalized.regeneration.branchId,
                    lineageParentNodeId: normalized.regeneration.lineageParentNodeId,
                    lineageParentType: normalized.regeneration.lineageParentType,
                    ...(normalized.regeneration.sourceNodeId
                        ? {
                            sourceMediaNodeId: normalized.regeneration.sourceNodeId,
                            ...(normalized.regeneration.replayPrompts[0]?.sourceAssetId
                                ? { sourceMediaAssetId: normalized.regeneration.replayPrompts[0]!.sourceAssetId }
                                : {}),
                        }
                        : {}),
                },
            } : {}),
            forceFreshLineage: normalized.regeneration?.mode === 'regenerate-prompt'
                && normalized.regeneration.forceFreshLineage,
            createdAt: Date.now(),
        })
        const organizationId = requestData.eventMeta?.organizationId as string | undefined
        const ownerUserId = requestData.eventMeta?.userId as string | undefined
        if (!organizationId || !ownerUserId) {
            throw new Error('Asset media generation requires organization and user context')
        }
        await ensurePendingGeneratedAssets({
            lineagePlan: mediaBranchLineagePlan,
            workspaceId: requestData.workspaceId,
            conversationAssetId: requestData.aiChatThreadId,
            organizationId,
            ownerUserId,
            mediaBranchCandidateSnapshot: state.mediaBranchCandidateSnapshot,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
        })
        const firstLineageAssignment = preassignedMediaRuns
            ? mediaBranchLineagePlan.runAssignments[0]
            : this.getRunLineageAssignment(mediaBranchLineagePlan, generationRun.reasoningRunId)
        const lineageGenerationRun = firstLineageAssignment
            ? { ...generationRun, lineageAssignment: firstLineageAssignment }
            : generationRun
        publisher.mediaLineagePlanned(mediaBranchLineagePlan, lineageGenerationRun)
        info('[MEDIA_MATRIX] Media branch lineage planned', {
            generationRequestId: mediaBranchLineagePlan.generationRequestId,
            branchId: mediaBranchLineagePlan.branchId,
            branchOriginNodeId: mediaBranchLineagePlan.branchOrigin?.nodeId,
            branchForkCount: mediaBranchLineagePlan.branchForks.length,
            runAssignmentCount: mediaBranchLineagePlan.runAssignments.length,
        })
        applyResolved({ mediaBranchLineagePlan })
        const matrixProseMirrorContentHandler: ProseMirrorContentHandler = (content) => publisher.publishProseMirrorContent(content)
        const matrixProseMirrorSnapshotProvider: ProseMirrorSnapshotProvider = () => publisher.getProseMirrorSnapshot()
        resolvedRecord.proseMirrorContentHandler = matrixProseMirrorContentHandler
        resolvedRecord.proseMirrorSnapshotProvider = matrixProseMirrorSnapshotProvider
        await publisher.drainPendingWrites()
        if (requestData.durableGenerationRequestId) {
            await new MediaGenerationRequestService().bindRunsToLineagePlan({
                generationRequestId: requestData.durableGenerationRequestId,
                workspaceId: requestData.workspaceId,
                lineagePlan: mediaBranchLineagePlan,
            })
        }

        return { state: resolved, publisher }
    }

    private getRunLineageAssignment(
        lineagePlan: MediaBranchLineagePlan | undefined,
        reasoningRunId: string,
    ): MediaRunLineageAssignment | undefined {
        return lineagePlan?.runAssignments.find(assignment => assignment.reasoningRunId === reasoningRunId)
    }

    private applyStatePatch(state: ProviderState, patch: Partial<ProviderState>): ProviderState {
        const nextState = { ...state }
        for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) {
                const writableState = nextState as Record<string, unknown>
                writableState[key] = value
            }
        }
        return nextState
    }
}
