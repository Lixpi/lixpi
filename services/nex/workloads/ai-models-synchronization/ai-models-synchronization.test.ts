'use strict'

import { describe, it, expect, beforeAll } from 'vitest'

import { PROVIDER_NAMES } from '@lixpi/constants'

import { AiModelsSync } from './ai-models-synchronization.ts'

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

    it('marks OpenAI image options as resolutions and labels them with pixel values', () => {
        const model = sync.mapOpenAIModelToAiModel({ id: 'gpt-image-1' }, 1)

        expect(model.imageSizeMode).toBe('resolution')
        expect(model.imageSizes?.map((o: any) => o.value)).toEqual(['1024x1024', '1536x1024', '1024x1536', 'auto'])
        expect(model.imageSizes?.map((o: any) => o.label)).toEqual(['1024x1024', '1536x1024', '1024x1536', 'Auto'])
    })

    it('marks Gemini image options as aspect ratios because Google receives imageConfig.aspectRatio', () => {
        const model = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image-preview' }, 1)

        expect(model.imageSizeMode).toBe('aspectRatio')
        expect(model.imageSizes?.map((o: any) => o.value)).toContain('16:9')
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

    it('maps veo-3.0-generate-001 with video + video_generation modalities, per-second pricing, and safe option lists', () => {
        const model = sync.mapGoogleModelToAiModel({ name: 'veo-3.0-generate-001' }, 1)
        const modalities = model.modalities.map((m: any) => m.modality)

        expect(modalities).toContain('video_generation')
        expect(modalities).toContain('video')
        expect(modalities).not.toContain('image_generation')

        expect(model.pricing.video?.measuringUnit).toBe('seconds')
        expect(model.pricing.video?.price).toBe('0.40')

        expect(model.videoAspectRatios?.map((o: any) => o.value)).toEqual(['16:9', '9:16'])
        expect(model.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p'])
        expect(model.videoDurations?.map((o: any) => o.value)).toEqual(['8'])

        expect(model.title).toBe('Veo 3')
        expect(model.shortTitle).toBe('Veo 3')
    })

    it('maps the fast variant to the cheaper per-second price and a Fast title (prefix order matters)', () => {
        const model = sync.mapGoogleModelToAiModel({ name: 'veo-3.0-fast-generate-001' }, 2)
        expect(model.pricing.video?.price).toBe('0.15')
        expect(model.title).toBe('Veo 3 Fast')
    })

    it('maps the veo-3.1 preview family with friendly names and correct pricing', () => {
        const v31 = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-generate-preview' }, 3)
        expect(v31.title).toBe('Veo 3.1')
        expect(v31.pricing.video?.price).toBe('0.40')
        expect(v31.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p', '4k'])
        expect(v31.videoDurations?.map((o: any) => o.value)).toEqual(['8'])

        const lite = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-lite-generate-preview' }, 4)
        expect(lite.title).toBe('Veo 3.1 Lite')
        expect(lite.pricing.video?.price).toBe('0.10')
        expect(lite.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p'])
        expect(lite.videoDurations?.map((o: any) => o.value)).toEqual(['8'])

        const fast = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-fast-generate-preview' }, 5)
        expect(fast.title).toBe('Veo 3.1 Fast')
        expect(fast.pricing.video?.price).toBe('0.15')
        expect(fast.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p', '4k'])
        expect(fast.videoDurations?.map((o: any) => o.value)).toEqual(['8'])
    })

    it('does NOT give gemini text models any video modality, options, or pricing (regression)', () => {
        const gemini = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-pro' }, 6)
        const modalities = gemini.modalities.map((m: any) => m.modality)

        expect(modalities).not.toContain('video_generation')
        expect(modalities).not.toContain('video')
        expect(gemini.videoAspectRatios).toBeUndefined()
        expect(gemini.videoResolutions).toBeUndefined()
        expect(gemini.videoDurations).toBeUndefined()
        expect(gemini.pricing.video).toBeUndefined()
    })

    it('no longer blacklists veo in the Google contains list (so fetchGoogleModels can surface it)', () => {
        const containsBlacklist = (AiModelsSync as any).MODELS_BLACKLIST.Google.contains
        expect(containsBlacklist).not.toContain('veo')
        // Unrelated entries must remain blacklisted.
        expect(containsBlacklist).toContain('imagen')
        expect(containsBlacklist).toContain('lyria')
    })

    it('keeps existing image models intact (regression) — Nano Banana mapping unchanged', () => {
        const nano = sync.mapGoogleModelToAiModel({ name: 'gemini-3.1-flash-image-preview' }, 7)
        const modalities = nano.modalities.map((m: any) => m.modality)
        expect(modalities).toContain('image_generation')
        expect(modalities).not.toContain('video_generation')
        expect(nano.title).toBe('Nano Banana 2')
    })

    it('does NOT give VEO models a reference cap (absent => provider-aware default of 3)', () => {
        const veo = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-generate-preview' }, 8)
        expect(veo.videoMaxReferenceImages).toBeUndefined()
    })
})

// =============================================================================
// BYTEPLUS / SEEDANCE 2.0 VIDEO MODEL SYNC — static injection (mirrors VEO)
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

    it('exposes both Seedance models in the static list', () => {
        const ids = sync.getBytePlusModels().map((m: any) => m.id)
        expect(ids).toEqual(['dreamina-seedance-2-0-260128', 'dreamina-seedance-2-0-fast-260128'])
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
        expect(model.pricing.video?.price).toBe('4.30')

        expect(model.videoAspectRatios?.map((o: any) => o.value)).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])
        expect(model.videoResolutions?.map((o: any) => o.value)).toEqual(['480p', '720p'])
        expect(model.videoDurations?.map((o: any) => o.value)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'])
        expect(model.videoMaxReferenceImages).toBe(9)

        expect(model.title).toBe('Seedance 2.0')
        expect(model.shortTitle).toBe('Seedance 2.0')
    })

    it('maps the fast variant to the cheaper per-1M-token price and a Fast title', () => {
        const model = sync.mapBytePlusModelToAiModel({ id: 'dreamina-seedance-2-0-fast-260128', displayName: 'Seedance 2.0 Fast' }, 2)
        expect(model.pricing.video?.measuringUnit).toBe('tokens')
        expect(model.pricing.video?.price).toBe('3.30')
        expect(model.videoMaxReferenceImages).toBe(9)
        expect(model.title).toBe('Seedance 2.0 Fast')
        expect(model.shortTitle).toBe('Seedance 2.0 Fast')
    })
})
