'use strict'

import * as process from 'process'

import {
    getDynamoDbTableStageName,
    type AiModel,
    type AiModelId,
    type AiModelsCatalogResponse,
    type ImageSizeOption,
    type MediaGenerationConfigControl,
    type MediaGenerationConfigGroup,
    type MediaGenerationConfigMatrix,
} from '@lixpi/constants'
import type { Omit, Pick } from 'type-fest'

const {
    ORG_NAME,
    STAGE
} = process.env

const modelHasGenerationModality = (model: Omit<AiModel, 'pricing'>, modality: 'image_generation' | 'video_generation'): boolean =>
    model.modalities?.some(entry => entry.modality === modality) ?? false

const modelIdFor = (model: Pick<AiModel, 'provider' | 'model'>): AiModelId =>
    `${model.provider}:${model.model}` as AiModelId

const normalizeOptions = (options: ImageSizeOption[] | undefined, fallback: ImageSizeOption[]): ImageSizeOption[] => {
    const normalized = (options ?? [])
        .filter(option => typeof option.value === 'string' && option.value.length > 0)
        .map(option => ({
            value: option.value,
            label: option.label || option.value,
        }))

    return normalized.length > 0 ? normalized : fallback
}

const isResolutionValue = (value: string): boolean => /^\d+x\d+$/i.test(value)

const isAspectRatioValue = (value: string): boolean => /^\d+:\d+$/.test(value)

const getImageSizeControlLabel = (model: Omit<AiModel, 'pricing'>): string => {
    if (model.imageSizeMode === 'resolution') return 'Resolution'
    if (model.imageSizeMode === 'aspectRatio') return 'Aspect ratio'

    const values = (model.imageSizes ?? [])
        .map(option => option.value)
        .filter(value => value !== 'auto')
    if (values.some(isResolutionValue)) return 'Resolution'
    if (values.some(isAspectRatioValue)) return 'Aspect ratio'
    return 'Image option'
}

const buildImageControls = (model: Omit<AiModel, 'pricing'>): MediaGenerationConfigControl[] => {
    const options = normalizeOptions(model.imageSizes, [{ value: 'auto', label: 'Auto' }])
    return [{
        key: 'imageSize',
        label: getImageSizeControlLabel(model),
        options,
        defaultValue: options[0]?.value ?? 'auto',
    }]
}

const buildVideoControls = (model: Omit<AiModel, 'pricing'>): MediaGenerationConfigControl[] => {
    const controls: MediaGenerationConfigControl[] = []
    const aspectRatioOptions = normalizeOptions(model.videoAspectRatios, [])
    const resolutionOptions = normalizeOptions(model.videoResolutions, [])
    const durationOptions = normalizeOptions(model.videoDurations, [])

    if (aspectRatioOptions.length > 0) {
        controls.push({
            key: 'aspectRatio',
            label: 'Aspect ratio',
            options: aspectRatioOptions,
            ...(aspectRatioOptions[0]?.value ? { defaultValue: aspectRatioOptions[0].value } : {}),
        })
    }
    if (resolutionOptions.length > 0) {
        controls.push({
            key: 'resolution',
            label: 'Resolution',
            options: resolutionOptions,
            ...(resolutionOptions[0]?.value ? { defaultValue: resolutionOptions[0].value } : {}),
        })
    }
    if (durationOptions.length > 0) {
        controls.push({
            key: 'duration',
            label: 'Duration',
            options: durationOptions,
            ...(durationOptions[0]?.value ? { defaultValue: durationOptions[0].value } : {}),
        })
    }

    return controls
}

const mergeOptionLists = (existingOptions: ImageSizeOption[], incomingOptions: ImageSizeOption[]): ImageSizeOption[] => {
    const mergedOptions = [...existingOptions]
    const seenValues = new Set(mergedOptions.map(option => option.value))

    for (const option of incomingOptions) {
        if (seenValues.has(option.value)) continue
        mergedOptions.push(option)
        seenValues.add(option.value)
    }

    return mergedOptions
}

const getMergedControlLabel = (
    existingControl: MediaGenerationConfigControl,
    incomingControl: MediaGenerationConfigControl,
): string => {
    if (existingControl.label === incomingControl.label) return existingControl.label
    if (existingControl.key === 'imageSize') return 'Image option'
    return existingControl.label
}

const getControlOrder = (control: MediaGenerationConfigControl): number => {
    const controlOrder: MediaGenerationConfigControl['key'][] = ['imageSize', 'aspectRatio', 'resolution', 'duration']
    const index = controlOrder.indexOf(control.key)
    return index === -1 ? controlOrder.length : index
}

const mergeControls = (
    existingControls: MediaGenerationConfigControl[],
    incomingControls: MediaGenerationConfigControl[],
): MediaGenerationConfigControl[] => {
    const controlsByKey = new Map(existingControls.map(control => [control.key, control]))

    for (const incomingControl of incomingControls) {
        const existingControl = controlsByKey.get(incomingControl.key)
        if (!existingControl) {
            existingControls.push({
                ...incomingControl,
                options: [...incomingControl.options],
            })
            continue
        }

        existingControl.label = getMergedControlLabel(existingControl, incomingControl)
        existingControl.options = mergeOptionLists(existingControl.options, incomingControl.options)
        if (!existingControl.defaultValue && incomingControl.defaultValue) {
            existingControl.defaultValue = incomingControl.defaultValue
        }
    }

    return existingControls.sort((a, b) => getControlOrder(a) - getControlOrder(b))
}

const appendMatrixGroup = (
    groupsByKey: Map<string, MediaGenerationConfigGroup>,
    model: Omit<AiModel, 'pricing'>,
    mediaType: 'image' | 'video',
    controls: MediaGenerationConfigControl[],
): void => {
    const key = `${mediaType}:${model.provider}`
    const existingGroup = groupsByKey.get(key)
    if (existingGroup) {
        const modelId = modelIdFor(model)
        if (!existingGroup.modelIds.includes(modelId)) {
            existingGroup.modelIds.push(modelId)
        }
        existingGroup.controls = mergeControls(existingGroup.controls, controls)
        if (!existingGroup.providerTitle && model.providerTitle) {
            existingGroup.providerTitle = model.providerTitle
            existingGroup.title = model.providerTitle
        }
        return
    }

    groupsByKey.set(key, {
        groupId: key,
        mediaType,
        provider: model.provider,
        ...(model.providerTitle ? { providerTitle: model.providerTitle } : {}),
        title: model.providerTitle || model.provider,
        modelIds: [modelIdFor(model)],
        controls,
    })
}

const buildMediaGenerationConfigMatrix = (models: Array<Omit<AiModel, 'pricing'>>): MediaGenerationConfigMatrix => {
    const groupsByKey = new Map<string, MediaGenerationConfigGroup>()
    for (const model of models) {
        if (modelHasGenerationModality(model, 'image_generation')) {
            appendMatrixGroup(groupsByKey, model, 'image', buildImageControls(model))
        }
        if (modelHasGenerationModality(model, 'video_generation')) {
            appendMatrixGroup(groupsByKey, model, 'video', buildVideoControls(model))
        }
    }

    return {
        version: 'media-generation-config-matrix-v1',
        groups: Array.from(groupsByKey.values()),
    }
}

export default {
    getAvailableAiModels: async (): Promise<AiModelsCatalogResponse> => {
        const availableAiModels = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('AI_MODELS_LIST', ORG_NAME, STAGE),
            limit: 25,
            fetchAllItems: true,
            origin: 'model::AiModel->getAvailableAiModels()',
        })

        const models = availableAiModels.items.map((item) => {
            const model = { ...item }
            delete model.pricing
            return model as Omit<AiModel, 'pricing'>
        }).sort((a, b) => a.sortingPosition - b.sortingPosition)

        return {
            models,
            mediaGenerationConfigMatrix: buildMediaGenerationConfigMatrix(models),
        }
    },

    getAiModel: async ({
        provider,
        model,
        omitPricing = true
    }: Pick<AiModel, 'provider' | 'model'> & { omitPricing?: boolean }): Promise<AiModel | Omit<AiModel, 'pricing'> | undefined> => {
        const aiModel = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('AI_MODELS_LIST', ORG_NAME, STAGE),
            key: { provider, model },
            origin: 'model::AiModel->getAiModel()',
        })

        if (!aiModel) return undefined

        if (omitPricing) {
            const modelWithoutPricing = { ...aiModel }
            delete modelWithoutPricing.pricing
            return modelWithoutPricing
        }

        return aiModel
    }
}
