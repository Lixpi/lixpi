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
                    videoAspectRatios: [{ value: '16:9' }],
                    videoResolutions: [{ value: '720p' }],
                    videoDurations: [{ value: '8' }],
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

        expect(imageGroup?.groupId).toBe('image:Google')
        expect(imageGroup?.controls).toEqual([{
            key: 'imageSize',
            label: 'Resolution',
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

        expect(videoGroup?.groupId).toBe('video:Google')
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
