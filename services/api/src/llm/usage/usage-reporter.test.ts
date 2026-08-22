'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UsageReporter } from './usage-reporter.ts'
import type { AiModelMetaInfo } from '../graph/state.ts'

const reporter = new UsageReporter()

const baseArgs = {
    eventMeta: {},
    aiVendorRequestId: 'req-1',
    aiRequestReceivedAt: 1,
    aiRequestFinishedAt: 2,
}

const openAiMeta = {
    provider: 'OpenAI',
    model: 'gpt-5',
    modelVersion: 'gpt-5',
    pricingReference: { pricingKey: 'OpenAI:gpt-5:openai-api:global', providerRoute: 'openai-api', vendorModel: 'gpt-5', pricingRegion: 'global' },
} as unknown as AiModelMetaInfo

const veoMeta = {
    provider: 'Google',
    model: 'veo-3.1',
    modelVersion: 'veo-3.1-generate-preview',
    pricingReference: { pricingKey: 'Google:veo-3.1:gemini-api:global', providerRoute: 'gemini-api', vendorModel: 'veo-3.1-generate-preview', pricingRegion: 'global' },
} as unknown as AiModelMetaInfo

const seedanceMeta = {
    provider: 'BytePlus',
    model: 'dreamina-seedance-2-0-260128',
    modelVersion: 'dreamina-seedance-2-0-260128',
    pricingReference: {
        pricingKey: 'BytePlus:dreamina-seedance-2-0-260128:byteplus-modelark:cn-north-1',
        providerRoute: 'byteplus-modelark',
        vendorModel: 'dreamina-seedance-2-0-260128',
        pricingRegion: 'cn-north-1',
    },
} as unknown as AiModelMetaInfo

const noPricingReferenceMeta = {
    provider: 'OpenAI',
    model: 'gpt-5',
    modelVersion: 'gpt-5',
} as unknown as AiModelMetaInfo

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
})

// =============================================================================
// reportTokensUsage
// =============================================================================

describe('UsageReporter.reportTokensUsage', () => {
    it('normalizes usage and builds a pricingLookup with no dimensions', () => {
        const report = reporter.reportTokensUsage({
            ...baseArgs,
            aiModelMetaInfo: openAiMeta,
            usage: { promptTokens: 700, promptCachedTokens: 100, completionTokens: 112, completionReasoningTokens: 30, totalTokens: 812 },
        })

        expect(report?.pricingLookup).toEqual({ pricingKey: 'OpenAI:gpt-5:openai-api:global', pricingDimensions: {} })
        expect(report?.prompt).toEqual({ usageTokens: 700, cachedTokens: 100, audioTokens: 0 })
        expect(report?.completion).toEqual({ usageTokens: 112, reasoningTokens: 30, audioTokens: 0 })
        expect(report?.total).toEqual({ usageTokens: 812 })
        expect(report).not.toHaveProperty('purchasedFor')
        expect(report).not.toHaveProperty('soldToClientFor')
    })

    it('defaults missing usage fields to zero and derives total from prompt+completion', () => {
        const report = reporter.reportTokensUsage({
            ...baseArgs,
            aiModelMetaInfo: openAiMeta,
            usage: { promptTokens: 10, completionTokens: 5 },
        })

        expect(report?.prompt).toEqual({ usageTokens: 10, cachedTokens: 0, audioTokens: 0 })
        expect(report?.completion).toEqual({ usageTokens: 5, reasoningTokens: 0, audioTokens: 0 })
        expect(report?.total).toEqual({ usageTokens: 15 })
    })

    it('returns undefined and logs when the model has no pricingReference', () => {
        const report = reporter.reportTokensUsage({
            ...baseArgs,
            aiModelMetaInfo: noPricingReferenceMeta,
            usage: { promptTokens: 10, completionTokens: 5 },
        })

        expect(report).toBeUndefined()
        expect(consoleErrorSpy).toHaveBeenCalled()
    })
})

// =============================================================================
// reportImageUsage
// =============================================================================

describe('UsageReporter.reportImageUsage', () => {
    it('builds a pricingLookup dimensioned by size and quality, count always 1', () => {
        const report = reporter.reportImageUsage({
            ...baseArgs,
            aiModelMetaInfo: openAiMeta,
            imageSize: '1024x1024',
            imageQuality: 'high',
        })

        expect(report?.pricingLookup).toEqual({
            pricingKey: 'OpenAI:gpt-5:openai-api:global',
            pricingDimensions: { imageSize: '1024x1024', imageQuality: 'high' },
        })
        expect(report?.image).toEqual({ size: '1024x1024', quality: 'high', count: 1 })
    })

    it('returns undefined and logs when the model has no pricingReference', () => {
        const report = reporter.reportImageUsage({
            ...baseArgs,
            aiModelMetaInfo: noPricingReferenceMeta,
            imageSize: '1024x1024',
            imageQuality: 'high',
        })

        expect(report).toBeUndefined()
        expect(consoleErrorSpy).toHaveBeenCalled()
    })
})

// =============================================================================
// reportVideoUsage
// =============================================================================

describe('UsageReporter.reportVideoUsage', () => {
    it('reports a per-second (VEO-style) model as measuringUnit "seconds" with no token fields', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: veoMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })

        expect(report?.pricingLookup).toEqual({ pricingKey: 'Google:veo-3.1:gemini-api:global', pricingDimensions: { resolution: '1080p' } })
        expect(report?.video.measuringUnit).toBe('seconds')
        expect(report?.video.durationSeconds).toBe(8)
        expect(report?.video.totalTokens).toBeUndefined()
        expect(report?.video.completionTokens).toBeUndefined()
    })

    it('reports a byteplus-modelark (Seedance) model as measuringUnit "tokens" with totalTokens/completionTokens', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: seedanceMeta,
            durationSeconds: 5,
            resolution: '720p',
            aspectRatio: '16:9',
            totalTokens: 184320,
            completionTokens: 184320,
        })

        expect(report?.pricingLookup).toEqual({
            pricingKey: 'BytePlus:dreamina-seedance-2-0-260128:byteplus-modelark:cn-north-1',
            pricingDimensions: { resolution: '720p' },
        })
        expect(report?.video.measuringUnit).toBe('tokens')
        expect(report?.video.totalTokens).toBe(184320)
        expect(report?.video.completionTokens).toBe(184320)
    })

    it('defaults totalTokens/completionTokens to zero for a token-metered model with no usage reported', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: seedanceMeta,
            durationSeconds: 5,
            resolution: '720p',
            aspectRatio: '16:9',
        })

        expect(report?.video.measuringUnit).toBe('tokens')
        expect(report?.video.totalTokens).toBe(0)
        expect(report?.video.completionTokens).toBe(0)
    })

    it('rounds a fractional inputVideoSeconds up to whole seconds and omits it when zero/absent', () => {
        const withInput = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: veoMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
            inputVideoSeconds: 2.1,
        })
        expect(withInput?.video.inputVideoSeconds).toBe(3)

        const textToVideo = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: veoMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })
        expect(textToVideo?.video.inputVideoSeconds).toBeUndefined()
    })

    it('returns undefined and logs when the model has no pricingReference', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: noPricingReferenceMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })

        expect(report).toBeUndefined()
        expect(consoleErrorSpy).toHaveBeenCalled()
    })
})
