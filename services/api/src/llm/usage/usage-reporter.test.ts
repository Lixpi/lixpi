'use strict'

import { describe, expect, it } from 'vitest'

import { UsageReporter } from './usage-reporter.ts'
import type { AiModelMetaInfo } from '../graph/state.ts'

const reporter = new UsageReporter()

const baseArgs = {
    eventMeta: {},
    aiVendorRequestId: 'req-1',
    aiRequestReceivedAt: 1,
    aiRequestFinishedAt: 2,
}

const veoMeta = {
    provider: 'Google',
    model: 'veo-3.1',
    modelVersion: 'veo-3.1-generate-preview',
    pricing: { currency: 'USD', resaleMargin: '1', video: { measuringUnit: 'seconds', pricePer: '1', price: '0.40' } },
} as unknown as AiModelMetaInfo

const seedanceMeta = {
    provider: 'BytePlus',
    model: 'dreamina-seedance-2-0-260128',
    modelVersion: 'dreamina-seedance-2-0-260128',
    pricing: { currency: 'USD', resaleMargin: '1', video: { measuringUnit: 'tokens', pricePer: '1000000', price: '4.30' } },
} as unknown as AiModelMetaInfo

describe('UsageReporter.reportVideoUsage', () => {
    it('bills VEO per second (unchanged): price-per-second × duration', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: veoMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })

        expect(report?.video.measuringUnit).toBe('seconds')
        expect(report?.video.pricePerSecond).toBe('0.4')
        expect(report?.video.purchasedFor).toBe('3.2')
        expect(report?.video.soldToClientFor).toBe('3.2')
        expect(report?.video.totalTokens).toBeUndefined()
    })

    it('applies the resale margin to the per-second sold price', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: {
                ...veoMeta,
                pricing: { currency: 'USD', resaleMargin: '1.5', video: { measuringUnit: 'seconds', pricePer: '1', price: '0.40' } },
            } as unknown as AiModelMetaInfo,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })

        expect(report?.video.purchasedFor).toBe('3.2')
        expect(report?.video.soldToClientFor).toBe('4.8') // 0.40 × 1.5 × 8
    })

    it('bills Seedance per token: total_tokens × price / pricePer', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: seedanceMeta,
            durationSeconds: 5,
            resolution: '720p',
            aspectRatio: '16:9',
            totalTokens: 184320,
            completionTokens: 184320,
        })

        expect(report?.video.measuringUnit).toBe('tokens')
        expect(report?.video.totalTokens).toBe(184320)
        expect(report?.video.pricePer).toBe('1000000')
        expect(report?.video.price).toBe('4.3')
        // 184320 × 4.30 / 1000000 = 0.792576 (the proposal's "$0.000793" is an arithmetic slip).
        expect(report?.video.purchasedFor).toBe('0.792576')
        expect(report?.video.soldToClientFor).toBe('0.792576')
        expect(report?.video.pricePerSecond).toBeUndefined()
    })

    it('treats a token-metered model with no token usage as zero cost', () => {
        const report = reporter.reportVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: seedanceMeta,
            durationSeconds: 5,
            resolution: '720p',
            aspectRatio: '16:9',
        })

        expect(report?.video.measuringUnit).toBe('tokens')
        expect(report?.video.totalTokens).toBe(0)
        expect(report?.video.purchasedFor).toBe('0')
    })
})
