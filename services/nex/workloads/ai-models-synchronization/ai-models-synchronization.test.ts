'use strict'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT,
    MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT,
    PROVIDER_NAMES,
} from '@lixpi/constants'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

import {
    AiModelsSync,
    mapResolutionOptionsToAspectRatioLabels,
} from './ai-models-synchronization.ts'

// =============================================================================
// IMAGE GENERATION OPTION METADATA — resolution vs aspect ratio
// =============================================================================

describe('AiModelsSync — image generation option metadata', () => {
    let sync: any

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
        sync = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
    })

    it('stores GPT Image 2 dimensions as resolution values with readable ratio labels', () => {
        const model = sync.mapOpenAIModelToAiModel({ id: 'gpt-image-2' }, 1)

        expect(model.imageSizeMode).toBe('resolution')
        expect(model.imageSizes?.map((o: any) => o.value)).toEqual(['1024x1024', '1536x1024', '1024x1536', 'auto'])
        expect(model.imageSizes?.map((o: any) => o.label)).toEqual(['1:1', '3:2', '2:3', 'Auto'])
    })

    it('maps only pixel-dimension labels and leaves real resolution tiers unchanged', () => {
        const options = mapResolutionOptionsToAspectRatioLabels([
            { value: '1920x1080', label: '1920x1080' },
            { value: '0x1080', label: 'Invalid dimensions' },
            { value: '720p', label: '720p' },
            { value: '4k', label: '4K' },
            { value: 'adaptive', label: 'Auto' },
        ])

        expect(options).toEqual([
            { value: '1920x1080', label: '16:9' },
            { value: '0x1080', label: 'Invalid dimensions' },
            { value: '720p', label: '720p' },
            { value: '4k', label: '4K' },
            { value: 'adaptive', label: 'Auto' },
        ])
    })

    it('persists the provider value and presentation label together', async () => {
        const putItem = vi.fn(async () => undefined)
        const persistenceSync: any = new AiModelsSync({
            dynamoDBService: { putItem } as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
        const model = persistenceSync.mapOpenAIModelToAiModel({ id: 'gpt-image-2' }, 1)

        await persistenceSync.updateModelsSequentially([model], 'ai-models-test', 'test')

        expect(putItem).toHaveBeenCalledWith(expect.objectContaining({
            tableName: 'ai-models-test',
            item: expect.objectContaining({
                imageSizes: expect.arrayContaining([
                    { value: '1536x1024', label: '3:2' },
                ]),
            }),
        }))
    })

    it('marks Gemini image options as aspect ratios because Google receives imageConfig.aspectRatio', () => {
        const model = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image' }, 1)

        expect(model.imageSizeMode).toBe('aspectRatio')
        expect(model.imageSizes?.map((o: any) => o.value)).toContain('16:9')
    })

    it('synchronizes the current GPT Image 2 reference and configuration controls', () => {
        const gptImage2 = sync.mapOpenAIModelToAiModel({ id: 'gpt-image-2' }, 1)

        expect(gptImage2.imageReferenceCapabilities.inputFidelity).toBe('provider-managed')
        expect(gptImage2.imageReferenceCapabilities.maxReferenceImages).toBe(16)
        expect(gptImage2.imageReferenceCapabilities.maxOutputPixels).toBe(8294400)
        expect(gptImage2.imageGenerationControls.map((control: any) => control.key)).toEqual([
            'imageSize',
            'quality',
            'background',
        ])
    })

    it('synchronizes provider-specific reference controls for non-OpenAI image providers', () => {
        const geminiImage = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image' }, 1)
        const stabilityImage = sync.mapStabilityModelToAiModel({
            id: 'sd3.5-large',
            displayName: 'SD 3.5 Large',
        }, 2)
        const geminiText = sync.mapGoogleModelToAiModel({ name: 'gemini-3.7-flash' }, 3)

        expect(geminiImage.imageReferenceCapabilities.conditioningModes).toContain('identity')
        expect(stabilityImage.imageReferenceCapabilities.conditioningModes).not.toContain('identity')
        expect(stabilityImage.imageGenerationControls).toEqual([{
            key: 'imageSize',
            label: 'Aspect ratio',
            kind: 'aspect-ratio',
            options: stabilityImage.imageSizes,
            defaultValue: '1:1',
            description: 'Controls the output shape for text-to-image and single-reference control requests. Style transfer keeps the source image frame instead.',
        }])
        expect(geminiText.imageReferenceCapabilities).toBeUndefined()
    })
})

// =============================================================================
// INFERENCE CAPABILITIES — provider request behavior synchronized per model
// =============================================================================

describe('AiModelsSync — inference capabilities', () => {
    let sync: any

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
        sync = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
    })

    it('synchronizes Sonnet 5 without temperature and with adaptive thinking', () => {
        const model = sync.mapAnthropicModelToAiModel({ id: 'claude-sonnet-5' }, 1)

        expect(model.inferenceCapabilities).toMatchObject({
            thinkingMode: 'anthropic-adaptive',
            requiresAutoToolChoiceWithThinking: true,
            supportsTemperature: false,
            requiresClosedJsonSchema: false,
            supportedInputKinds: ['image', 'video-frame', 'document-text'],
        })
    })

    it('synchronizes current OpenAI reasoning controls per model family', () => {
        const gpt56 = sync.mapOpenAIModelToAiModel({ id: 'gpt-5.6-sol' }, 1)
        const gpt55Pro = sync.mapOpenAIModelToAiModel({ id: 'gpt-5.5-pro' }, 2)

        expect(gpt56.inferenceCapabilities.supportsTemperature).toBe(false)
        expect(gpt56.reasoningGenerationControls.map((control: any) => control.key)).toEqual([
            'reasoningEffort',
            'reasoningMode',
            'reasoningVerbosity',
        ])
        expect(gpt56.reasoningGenerationControls[0].options.map((option: any) => option.value)).toContain('max')
        expect(gpt55Pro.reasoningGenerationControls[0].options.map((option: any) => option.value)).toEqual([
            'medium',
            'high',
            'xhigh',
        ])
    })

    it('synchronizes provider-native Google thinking modes', () => {
        const gemini25 = sync.mapGoogleModelToAiModel({ name: 'gemini-2.5-flash' }, 1)
        const gemini37 = sync.mapGoogleModelToAiModel({ name: 'gemini-3.7-flash' }, 2)

        expect(gemini25.inferenceCapabilities.thinkingMode).toBe('google-budget')
        expect(gemini25.reasoningGenerationControls).toEqual([])
        expect(gemini37.inferenceCapabilities.thinkingMode).toBe('google-level')
        expect(gemini37.reasoningGenerationControls[0].options.map((option: any) => option.value)).toEqual([
            'low',
            'medium',
            'high',
        ])
    })

    it('synchronizes non-reasoning media models with a closed inference profile', () => {
        const veo = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-generate-preview' }, 1)
        const stability = sync.mapStabilityModelToAiModel({ id: 'sd3.5-large', displayName: 'SD 3.5 Large' }, 2)

        expect(veo.inferenceCapabilities).toMatchObject({
            thinkingMode: 'none',
            supportsTemperature: false,
            supportsSystemPrompt: false,
        })
        expect(stability.inferenceCapabilities).toEqual(veo.inferenceCapabilities)
    })
})

// =============================================================================
// DEFAULT MODEL FLAGS — capability defaults projected to the catalog
// =============================================================================

describe('AiModelsSync — default model flags', () => {
    let sync: any

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
        sync = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
    })

    it('flags the configured default reasoning, image, and video models', () => {
        const haiku = sync.applyDefaultModelFlags(sync.mapAnthropicModelToAiModel({ id: 'claude-haiku-4-5' }, 1))
        const geminiImage = sync.applyDefaultModelFlags(sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image' }, 1))
        const veoLite = sync.applyDefaultModelFlags(sync.mapGoogleModelToAiModel({ name: 'veo-3.1-lite-generate-preview' }, 1))

        expect(haiku.isDefaultFor).toEqual(['reasoning'])
        expect(geminiImage.isDefaultFor).toEqual(['image'])
        expect(veoLite.isDefaultFor).toEqual(['video'])
    })

    it('leaves non-default models without a default flag', () => {
        const sonnet = sync.applyDefaultModelFlags(sync.mapAnthropicModelToAiModel({ id: 'claude-sonnet-4-6' }, 1))

        expect(sonnet.isDefaultFor).toBeUndefined()
    })
})

// =============================================================================
// VEO VIDEO MODEL SYNC — mapping, pricing, option lists, and blacklist removal
// =============================================================================
//
// These exercise the private mapping/config that Phase 1 added for Google VEO.
// We construct AiModelsSync with stub credentials (no network is touched at
// construction) and call the private mapper via an `any` cast — same approach
// the rest of the suite uses for class internals.

describe('AiModelsSync — VEO video model mapping', () => {
    let sync: any

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
        sync = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
    })

    it('maps the veo-3.1 preview family with friendly names and correct pricing', () => {
        const v31 = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-generate-preview' }, 3)
        expect(v31.title).toBe('Veo 3.1')
        expect(v31.pricing.video?.price).toBe('0.40')
        expect(v31.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p', '4k'])
        expect(v31.videoDurations?.map((o: any) => o.value)).toEqual(['4', '6', '8'])

        const lite = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-lite-generate-preview' }, 4)
        expect(lite.title).toBe('Veo 3.1 Lite')
        expect(lite.pricing.video?.price).toBe('0.10')
        expect(lite.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p'])
        expect(lite.videoDurations?.map((o: any) => o.value)).toEqual(['4', '6', '8'])

        const fast = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-fast-generate-preview' }, 5)
        expect(fast.title).toBe('Veo 3.1 Fast')
        expect(fast.pricing.video?.price).toBe('0.15')
        expect(fast.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p', '4k'])
        expect(fast.videoDurations?.map((o: any) => o.value)).toEqual(['4', '6', '8'])

        const controlsByKey = new Map(v31.videoGenerationControls.map((control: any) => [control.key, control]))
        expect(controlsByKey.get('resolution').options.find((option: any) => option.value === '1080p')).toMatchObject({
            description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.resolution?.['1080p'],
        })
        expect(controlsByKey.get('resolution').options.find((option: any) => option.value === '4k')).toMatchObject({
            description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.resolution?.['4k'],
        })
        expect(controlsByKey.get('duration')).toMatchObject({ kind: 'duration' })
        expect(controlsByKey.get('duration').options.find((option: any) => option.value === '8')).toMatchObject({
            description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.duration?.['8'],
        })
    })

    it('does NOT give gemini text models any video modality, options, or pricing (regression)', () => {
        const gemini = sync.mapGoogleModelToAiModel({ name: 'gemini-3.7-flash' }, 6)
        const modalities = gemini.modalities.map((m: any) => m.modality)

        expect(modalities).not.toContain('video_generation')
        expect(modalities).not.toContain('video')
        expect(gemini.videoAspectRatios).toBeUndefined()
        expect(gemini.videoResolutions).toBeUndefined()
        expect(gemini.videoDurations).toBeUndefined()
        expect(gemini.pricing.video).toBeUndefined()
    })

    it('keeps reviewed VEO models while explicitly retiring shut-down ids', async () => {
        const retiredVideoModels = (AiModelsSync as any).GOOGLE_RETIRED_VIDEO_MODELS
        expect([...retiredVideoModels]).toEqual(expect.arrayContaining([
            'veo-2.0-generate-001',
            'veo-3.0-generate-001',
            'veo-3.0-fast-generate-001',
        ]))

        const originalGoogle = sync.google
        sync.google = {
            models: {
                list: vi.fn(async () => ({
                    async *[Symbol.asyncIterator]() {
                        yield { name: 'models/veo-2.0-generate-001' }
                        yield { name: 'models/veo-3.0-generate-001' }
                        yield { name: 'models/veo-3.0-fast-generate-001' }
                        yield { name: 'models/veo-3.1-generate-preview' }
                        yield { name: 'models/veo-3.1-fast-generate-preview' }
                        yield { name: 'models/veo-3.1-lite-generate-preview' }
                    },
                })),
            },
        }
        try {
            const models = await sync.fetchGoogleModels()
            expect(models.map((model: any) => model.name)).toEqual([
                'veo-3.1-generate-preview',
                'veo-3.1-fast-generate-preview',
                'veo-3.1-lite-generate-preview',
            ])
        } finally {
            sync.google = originalGoogle
        }
    })

    it('keeps existing image models intact (regression) — Nano Banana mapping unchanged', () => {
        const nano = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image' }, 7)
        const modalities = nano.modalities.map((m: any) => m.modality)
        expect(modalities).toContain('image_generation')
        expect(modalities).not.toContain('video_generation')
        expect(nano.title).toBe('Gemini 3.1 Flash Image')
    })

    it('does NOT give VEO models a reference cap (absent => provider-aware default of 3)', () => {
        const veo = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-generate-preview' }, 8)
        expect(veo.videoMaxReferenceImages).toBeUndefined()
    })
})

// =============================================================================
// BYTEPLUS / SEEDANCE VIDEO MODEL SYNC — static injection (mirrors VEO)
// =============================================================================

describe('AiModelsSync — BytePlus Seedance video model mapping', () => {
    let sync: any

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
        sync = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
    })

    it('registers BytePlus as a provider name', () => {
        expect(PROVIDER_NAMES).toContain('BytePlus')
    })

    it('exposes every approved Seedance model in the static list', () => {
        const ids = sync.getBytePlusModels().map((m: any) => m.id)
        expect(ids).toEqual([
            'dreamina-seedance-2-0-260128',
            'dreamina-seedance-2-0-fast-260128',
            'dreamina-seedance-2-0-mini-260615',
            'dreamina-seedance-2-5-260628',
        ])
    })

    it('maps dreamina-seedance-2-0-260128 with video modalities, token pricing, option lists, and a 9-image reference cap', () => {
        const model = sync.mapBytePlusModelToAiModel({ id: 'dreamina-seedance-2-0-260128', displayName: 'Seedance 2.0' }, 1)
        const modalities = model.modalities.map((m: any) => m.modality)

        expect(model.provider).toBe('BytePlus')
        expect(modalities).toContain('video_generation')
        expect(modalities).toContain('video')
        expect(modalities).not.toContain('image_generation')

        expect(model.pricing.video?.measuringUnit).toBe('tokens')
        expect(model.pricing.video?.pricePer).toBe('1000000')
        expect(model.pricing.video?.price).toBe('7.7')

        expect(model.videoAspectRatios?.map((o: any) => o.value)).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
        expect(model.videoResolutions?.map((o: any) => o.value)).toEqual(['480p', '720p', '1080p', '4k'])
        expect(model.videoResolutions?.map((o: any) => o.label)).toEqual(['480p', '720p', '1080p', '4K'])
        expect(model.videoDurations?.map((o: any) => o.value)).toEqual(['-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'])
        expect(model.videoMaxReferenceImages).toBe(9)

        const controlsByKey = new Map(model.videoGenerationControls.map((control: any) => [control.key, control]))
        expect([...controlsByKey.keys()]).not.toContain('serviceTier')
        expect([...controlsByKey.keys()]).not.toContain('priority')
        expect(controlsByKey.get('aspectRatio')).toMatchObject({ defaultValue: 'adaptive' })
        expect(controlsByKey.get('duration')).toMatchObject({ kind: 'duration' })
        expect(controlsByKey.get('duration').options.find((option: any) => option.value === '-1')).toMatchObject({
            description: 'Smart length lets Seedance choose any duration from 4 to 15 seconds.',
        })
        expect([...controlsByKey.keys()]).not.toContain('cameraFixed')
        expect(controlsByKey.get('generateAudio')).toMatchObject({
            kind: 'toggle',
            defaultValue: 'true',
            description: MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.generateAudio,
        })
        expect(controlsByKey.get('watermark')).toMatchObject({
            description: MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.watermark,
        })
        expect(controlsByKey.get('returnLastFrame')).toMatchObject({
            description: MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.returnLastFrame,
        })

        expect(model.title).toBe('Seedance 2.0')
        expect(model.shortTitle).toBe('Seedance 2.0')
    })

    it('maps the fast variant to the cheaper per-1M-token price and a Fast title', () => {
        const model = sync.mapBytePlusModelToAiModel({ id: 'dreamina-seedance-2-0-fast-260128', displayName: 'Seedance 2.0 Fast' }, 2)
        expect(model.pricing.video?.measuringUnit).toBe('tokens')
        expect(model.pricing.video?.price).toBe('5.6')
        expect(model.videoMaxReferenceImages).toBe(9)
        expect(model.title).toBe('Seedance 2.0 Fast')
        expect(model.shortTitle).toBe('Seedance 2.0 Fast')
    })

    it('maps Seedance 2.0 Mini with its 720p ceiling, 9-image cap, and lower pricing tier', () => {
        const model = sync.mapBytePlusModelToAiModel({
            id: 'dreamina-seedance-2-0-mini-260615',
            displayName: 'Seedance 2.0 Mini',
        }, 3)

        expect(model.videoResolutions?.map((option: any) => option.value)).toEqual(['480p', '720p'])
        expect(model.videoDurations?.map((option: any) => option.value)).toEqual([
            '-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
        ])
        expect(model.videoMaxReferenceImages).toBe(9)
        expect(model.pricing.video).toMatchObject({
            measuringUnit: 'tokens',
            pricePer: '1000000',
            price: '3.5',
            tiers: {
                '480p': { withoutVideoInput: '3.5', withVideoInput: '2.1' },
                '720p': { withoutVideoInput: '3.5', withVideoInput: '2.1' },
            },
        })
        expect(model.title).toBe('Seedance 2.0 Mini')
        expect(model.shortTitle).toBe('Seedance 2.0 Mini')
    })

    it('maps Seedance 2.5 with its 30-second range, MOV control, reference cap, and pricing tiers', () => {
        const model = sync.mapBytePlusModelToAiModel({
            id: 'dreamina-seedance-2-5-260628',
            displayName: 'Seedance 2.5',
        }, 3)
        const controlsByKey = new Map(model.videoGenerationControls.map((control: any) => [control.key, control]))

        expect(model.videoResolutions?.map((option: any) => option.value)).toEqual(['480p', '720p', '1080p'])
        expect(model.videoDurations?.map((option: any) => option.value)).toEqual([
            '-1',
            ...Array.from({ length: 27 }, (_, index) => String(index + 4)),
        ])
        expect(model.videoMaxReferenceImages).toBe(30)
        expect(model.pricing.video).toMatchObject({
            measuringUnit: 'tokens',
            pricePer: '1000000',
            price: '11.7',
            tiers: {
                '480p': { withoutVideoInput: '10.7', withVideoInput: '6.4' },
                '720p': { withoutVideoInput: '10.7', withVideoInput: '6.4' },
                '1080p': { withoutVideoInput: '11.7', withVideoInput: '7.0' },
            },
        })
        expect(controlsByKey.get('outputFormat')).toMatchObject({
            kind: 'segmented',
            defaultValue: 'mov',
            options: [
                { value: 'mp4', label: 'MP4' },
                expect.objectContaining({ value: 'mov', label: 'MOV' }),
            ],
        })
        expect(controlsByKey.get('generateAudio')).toMatchObject({ defaultValue: 'true' })
        expect(model.title).toBe('Seedance 2.5')
        expect(model.shortTitle).toBe('Seedance 2.5')
    })
})

// =============================================================================
// ANTHROPIC MODEL FETCH FAILURE MODES
// =============================================================================

describe('AiModelsSync — Anthropic model fetch failure modes', () => {
    const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
    let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeAll(() => {
        process.env.ORG_NAME = process.env.ORG_NAME || 'test-org'
        process.env.STAGE = process.env.STAGE || 'test'
    })

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleWarnSpy?.mockRestore()
        consoleWarnSpy = null
        if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
        else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
    })

    it('requires an Anthropic API key', async () => {
        delete process.env.ANTHROPIC_API_KEY
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: '',
            googleApiKey: 'test-key',
        })

        await expect(sync.fetchAnthropicModels()).rejects.toThrow('Anthropic API key is required but not provided')
    })

    it('keeps exact dated Anthropic model ids when filtering the Bedrock catalog', () => {
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
        const projected = sync.projectBedrockAnthropicModel(
            'anthropic.claude-haiku-4-5-20251001-v1:0',
            'Claude Haiku 4.5',
        )
        const models = sync.filterAnthropicModels([projected], true)

        expect(models).toEqual([{
            id: 'claude-haiku-4-5-20251001',
            display_name: 'Claude Haiku 4.5',
            created_at: '2025-10-01',
        }])
        expect(sync.mapAnthropicModelToAiModel(models[0], 1)).toMatchObject({
            provider: 'Anthropic',
            model: 'claude-haiku-4-5-20251001',
            modelVersion: 'claude-haiku-4-5-20251001',
        })
    })

    it('keeps current pinned dateless Anthropic model ids from the Bedrock catalog', () => {
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
        const projected = sync.projectBedrockAnthropicModel(
            'anthropic.claude-sonnet-5',
            'Claude Sonnet 5',
        )
        const models = sync.filterAnthropicModels([projected], true)

        expect(models).toEqual([{
            id: 'claude-sonnet-5',
            display_name: 'Claude Sonnet 5',
        }])
        expect(sync.mapAnthropicModelToAiModel(models[0], 1)).toMatchObject({
            provider: 'Anthropic',
            model: 'claude-sonnet-5',
            modelVersion: 'claude-sonnet-5',
            title: 'Claude Sonnet 5',
            shortTitle: 'Sonnet 5',
            contextWindow: 1000000,
            maxCompletionSize: 128000,
        })
    })

    it('rejects Bedrock compatibility aliases that are not invocable base model ids', () => {
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })

        expect(sync.projectBedrockAnthropicModel(
            'anthropic.claude-3-haiku-20240307-v1:0:48k',
            'Claude 3 Haiku',
        )).toBeUndefined()
        expect(sync.projectBedrockAnthropicModel(
            'anthropic.claude-3-haiku-20240307-v1:0:200k',
            'Claude 3 Haiku',
        )).toBeUndefined()
    })

    it('propagates errors from models.list()', async () => {
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
        sync.anthropic.models = {
            list: async () => { throw new Error('upstream unavailable') },
        }

        await expect(sync.fetchAnthropicModels()).rejects.toThrow('upstream unavailable')
    })

    it('throws when the models.list() method is unavailable on the SDK client', async () => {
        const sync: any = new AiModelsSync({
            dynamoDBService: {} as any,
            openaiApiKey: 'test-key',
            anthropicApiKey: 'test-key',
            googleApiKey: 'test-key',
        })
        sync.anthropic.models = undefined

        await expect(sync.fetchAnthropicModels()).rejects.toThrow('Anthropic models list endpoint returned no models')
    })
})
