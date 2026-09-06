import { createHash } from 'node:crypto'
import * as process from 'process'

import {
    getDynamoDbTableStageName,
    type AiModel,
    type AiModelId,
    type AiModelsCatalogResponse,
    type DefaultAiModelCapability,
    type DefaultAiModelSelection,
    type ImageSizeOption,
    type MediaGenerationConfigControl,
    type MediaGenerationConfigControlKey,
    type MediaGenerationConfigGroup,
    type MediaGenerationConfigMatrix,
} from '@lixpi/constants'

import { settings } from '../settings.ts'

const {
    ORG_NAME,
    STAGE,
} = process.env

const modelHasGenerationModality = (
    model: Omit<AiModel, 'pricing'>,
    modality: 'image_generation' | 'video_generation',
): boolean => model.modalities?.some(entry => entry.modality === modality) ?? false

const modelIdFor = (model: Pick<AiModel, 'provider' | 'model'>): AiModelId => `${model.provider}:${model.model}` as AiModelId

const findConfiguredCatalogModel = (
    models: Array<Omit<AiModel, 'pricing'>>,
    configuredModelId: AiModelId,
    matchesCapability: (model: Omit<AiModel, 'pricing'>) => boolean,
): Omit<AiModel, 'pricing'> | undefined => {
    const exactModel = models.find(model => modelIdFor(model) === configuredModelId && matchesCapability(model))

    if (exactModel)
        return exactModel

    const separatorIndex = configuredModelId.indexOf(':')
    const configuredProvider = configuredModelId.slice(0, separatorIndex)
    const configuredModelAlias = configuredModelId.slice(separatorIndex + 1)
    const snapshotPrefix = `${configuredModelAlias}-`

    return models.filter(model => {
        if (
            model.provider !== configuredProvider
            || !matchesCapability(model)
        )
            return false

        if (!model.model.startsWith(snapshotPrefix))
            return false

        return /^\d{8}$/.test(
            model.model.slice(snapshotPrefix.length),
        )
    })
        .sort((left, right) => right.model.localeCompare(left.model))[0]
}

const normalizeOptions = (
    options: ImageSizeOption[] | undefined,
    fallback: ImageSizeOption[],
): ImageSizeOption[] => {
    const normalized = (options ?? []).filter(option => typeof option.value === 'string' && option.value.length > 0).map(
        option => ({
            value: option.value,
            label: option.label || option.value,
            ...(option.description ? { description: option.description } : {}),
        }),
    )

    return normalized.length > 0 ? normalized : fallback
}

const isResolutionValue = (value: string): boolean => /^\d+x\d+$/i.test(value)

const isAspectRatioValue = (value: string): boolean => /^\d+:\d+$/.test(value)

const getImageSizeControlLabel = (model: Omit<AiModel, 'pricing'>): string => {
    if (model.imageSizeMode === 'resolution')
        return 'Resolution'

    if (model.imageSizeMode === 'aspectRatio')
        return 'Aspect ratio'

    const values = (model.imageSizes ?? []).map(option => option.value).filter(value => value !== 'auto')

    if (values.some(isResolutionValue))
        return 'Resolution'

    if (values.some(isAspectRatioValue))
        return 'Aspect ratio'

    return 'Image option'
}

const buildImageControls = (model: Omit<AiModel, 'pricing'>): MediaGenerationConfigControl[] => {
    if (model.imageGenerationControls?.length) {
        return model.imageGenerationControls.map(
            control => ({
                ...control,
                options: control.options.map(option => ({ ...option })),
            }),
        )
    }

    const options = normalizeOptions(
        model.imageSizes,
        [{
            value: 'auto',
            label: 'Auto',
        }],
    )
    const concreteValues = options.map(option => option.value).filter(value => value !== 'auto')
    const usesAspectRatios = model.imageSizeMode === 'aspectRatio'
        || (model.imageSizeMode === undefined
            && concreteValues.length > 0
            && concreteValues.every(isAspectRatioValue))

    return [{
        key: 'imageSize',
        label: getImageSizeControlLabel(model),
        kind: usesAspectRatios ? 'aspect-ratio' : 'segmented',
        options,
        defaultValue: options[0]?.value ?? 'auto',
    }]
}

const SUPPORTED_MEDIA_GENERATION_CONTROL_KEYS = new Set<MediaGenerationConfigControlKey>([
    'imageSize',
    'aspectRatio',
    'resolution',
    'duration',
    'outputFormat',
    'outputCount',
    'generateAudio',
    'negativePrompt',
    'personGeneration',
    'watermark',
    'returnLastFrame',
    'background',
    'quality',
    'reasoningEffort',
    'reasoningMode',
    'reasoningVerbosity',
    'thinkingLevel',
])

const buildReasoningControls = (model: Omit<AiModel, 'pricing'>): MediaGenerationConfigControl[] =>
    (model.reasoningGenerationControls ?? []).filter(control => SUPPORTED_MEDIA_GENERATION_CONTROL_KEYS.has(control.key)).map(
        control => ({
            ...control,
            options: control.options.map(option => ({ ...option })),
        }),
    )

const buildVideoControls = (model: Omit<AiModel, 'pricing'>): MediaGenerationConfigControl[] => {
    return (model.videoGenerationControls ?? []).filter(control => SUPPORTED_MEDIA_GENERATION_CONTROL_KEYS.has(control.key)).map(
        control => ({
            ...control,
            options: control.options.map(option => ({ ...option })),
        }),
    )
}

const getControlOptionsSignature = (controls: MediaGenerationConfigControl[]): string => {
    return JSON.stringify(
        controls.map(
            control => [
                control.key,
                control.label,
                control.kind,
                control.defaultValue ?? null,
                control.description ?? null,
                control.readOnly ?? false,
                control.options.map(option => [option.value, option.label, option.description ?? null]),
            ],
        ),
    )
}

const getMatrixGroupKey = (
    model: Omit<AiModel, 'pricing'>,
    mediaType: 'reasoning' | 'image' | 'video',
    controls: MediaGenerationConfigControl[],
): string => {
    const optionsHash = createHash('sha256')
        .update(
            getControlOptionsSignature(controls),
        )
        .digest('hex')

    return `${mediaType}:${model.provider}:${optionsHash}`
}

const appendMatrixGroup = (
    groupsByKey: Map<string, MediaGenerationConfigGroup>,
    model: Omit<AiModel, 'pricing'>,
    mediaType: 'reasoning' | 'image' | 'video',
    controls: MediaGenerationConfigControl[],
): void => {
    const modelId = modelIdFor(model)
    const key = getMatrixGroupKey(
        model,
        mediaType,
        controls,
    )
    const existingGroup = groupsByKey.get(key)

    if (existingGroup) {
        if (!existingGroup.modelIds.includes(modelId))
            existingGroup.modelIds.push(modelId)

        if (
            !existingGroup.providerTitle
            && model.providerTitle
        ) {
            existingGroup.providerTitle = model.providerTitle
            existingGroup.title = model.providerTitle
        }

        return
    }

    groupsByKey.set(
        key,
        {
            groupId: key,
            mediaType,
            provider: model.provider,
            ...(model.providerTitle ? { providerTitle: model.providerTitle } : {}),
            title: model.providerTitle || model.provider,
            modelIds: [modelId],
            controls,
        },
    )
}

// Derive the default model id per capability from the catalog. API-configured
// defaults win when available, followed by synchronization flags and then
// the first model matching the requested capability.
const resolveDefaultModels = (models: Array<Omit<AiModel, 'pricing'>>): DefaultAiModelSelection => {
    const isReasoningModel = (model: Omit<AiModel, 'pricing'>): boolean => !modelHasGenerationModality(model, 'image_generation') && !modelHasGenerationModality(
        model,
        'video_generation',
    )

    const resolve = (
        capability: DefaultAiModelCapability,
        matches: (model: Omit<AiModel, 'pricing'>) => boolean,
        configuredModelId?: AiModelId,
    ): AiModelId => {
        const configured = configuredModelId
            ? findConfiguredCatalogModel(
                models,
                configuredModelId,
                matches,
            )
            : undefined
        const flagged = models.find(model => model.isDefaultFor?.includes(capability))
        const resolved = configured
            ?? flagged
            ?? models.find(matches)

        return resolved ? modelIdFor(resolved) : ('' as AiModelId)
    }

    return {
        reasoning: resolve(
            'reasoning',
            isReasoningModel,
            settings.aiModels.defaultReasoningModelId,
        ),
        image: resolve(
            'image',
            model => modelHasGenerationModality(model, 'image_generation'),
            settings.aiModels.defaultImageModelId,
        ),
        video: resolve(
            'video',
            model => modelHasGenerationModality(model, 'video_generation'),
            settings.aiModels.defaultVideoModelId,
        ),
    }
}

const buildMediaGenerationConfigMatrix = (models: Array<Omit<AiModel, 'pricing'>>): MediaGenerationConfigMatrix => {
    const groupsByKey = new Map<string, MediaGenerationConfigGroup>()

    for (const model of models) {
        const isMediaGenerationModel = modelHasGenerationModality(model, 'image_generation')
            || modelHasGenerationModality(model, 'video_generation')

        if (!isMediaGenerationModel)
            appendMatrixGroup(
                groupsByKey,
                model,
                'reasoning',
                buildReasoningControls(model),
            )

        if (modelHasGenerationModality(model, 'image_generation'))
            appendMatrixGroup(
                groupsByKey,
                model,
                'image',
                buildImageControls(model),
            )

        if (modelHasGenerationModality(model, 'video_generation'))
            appendMatrixGroup(
                groupsByKey,
                model,
                'video',
                buildVideoControls(model),
            )
    }

    return {
        version: 'media-generation-config-matrix-v1',
        groups: Array.from(
            groupsByKey.values(),
        ),
    }
}

export default {
    getAvailableAiModels: async (): Promise<AiModelsCatalogResponse> => {
        const availableAiModels = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName(
                'AI_MODELS_LIST',
                ORG_NAME,
                STAGE,
            ),
            limit: 25,
            fetchAllItems: true,
            origin: 'model::AiModel->getAvailableAiModels()',
        })

        const models = availableAiModels.items.map(item => {
            const model = { ...item }
            delete model.pricing

            return model as Omit<AiModel, 'pricing'>
        }).sort((a, b) => a.sortingPosition - b.sortingPosition)

        return {
            models,
            mediaGenerationConfigMatrix: buildMediaGenerationConfigMatrix(models),
            defaultModels: resolveDefaultModels(models),
        }
    },
    getAiModel: async ({
        provider,
        model,
        omitPricing = true,
    }: Pick<AiModel, 'provider' | 'model'> & { omitPricing?: boolean }): Promise<AiModel | Omit<AiModel, 'pricing'> | undefined> => {
        const aiModel = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName(
                'AI_MODELS_LIST',
                ORG_NAME,
                STAGE,
            ),
            key: {
                provider,
                model,
            },
            origin: 'model::AiModel->getAiModel()',
        })

        if (!aiModel)
            return undefined

        if (omitPricing) {
            const modelWithoutPricing = { ...aiModel }
            delete modelWithoutPricing.pricing

            return modelWithoutPricing
        }

        return aiModel
    },
}
