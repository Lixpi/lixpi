'use strict'

import { describe, it, expect, beforeAll } from 'vitest'

import { AiModelsSync } from './ai-models-synchronization.ts'

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

    it('maps veo-3.0-generate-001 with video + video_generation modalities, per-second pricing, and option lists', () => {
        const model = sync.mapGoogleModelToAiModel({ name: 'veo-3.0-generate-001' }, 1)
        const modalities = model.modalities.map((m: any) => m.modality)

        expect(modalities).toContain('video_generation')
        expect(modalities).toContain('video')
        expect(modalities).not.toContain('image_generation')

        expect(model.pricing.video?.measuringUnit).toBe('seconds')
        expect(model.pricing.video?.price).toBe('0.40')

        expect(model.videoAspectRatios?.map((o: any) => o.value)).toEqual(['16:9', '9:16'])
        expect(model.videoResolutions?.map((o: any) => o.value)).toEqual(['720p', '1080p', '4k'])
        expect(model.videoDurations?.map((o: any) => o.value)).toEqual(['4', '6', '8'])

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

        const lite = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-lite-generate-preview' }, 4)
        expect(lite.title).toBe('Veo 3.1 Lite')
        expect(lite.pricing.video?.price).toBe('0.10')

        const fast = sync.mapGoogleModelToAiModel({ name: 'veo-3.1-fast-generate-preview' }, 5)
        expect(fast.title).toBe('Veo 3.1 Fast')
        expect(fast.pricing.video?.price).toBe('0.15')
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
})
