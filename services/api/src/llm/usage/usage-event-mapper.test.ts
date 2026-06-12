'use strict'

import { describe, it, expect } from 'vitest'

import { tokenUsageEvent, imageUsageEvent, videoUsageEvent } from './usage-event-mapper.ts'
import type { UsageReport, ImageUsageReport, VideoUsageReport } from './usage-reporter.ts'

const eventMeta = { organizationId: 'org_1', userId: 'usr_1', workspaceId: 'ws_1' }
const head = {
    eventMeta,
    aiVendorRequestId: 'req_77',
    aiModel: 'OpenAI:gpt-5',
    aiRequestReceivedAt: 1000,
    aiRequestFinishedAt: Date.UTC(2026, 0, 1),
}

describe('tokenUsageEvent', () => {
    const report = {
        ...head,
        total: { usageTokens: 812, purchasedFor: '0.0021', soldToClientFor: '0.0034' },
    } as unknown as UsageReport

    it('maps tokens to a micro-dollar usage event', () => {
        const ev = tokenUsageEvent(report, 'wf_a1b2', 1)
        expect(ev).toMatchObject({
            providerRequestId: 'req_77',
            orgId: 'org_1',
            userId: 'usr_1',
            workspaceId: 'ws_1',
            workflowId: 'wf_a1b2',
            workflowSeq: 1,
            model: 'OpenAI:gpt-5',
            modality: 'tokens',
            measuringUnit: 'tokens',
            quantity: 812,
            purchaseCost: 2100,
            resaleCost: 3400,
            currency: 'USD',
        })
        // blended per-token resale: round(3400 / 812) = 4
        expect(ev.unitPrice).toBe(4)
        expect(ev.occurredAt).toBe('2026-01-01T00:00:00.000Z')
    })
})

describe('imageUsageEvent', () => {
    const report = {
        ...head,
        image: { size: '1024x1024', quality: 'high', count: 1, pricePerImage: '0.04', pricePerImageResale: '0.05', purchasedFor: '0.04', soldToClientFor: '0.05' },
    } as unknown as ImageUsageReport

    it('maps an image call to images/image modality', () => {
        const ev = imageUsageEvent(report, 'wf_a1b2', 2)
        expect(ev).toMatchObject({
            modality: 'image',
            measuringUnit: 'images',
            quantity: 1,
            workflowSeq: 2,
            unitPrice: 50_000,
            purchaseCost: 40_000,
            resaleCost: 50_000,
        })
    })
})

describe('videoUsageEvent', () => {
    it('maps a per-second (VEO) video call to seconds', () => {
        const report = {
            ...head,
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9', pricePerSecond: '0.08', pricePerSecondResale: '0.10', purchasedFor: '0.64', soldToClientFor: '0.80' },
        } as unknown as VideoUsageReport
        const ev = videoUsageEvent(report, 'wf_a1b2', 3)
        expect(ev).toMatchObject({
            modality: 'video',
            measuringUnit: 'seconds',
            quantity: 8,
            unitPrice: 100_000,
            purchaseCost: 640_000,
            resaleCost: 800_000,
        })
    })

    it('maps a token-metered (Seedance) video call to tokens', () => {
        const report = {
            ...head,
            video: { measuringUnit: 'tokens', durationSeconds: 5, resolution: '720p', aspectRatio: '16:9', totalTokens: 1000, completionTokens: 1000, price: '30', pricePer: '1000000', purchasedFor: '0.02', soldToClientFor: '0.03' },
        } as unknown as VideoUsageReport
        const ev = videoUsageEvent(report, 'wf_a1b2', 4)
        expect(ev).toMatchObject({
            modality: 'video',
            measuringUnit: 'tokens',
            quantity: 1000,
            unitPrice: 30, // round(30000 / 1000)
            purchaseCost: 20_000,
            resaleCost: 30_000,
        })
    })
})
