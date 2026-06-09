'use strict'

import { v4 as uuid } from 'uuid'
import { info, warn } from '@lixpi/debug-tools'
import type {
    AiInteractionMediaGenerationRequest,
    AiModel,
    AiModelId,
    ImageGenerationSize,
    ProviderName,
} from '@lixpi/constants'

import AiModelModel from '../../models/ai-model.ts'
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
    reasoningModelIds: AiModelId[]
    imageModelIds: AiModelId[]
    videoModelIds: AiModelId[]
    imageSize: ImageGenerationSize
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string | number
    videoSourceForExtension?: string
}

type ResolvedMatrixRequest = NormalizedMatrixRequest & {
    reasoningModels: ResolvedAiModel[]
    imageModels: ResolvedAiModel[]
    videoModels: ResolvedAiModel[]
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

export const buildMediaGenerationRequestGroupKey = (
    workspaceId: string,
    aiChatThreadId: string,
    generationRequestId: string,
): string => `${workspaceId}:${aiChatThreadId}:${generationRequestId}`

export const buildMediaGenerationThreadGroupPrefix = (
    workspaceId: string,
    aiChatThreadId: string,
): string => `${workspaceId}:${aiChatThreadId}:`

const buildReasoningRunId = (generationRequestId: string, reasoningIndex: number): string =>
    `${generationRequestId}:reasoning:${reasoningIndex}`

const buildReasoningInstanceKey = (requestGroupKey: string, reasoningIndex: number): string =>
    `${requestGroupKey}:reasoning:${reasoningIndex}`

export class MediaGenerationMatrixOrchestrator {
    constructor(private readonly registry: ProviderRegistry) {}

    async process(requestData: MatrixRequestData): Promise<void> {
        const normalized = await this.resolveRequest(this.normalizeRequest(requestData))
        const primaryImageModel = normalized.imageModels[0]
        const primaryVideoModel = normalized.videoModels[0]
        const normalizedVideoAspectRatio = normalizeModelOption(requestData.videoAspectRatio ?? normalized.videoAspectRatio, primaryVideoModel?.meta.videoAspectRatios)
        const normalizedVideoResolution = normalizeModelOption(requestData.videoResolution ?? normalized.videoResolution, primaryVideoModel?.meta.videoResolutions)
        const normalizedVideoDuration = normalizeModelOption(requestData.videoDuration ?? normalized.videoDuration, primaryVideoModel?.meta.videoDurations)

        info('[MEDIA_MATRIX] Starting media generation matrix request', {
            generationRequestId: normalized.generationRequestId,
            aiChatThreadId: requestData.aiChatThreadId,
            reasoningCount: normalized.reasoningModels.length,
            imageModelCount: normalized.imageModels.length,
            videoModelCount: normalized.videoModels.length,
        })

        await Promise.all(normalized.reasoningModels.map((reasoningModel, reasoningIndex) => {
            const reasoningRunId = buildReasoningRunId(normalized.generationRequestId, reasoningIndex)
            const instanceKey = buildReasoningInstanceKey(normalized.requestGroupKey, reasoningIndex)
            return this.registry.process(instanceKey, reasoningModel.provider, {
                ...requestData,
                aiModelMetaInfo: reasoningModel.meta,
                imageModelMetaInfo: primaryImageModel?.meta,
                videoModelMetaInfo: primaryVideoModel?.meta,
                imageSize: normalized.imageSize,
                videoAspectRatio: normalizedVideoAspectRatio,
                videoResolution: normalizedVideoResolution,
                videoDurationSeconds: normalizedVideoDuration ? Number(normalizedVideoDuration) : undefined,
                videoSourceForExtension: normalized.videoSourceForExtension,
                mediaGenerationRequest: {
                    requestVersion: 'media-generation-matrix-v1',
                    generationRequestId: normalized.generationRequestId,
                    reasoningModelIds: normalized.reasoningModelIds,
                    imageModelIds: normalized.imageModelIds,
                    videoModelIds: normalized.videoModelIds,
                    imageOptions: { imageSize: normalized.imageSize },
                    videoOptions: {
                        ...(normalizedVideoAspectRatio ? { aspectRatio: normalizedVideoAspectRatio } : {}),
                        ...(normalizedVideoResolution ? { resolution: normalizedVideoResolution } : {}),
                        ...(normalizedVideoDuration ? { duration: normalizedVideoDuration } : {}),
                        ...(normalized.videoSourceForExtension ? { sourceForExtension: normalized.videoSourceForExtension } : {}),
                    },
                },
                generationRun: {
                    generationRequestId: normalized.generationRequestId,
                    reasoningRunId,
                    reasoningModelId: reasoningModel.modelId,
                    reasoningIndex,
                },
                eventMeta: {
                    ...(requestData.eventMeta ?? {}),
                    generationRequestId: normalized.generationRequestId,
                    reasoningRunId,
                    reasoningModelId: reasoningModel.modelId,
                    reasoningIndex,
                },
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
        const reasoningModelIds = uniqueModelIds(request?.reasoningModelIds?.length ? request.reasoningModelIds : [requestData.aiModel])
        const imageModelIds = uniqueModelIds(request?.imageModelIds?.length ? request.imageModelIds : [requestData.aiImageModel])
        const videoModelIds = uniqueModelIds(request?.videoModelIds?.length ? request.videoModelIds : [requestData.aiVideoModel])

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
            reasoningModelIds,
            imageModelIds,
            videoModelIds,
            imageSize: (request?.imageOptions?.imageSize ?? requestData.imageSize ?? 'auto') as ImageGenerationSize,
            videoAspectRatio: request?.videoOptions?.aspectRatio ?? requestData.videoAspectRatio,
            videoResolution: request?.videoOptions?.resolution ?? requestData.videoResolution,
            videoDuration: request?.videoOptions?.duration ?? requestData.videoDuration,
            videoSourceForExtension: request?.videoOptions?.sourceForExtension ?? requestData.videoSourceForExtension,
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

        if (normalized.imageModelIds.length > 1 || normalized.videoModelIds.length > 1) {
            warn('[MEDIA_MATRIX] Media model fanout is deferred to Phase 5; Phase 4 routes each reasoning run to the first selected media model.', {
                generationRequestId: normalized.generationRequestId,
                imageModelCount: normalized.imageModelIds.length,
                videoModelCount: normalized.videoModelIds.length,
            })
        }

        return {
            ...normalized,
            reasoningModels,
            imageModels,
            videoModels,
        }
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
}
