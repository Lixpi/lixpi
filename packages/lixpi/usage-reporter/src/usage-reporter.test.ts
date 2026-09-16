import {
    describe,
    expect,
    it,
} from 'vitest'

import { UsageReporter } from './usage-reporter.ts'
import {
    type MeteredAiModel,
} from './types.ts'

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
    inferenceProviderCalledByThePlatform: 'google',
    inferenceProviders: {
        google: {
            isCalledByThePlatform: true,
            pricing: {
                currency: 'USD',
                video: {
                    measuringUnit: 'seconds',
                    pricePer: '1',
                    price: '0.40',
                },
            },
        },
    },
} as unknown as MeteredAiModel

const seedanceMeta = {
    provider: 'BytePlus',
    model: 'dreamina-seedance-2-0-260128',
    modelVersion: 'dreamina-seedance-2-0-260128',
    inferenceProviderCalledByThePlatform: 'byteplus',
    inferenceProviders: {
        byteplus: {
            isCalledByThePlatform: true,
            pricing: {
                currency: 'USD',
                video: {
                    measuringUnit: 'tokens',
                    pricePer: '1000000',
                    price: '4.30',
                },
            },
        },
    },
} as unknown as MeteredAiModel

describe('UsageReporter.measureVideoUsage', () => {
    it('measures a VEO request in seconds without calculating money', () => {
        const report = reporter.measureVideoUsage({
            ...baseArgs,
            aiModelMetaInfo: veoMeta,
            durationSeconds: 8,
            resolution: '1080p',
            aspectRatio: '16:9',
        })

        expect(report?.video.measuringUnit).toBe('seconds')
        expect(report?.video.durationSeconds).toBe(8)
        expect(report?.video.resolution).toBe('1080p')
        expect(report?.video.aspectRatio).toBe('16:9')
        expect(report?.video.totalTokens).toBeUndefined()
        expect('purchasedFor' in report.video).toBe(false)
        expect('soldToClientFor' in report.video).toBe(false)
    })

    it('measures Seedance usage in tokens', () => {
        const report = reporter.measureVideoUsage({
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
        expect(report?.video.completionTokens).toBe(184320)
        expect(report?.video.durationSeconds).toBe(5)
        expect(report?.video.resolution).toBe('720p')
        expect(report?.video.aspectRatio).toBe('16:9')
        expect('purchasedFor' in report.video).toBe(false)
        expect('soldToClientFor' in report.video).toBe(false)
    })

    it('records zero tokens when a token-metered response omits token usage', () => {
        const report = reporter.measureVideoUsage({
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
})
