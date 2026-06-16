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
import { resolveFeatures } from '../graph/feature-resolver.ts'
import { resolveImageBranch } from '../graph/image-branch-resolver.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import type { ProviderState } from '../graph/state.ts'
import { MediaBranchLineagePlanner } from '../lineage/media-branch-lineage-planner.ts'
import { MediaGenerationRunPlanner } from '../lineage/media-generation-run-planner.ts'
import { resolveWorkspaceContext } from '../graph/workspace-context-resolver.ts'
import type { ProviderRegistry } from '../providers/provider-registry.ts'

export type MatrixRequestData = Record<string, any> & {
    workspaceId: string
    aiChatThreadId: string
    aiModel?: AiModelId
    aiImageModel?: AiModelId
    aiVideoModel?: AiModelId
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

type ResolvedAiModel = ParsedAiModelId & {
    meta: AiModel
}

type NormalizedMatrixRequest = {
    generationRequestId: string
    requestGroupKey: string
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
    useMultipleModels: boolean,
    requestedModelIds: AiModelId[] | undefined,
    scalarModelId: AiModelId | undefined,
): AiModelId[] => {
    if (useMultipleModels) return uniqueModelIds(requestedModelIds ?? [])
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

export class MediaGenerationMatrixOrchestrator {
    private readonly lineagePlanner = new MediaBranchLineagePlanner()
    private readonly runPlanner = new MediaGenerationRunPlanner()

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
        const sharedPreflightState = await this.runSharedPreflight({
            requestData,
            normalized,
            primaryImageModel,
            primaryVideoModel,
            primaryImageOptions,
            primaryVideoOptions,
        })

        info('[MEDIA_MATRIX] Starting media generation matrix request', {
            generationRequestId: normalized.generationRequestId,
            aiChatThreadId: requestData.aiChatThreadId,
            reasoningCount: normalized.reasoningModels.length,
            imageModelCount: normalized.imageModels.length,
            videoModelCount: normalized.videoModels.length,
        })

        await Promise.all(normalized.reasoningModels.map((reasoningModel, reasoningIndex) => {
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
                aiModelMetaInfo: reasoningModel.meta,
                imageModelMetaInfo: primaryImageModel?.meta,
                videoModelMetaInfo: primaryVideoModel?.meta,
                imageSize: primaryImageOptions?.imageSize ?? normalized.imageSize,
                videoAspectRatio: primaryVideoOptions?.aspectRatio,
                videoResolution: primaryVideoOptions?.resolution,
                videoDurationSeconds: primaryVideoOptions?.duration ? Number(primaryVideoOptions.duration) : undefined,
                videoSourceForExtension: normalized.videoSourceForExtension,
                workspaceContextResolution: sharedPreflightState.workspaceContextResolution,
                imageBranchCandidateSnapshot: sharedPreflightState.imageBranchCandidateSnapshot,
                imageBranchResolution: sharedPreflightState.imageBranchResolution,
                mediaBranchLineagePlan: sharedPreflightState.mediaBranchLineagePlan,
                messages: sharedPreflightState.messages,
                featureReferenceImages: sharedPreflightState.featureReferenceImages,
                featureReferenceImageTraceUrls: sharedPreflightState.featureReferenceImageTraceUrls,
                featureUsagePrompt: sharedPreflightState.featureUsagePrompt,
                referencedFeatureIds: sharedPreflightState.referencedFeatureIds,
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
                },
                mediaGenerationRequest: {
                    requestVersion: 'media-generation-matrix-v1',
                    generationRequestId: normalized.generationRequestId,
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
                },
                generationRun,
                eventMeta: this.runPlanner.buildEventMeta(requestData.eventMeta ?? {}, generationRun),
            }, { requestGroupKey: normalized.requestGroupKey })
        }))
    }

    async stop({ workspaceId, aiChatThreadId, generationRequestId }: StopMatrixRequestParams): Promise<void> {
        if (generationRequestId) {
            await this.registry.stopGroup(buildMediaGenerationRequestGroupKey(workspaceId, aiChatThreadId, generationRequestId))
            return
        }

        await this.registry.stopGroupsWithPrefix(buildMediaGenerationThreadGroupPrefix(workspaceId, aiChatThreadId))
    }

    private normalizeRequest(requestData: MatrixRequestData): NormalizedMatrixRequest {
        const request = requestData.mediaGenerationRequest
        const generationRequestId = request?.generationRequestId || uuid()
        const useMultipleReasoningModels = request?.useMultipleReasoningModels ?? ((request?.reasoningModelIds?.length ?? 0) > 1)
        const useMultipleImageModels = request?.useMultipleImageModels ?? ((request?.imageModelIds?.length ?? 0) > 1)
        const useMultipleVideoModels = request?.useMultipleVideoModels ?? ((request?.videoModelIds?.length ?? 0) > 1)
        const reasoningModelIds = normalizeModelIdsForMode(useMultipleReasoningModels, request?.reasoningModelIds, requestData.aiModel)
        const imageModelIds = normalizeModelIdsForMode(useMultipleImageModels, request?.imageModelIds, requestData.aiImageModel)
        const videoModelIds = normalizeModelIdsForMode(useMultipleVideoModels, request?.videoModelIds, requestData.aiVideoModel)

        if (reasoningModelIds.length === 0) {
            throw new Error('mediaGenerationRequest requires at least one reasoning model')
        }
        if (imageModelIds.length === 0 && videoModelIds.length === 0) {
            throw new Error('mediaGenerationRequest requires at least one image or video generation model')
        }

        return {
            generationRequestId,
            requestGroupKey: buildMediaGenerationRequestGroupKey(
                requestData.workspaceId,
                requestData.aiChatThreadId,
                generationRequestId,
            ),
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
    }): Promise<Partial<ProviderState>> {
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
            imageBranchCandidateSnapshot: requestData.imageBranchCandidateSnapshot,
            referencedFeatureIds: requestData.referencedFeatureIds,
            enableVideoGeneration: requestData.enableVideoGeneration ?? false,
            videoModelMetaInfo: primaryVideoModel?.meta,
            videoModelVersion: primaryVideoModel?.meta.modelVersion,
            videoProviderName: primaryVideoModel?.provider,
            videoAspectRatio: primaryVideoOptions?.aspectRatio,
            videoResolution: primaryVideoOptions?.resolution,
            videoDurationSeconds: primaryVideoOptions?.duration ? Number(primaryVideoOptions.duration) : undefined,
            videoSourceForExtension: normalized.videoSourceForExtension,
            generationRun,
        }

        state = this.applyStatePatch(state, await resolveWorkspaceContext(state, {
            natsService: this.natsService,
            publisher,
            abortSignal: abortController.signal,
        }))
        state = this.applyStatePatch(state, await resolveFeatures(state))
        state = this.applyStatePatch(state, await resolveImageBranch(state, {
            natsService: this.natsService,
            publisher,
            abortSignal: abortController.signal,
        }))
        const mediaBranchLineagePlan = this.lineagePlanner.buildPlan({
            generationRequestId: normalized.generationRequestId,
            reasoningModelIds: normalized.reasoningModelIds,
            imageBranchCandidateSnapshot: state.imageBranchCandidateSnapshot,
            imageBranchResolution: state.imageBranchResolution,
            workspaceContextSnapshot: state.workspaceContextSnapshot,
            createdAt: Date.now(),
        })
        const firstLineageAssignment = this.getRunLineageAssignment(mediaBranchLineagePlan, generationRun.reasoningRunId)
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
        state = this.applyStatePatch(state, { mediaBranchLineagePlan })

        return state
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
