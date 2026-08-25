'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import AiModelModel from './ai-model.ts'

const dynamoDBService = {
    scanItems: vi.fn(),
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItems: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamoDBService
    process.env.ORG_NAME = 'acme'
    process.env.STAGE = 'test'
})

describe('AiModel.getAvailableAiModels', () => {
    it('sorts models by sortingPosition and removes pricing before returning catalog data', async () => {
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    provider: 'Anthropic',
                    model: 'claude-3-opus-20240229',
                    modelVersion: 'claude-3-opus-20240229',
                    providerTitle: 'Anthropic',
                    sortingPosition: 2,
                    modalities: [{ modality: 'text' }],
                    pricing: { input: 99 },
                },
                {
                    provider: 'Google',
                    model: 'gemini-image-1',
                    modelVersion: 'gemini-image-1',
                    providerTitle: 'Google',
                    sortingPosition: 1,
                    modalities: [{ modality: 'image_generation' }],
                    imageSizeMode: 'resolution',
                    imageSizes: [{ value: '768x768' }],
                    pricing: { input: 1 },
                },
                {
                    provider: 'Google',
                    model: 'veo-3.1-generate-preview',
                    modelVersion: 'veo-3.1-generate-preview',
                    providerTitle: 'Google',
                    sortingPosition: 3,
                    modalities: [{ modality: 'video_generation' }],
                    videoGenerationControls: [
                        { key: 'aspectRatio', label: 'Aspect ratio', kind: 'aspect-ratio', options: [{ value: '16:9', label: '16:9' }], defaultValue: '16:9' },
                        { key: 'resolution', label: 'Resolution', kind: 'segmented', options: [{ value: '720p', label: '720p' }], defaultValue: '720p' },
                        { key: 'duration', label: 'Duration', kind: 'segmented', options: [{ value: '8', label: '8' }], defaultValue: '8' },
                    ],
                    pricing: { input: 2 },
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()

        expect(dynamoDBService.scanItems).toHaveBeenCalledWith(expect.objectContaining({
            tableName: expect.any(String),
            limit: 25,
            fetchAllItems: true,
            origin: 'model::AiModel->getAvailableAiModels()',
        }))
        expect(result.models.map((model) => `${model.provider}:${model.model}`)).toEqual([
            'Google:gemini-image-1',
            'Anthropic:claude-3-opus-20240229',
            'Google:veo-3.1-generate-preview',
        ])
        expect(result.models[0]).not.toHaveProperty('pricing')
        expect(result.models[2]).not.toHaveProperty('pricing')

        const imageGroup = result.mediaGenerationConfigMatrix.groups.find((group) => group.mediaType === 'image')
        const videoGroup = result.mediaGenerationConfigMatrix.groups.find((group) => group.mediaType === 'video')

        expect(imageGroup?.groupId).toMatch(/^image:Google:[a-f0-9]{64}$/)
        expect(imageGroup?.title).toBe('Google')
        expect(imageGroup?.controls).toEqual([{
            key: 'imageSize',
            label: 'Resolution',
            kind: 'segmented',
            options: [{ value: '768x768', label: '768x768' }],
            defaultValue: '768x768',
        }])
        // With no model flagged via isDefaultFor, defaults fall back to the first
        // available model of each capability (reasoning = first non-generation model).
        expect(result.defaultModels).toEqual({
            reasoning: 'Anthropic:claude-3-opus-20240229',
            image: 'Google:gemini-image-1',
            video: 'Google:veo-3.1-generate-preview',
        })

        expect(videoGroup?.groupId).toMatch(/^video:Google:[a-f0-9]{64}$/)
        expect(videoGroup?.title).toBe('Google')
        expect(videoGroup?.controls).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'aspectRatio',
                label: 'Aspect ratio',
                defaultValue: '16:9',
                options: [{ value: '16:9', label: '16:9' }],
            }),
            expect.objectContaining({
                key: 'resolution',
                label: 'Resolution',
                defaultValue: '720p',
                options: [{ value: '720p', label: '720p' }],
            }),
            expect.objectContaining({
                key: 'duration',
                label: 'Duration',
                defaultValue: '8',
                options: [{ value: '8', label: '8' }],
            }),
        ]))
    })

    it('groups provider models with matching options and splits different option sets', async () => {
        const matchingImageSizes = [
            { value: '1024x1024', label: '1:1' },
            { value: '1536x1024', label: '3:2' },
        ]
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    provider: 'OpenAI',
                    providerTitle: 'OpenAI',
                    model: 'gpt-image-1.5',
                    modelVersion: 'gpt-image-1.5',
                    sortingPosition: 1,
                    modalities: [{ modality: 'image_generation' }],
                    imageSizeMode: 'resolution',
                    imageSizes: matchingImageSizes,
                    pricing: {},
                },
                {
                    provider: 'OpenAI',
                    providerTitle: 'OpenAI',
                    model: 'gpt-image-2',
                    modelVersion: 'gpt-image-2',
                    sortingPosition: 2,
                    modalities: [{ modality: 'image_generation' }],
                    imageSizeMode: 'resolution',
                    imageSizes: matchingImageSizes,
                    pricing: {},
                },
                {
                    provider: 'OpenAI',
                    providerTitle: 'OpenAI',
                    model: 'gpt-image-mini',
                    modelVersion: 'gpt-image-mini',
                    sortingPosition: 3,
                    modalities: [{ modality: 'image_generation' }],
                    imageSizeMode: 'resolution',
                    imageSizes: [{ value: '1024x1024', label: '1:1' }],
                    pricing: {},
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()
        const imageGroups = result.mediaGenerationConfigMatrix.groups.filter(group => group.mediaType === 'image')
        const sharedOptionsGroup = imageGroups.find(group => group.modelIds.includes('OpenAI:gpt-image-1.5'))
        const differentOptionsGroup = imageGroups.find(group => group.modelIds.includes('OpenAI:gpt-image-mini'))

        expect(imageGroups).toHaveLength(2)
        expect(sharedOptionsGroup?.title).toBe('OpenAI')
        expect(sharedOptionsGroup?.modelIds).toEqual([
            'OpenAI:gpt-image-1.5',
            'OpenAI:gpt-image-2',
        ])
        expect(differentOptionsGroup?.title).toBe('OpenAI')
        expect(differentOptionsGroup?.modelIds).toEqual(['OpenAI:gpt-image-mini'])
        expect(differentOptionsGroup?.groupId).not.toBe(sharedOptionsGroup?.groupId)
    })

    it('keeps option help in the catalog, filters removed video controls, and splits groups with different help text', async () => {
        const videoModel = (model: string, optionDescription: string) => ({
            provider: 'Google',
            providerTitle: 'Google',
            model,
            modelVersion: model,
            sortingPosition: 1,
            modalities: [{ modality: 'video_generation' }],
            videoGenerationControls: [
                {
                    key: 'resolution',
                    label: 'Resolution',
                    kind: 'segmented',
                    defaultValue: '1080p',
                    options: [{ value: '1080p', label: '1080p', description: optionDescription }],
                },
                {
                    key: 'serviceTier',
                    label: 'Service tier',
                    kind: 'segmented',
                    options: [{ value: 'default', label: 'Default' }],
                },
                {
                    key: 'priority',
                    label: 'Task priority',
                    kind: 'segmented',
                    options: [],
                },
            ],
            pricing: {},
        })
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                videoModel('veo-a', '1080p requires an 8 second duration.'),
                videoModel('veo-b', 'This model has a different 1080p constraint.'),
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()
        const videoGroups = result.mediaGenerationConfigMatrix.groups.filter(group => group.mediaType === 'video')

        expect(videoGroups).toHaveLength(2)
        expect(videoGroups.map(group => group.controls)).toEqual([
            [{
                key: 'resolution',
                label: 'Resolution',
                kind: 'segmented',
                defaultValue: '1080p',
                options: [{
                    value: '1080p',
                    label: '1080p',
                    description: '1080p requires an 8 second duration.',
                }],
            }],
            [{
                key: 'resolution',
                label: 'Resolution',
                kind: 'segmented',
                defaultValue: '1080p',
                options: [{
                    value: '1080p',
                    label: '1080p',
                    description: 'This model has a different 1080p constraint.',
                }],
            }],
        ])
    })

    it('derives defaultModels from the isDefaultFor flag regardless of sort order', async () => {
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    provider: 'Anthropic',
                    model: 'claude-sonnet',
                    modelVersion: 'claude-sonnet',
                    sortingPosition: 1,
                    modalities: [{ modality: 'text' }],
                    pricing: {},
                },
                {
                    provider: 'Anthropic',
                    model: 'claude-haiku-4-5',
                    modelVersion: 'claude-haiku-4-5',
                    sortingPosition: 2,
                    modalities: [{ modality: 'text' }],
                    isDefaultFor: ['reasoning'],
                    pricing: {},
                },
                {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    sortingPosition: 3,
                    modalities: [{ modality: 'image_generation' }],
                    isDefaultFor: ['image'],
                    pricing: {},
                },
                {
                    provider: 'Google',
                    model: 'veo-3.1-lite-generate-preview',
                    modelVersion: 'veo-3.1-lite-generate-preview',
                    sortingPosition: 4,
                    modalities: [{ modality: 'video_generation' }],
                    isDefaultFor: ['video'],
                    pricing: {},
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()

        expect(result.defaultModels).toEqual({
            reasoning: 'Anthropic:claude-haiku-4-5',
            image: 'Google:gemini-2.5-flash-image',
            video: 'Google:veo-3.1-lite-generate-preview',
        })
    })
})

describe('AiModel.getAvailableAiModels — settings-configured defaults', () => {
    it('prefers the API-configured default model id over an isDefaultFor flag on a different model', async () => {
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    provider: 'Anthropic',
                    model: 'claude-sonnet',
                    modelVersion: 'claude-sonnet',
                    sortingPosition: 1,
                    modalities: [{ modality: 'text' }],
                    isDefaultFor: ['reasoning'],
                    pricing: {},
                },
                {
                    // Matches settings.aiModels.defaultReasoningModelId exactly.
                    provider: 'Anthropic',
                    model: 'claude-haiku-4-5',
                    modelVersion: 'claude-haiku-4-5',
                    sortingPosition: 2,
                    modalities: [{ modality: 'text' }],
                    pricing: {},
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()

        expect(result.defaultModels.reasoning).toBe('Anthropic:claude-haiku-4-5')
    })

    it('matches a dated snapshot alias against the configured default when no exact id is in the catalog', async () => {
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    // No exact "Anthropic:claude-haiku-4-5" entry, but a dated snapshot of it exists.
                    provider: 'Anthropic',
                    model: 'claude-haiku-4-5-20250815',
                    modelVersion: 'claude-haiku-4-5-20250815',
                    sortingPosition: 1,
                    modalities: [{ modality: 'text' }],
                    pricing: {},
                },
                {
                    provider: 'Anthropic',
                    model: 'claude-haiku-4-5-20250601',
                    modelVersion: 'claude-haiku-4-5-20250601',
                    sortingPosition: 2,
                    modalities: [{ modality: 'text' }],
                    pricing: {},
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()

        // Picks the most recent dated snapshot, not just any match.
        expect(result.defaultModels.reasoning).toBe('Anthropic:claude-haiku-4-5-20250815')
    })

    it('falls back to the isDefaultFor flag when the configured default id is absent from the catalog', async () => {
        dynamoDBService.scanItems.mockResolvedValue({
            items: [
                {
                    provider: 'Anthropic',
                    model: 'claude-sonnet',
                    modelVersion: 'claude-sonnet',
                    sortingPosition: 1,
                    modalities: [{ modality: 'text' }],
                    isDefaultFor: ['reasoning'],
                    pricing: {},
                },
            ],
        })

        const result = await AiModelModel.getAvailableAiModels()

        expect(result.defaultModels.reasoning).toBe('Anthropic:claude-sonnet')
    })
})

describe('AiModel.getAiModel', () => {
    it('omits pricing metadata by default and preserves request contract fields', async () => {
        const modelRecord = {
            provider: 'Google',
            model: 'gemini-2.5-flash-image',
            modelVersion: 'gemini-2.5-flash-image',
            providerTitle: 'Google',
            imageSizeMode: 'resolution',
            imageSizes: [{ value: '1024x1024' }],
            imageReferenceCapabilities: {
                maxReferenceImages: 14,
                maxIdentityReferenceImages: 5,
                conditioningModes: ['edit', 'identity', 'style'],
                inputFidelity: 'provider-managed',
                supportsIterativeEdit: true,
                supportsMask: false,
                supportsStructureControl: true,
                supportsPoseControl: true,
                supportsDeterministicSeed: false,
                maxOutputPixels: 4194304,
                supportedAspectRatios: ['1:1'],
            },
            modalities: [{ modality: 'image_generation' }],
            pricing: {
                input: 0.1,
                output: 0.2,
            },
        }
        dynamoDBService.getItem.mockImplementation(async () => ({ ...modelRecord }))

        const model = await AiModelModel.getAiModel({
            provider: 'Google',
            model: 'gemini-2.5-flash-image',
        })

        expect(dynamoDBService.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { provider: 'Google', model: 'gemini-2.5-flash-image' },
            origin: 'model::AiModel->getAiModel()',
        }))
        expect(model).toMatchObject({
            provider: 'Google',
            model: 'gemini-2.5-flash-image',
            providerTitle: 'Google',
            imageSizeMode: 'resolution',
            imageSizes: [{ value: '1024x1024' }],
            imageReferenceCapabilities: expect.objectContaining({
                maxReferenceImages: 14,
                inputFidelity: 'provider-managed',
            }),
        })
        expect(model).not.toHaveProperty('pricing')
    })

    it('returns pricing metadata when omitPricing is false', async () => {
        dynamoDBService.getItem.mockImplementation(async () => ({
            provider: 'Google',
            model: 'gemini-2.5-flash-image',
            modelVersion: 'gemini-2.5-flash-image',
            pricing: { input: 0.1, output: 0.2 },
        }))

        const model = await AiModelModel.getAiModel({
            provider: 'Google',
            model: 'gemini-2.5-flash-image',
            omitPricing: false,
        })

        expect(model).toHaveProperty('pricing', { input: 0.1, output: 0.2 })
    })

})
