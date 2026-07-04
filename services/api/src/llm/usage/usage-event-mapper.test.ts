'use strict'

import { describe, it, expect } from 'vitest'

import { tokenUsageConfirm, imageUsageConfirm, videoUsageConfirm } from './usage-event-mapper.ts'
import type { UsageReport, ImageUsageReport, VideoUsageReport } from './usage-reporter.ts'

const eventMeta = { organizationId: 'org_1', userId: 'usr_1', workspaceId: 'ws_1' }
const head = {
    eventMeta,
    aiVendorRequestId: 'req_77',
    aiModel: 'OpenAI:gpt-5',
    aiRequestReceivedAt: 1000,
    aiRequestFinishedAt: Date.UTC(2026, 0, 1),
}

describe('tokenUsageConfirm', () => {
    const report = {
        ...head,
        total: { usageTokens: 812, purchasedFor: '0.0021', soldToClientFor: '0.0034' },
    } as unknown as UsageReport

    it('maps tokens to a confirm request carrying unit counts only (no cost)', () => {
        const req = tokenUsageConfirm(report, 'wf_a1b2', 1)
        expect(req).toMatchObject({
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
            currency: 'USD',
        })
        expect(req.occurredAt).toBe('2026-01-01T00:00:00.000Z')
        expect('resaleCost' in req).toBe(false)
        expect('unitPrice' in req).toBe(false)
    })
})

describe('imageUsageConfirm', () => {
    const report = {
        ...head,
        image: { size: '1024x1024', quality: 'high', count: 1, pricePerImageResale: '0.05', purchasedFor: '0.04', soldToClientFor: '0.05' },
    } as unknown as ImageUsageReport

    it('maps an image call to images/image modality', () => {
        const req = imageUsageConfirm(report, 'wf_a1b2', 2)
        expect(req).toMatchObject({
            modality: 'image',
            measuringUnit: 'images',
            quantity: 1,
            workflowSeq: 2,
        })
    })
})

describe('videoUsageConfirm', () => {
    it('maps a per-second (VEO) video call to seconds', () => {
        const report = {
            ...head,
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9', purchasedFor: '0.64', soldToClientFor: '0.80' },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 3)
        expect(req).toMatchObject({ modality: 'video', measuringUnit: 'seconds', quantity: 8 })
    })

    it('maps a token-metered (Seedance) video call to tokens', () => {
        const report = {
            ...head,
            video: { measuringUnit: 'tokens', durationSeconds: 5, totalTokens: 1000, completionTokens: 1000, purchasedFor: '0.02', soldToClientFor: '0.03' },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 4)
        expect(req).toMatchObject({ modality: 'video', measuringUnit: 'tokens', quantity: 1000 })
    })
})
