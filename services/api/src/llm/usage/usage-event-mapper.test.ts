'use strict'

import { describe, it, expect } from 'vitest'

import { tokenUsageConfirm, imageUsageConfirm, videoUsageConfirm } from './usage-event-mapper.ts'
import type { UsageReport, ImageUsageReport, VideoUsageReport } from './usage-reporter.ts'

const eventMeta = { organizationId: 'org_1', userId: 'usr_1', workspaceId: 'ws_1' }
const head = {
    eventMeta,
    aiVendorRequestId: 'req_77',
    pricingLookup: { pricingKey: 'OpenAI:gpt-5:openai-api:global', pricingDimensions: {} },
    aiRequestFinishedAt: Date.UTC(2026, 0, 1),
}

describe('tokenUsageConfirm', () => {
    const report = {
        ...head,
        prompt: { usageTokens: 700, cachedTokens: 100 },
        completion: { usageTokens: 112, reasoningTokens: 30 },
        total: { usageTokens: 812 },
    } as unknown as UsageReport

    it('maps tokens to a confirm request with the prompt/completion split, keyed by pricingLookup (no cost)', () => {
        const req = tokenUsageConfirm(report, 'wf_a1b2', 1)
        expect(req).toMatchObject({
            providerRequestId: 'req_77',
            orgId: 'org_1',
            userId: 'usr_1',
            workspaceId: 'ws_1',
            workflowId: 'wf_a1b2',
            workflowSeq: 1,
            pricingLookup: { pricingKey: 'OpenAI:gpt-5:openai-api:global', pricingDimensions: {} },
            modality: 'tokens',
            measuringUnit: 'tokens',
            usage: { promptTokens: 700, completionTokens: 112, cachedTokens: 100, reasoningTokens: 30 },
            currency: 'USD',
        })
        expect(req.occurredAt).toBe('2026-01-01T00:00:00.000Z')
        expect('resaleCost' in req).toBe(false)
        expect('model' in req).toBe(false)
    })
})

describe('imageUsageConfirm', () => {
    const report = {
        ...head,
        pricingLookup: { pricingKey: 'OpenAI:gpt-image-1:openai-api:global', pricingDimensions: { imageSize: '1024x1024', imageQuality: 'high' } },
        image: { size: '1024x1024', quality: 'high', count: 1 },
    } as unknown as ImageUsageReport

    it('maps an image call to count/size/quality dimensions, carrying the pricingLookup through unchanged', () => {
        const req = imageUsageConfirm(report, 'wf_a1b2', 2)
        expect(req).toMatchObject({
            pricingLookup: { pricingKey: 'OpenAI:gpt-image-1:openai-api:global', pricingDimensions: { imageSize: '1024x1024', imageQuality: 'high' } },
            modality: 'image',
            measuringUnit: 'images',
            workflowSeq: 2,
            usage: { imageCount: 1, imageSize: '1024x1024', imageQuality: 'high' },
        })
    })
})

describe('videoUsageConfirm', () => {
    it('maps a per-second (VEO) video call to durationSeconds + resolution', () => {
        const report = {
            ...head,
            pricingLookup: { pricingKey: 'Google:veo-3.1:gemini-api:global', pricingDimensions: { resolution: '720p' } },
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9' },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 3)
        expect(req).toMatchObject({
            pricingLookup: { pricingKey: 'Google:veo-3.1:gemini-api:global', pricingDimensions: { resolution: '720p' } },
            modality: 'video',
            measuringUnit: 'seconds',
            usage: { durationSeconds: 8, resolution: '720p' },
        })
    })

    it('maps a token-metered (Seedance) video call to videoTokens', () => {
        const report = {
            ...head,
            pricingLookup: { pricingKey: 'BytePlus:dreamina-seedance-2-0:byteplus-modelark:cn-north-1', pricingDimensions: { resolution: '720p' } },
            video: { measuringUnit: 'tokens', durationSeconds: 5, totalTokens: 1000, completionTokens: 1000 },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 4)
        expect(req).toMatchObject({
            modality: 'video',
            measuringUnit: 'tokens',
            usage: { videoTokens: 1000 },
        })
    })

    it('includes inputVideoSeconds only when the source clip had video input', () => {
        const withInput = {
            ...head,
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9', inputVideoSeconds: 3 },
        } as unknown as VideoUsageReport
        expect(videoUsageConfirm(withInput, 'wf_a1b2', 5)).toMatchObject({ usage: { inputVideoSeconds: 3 } })

        const textToVideo = {
            ...head,
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9' },
        } as unknown as VideoUsageReport
        expect(videoUsageConfirm(textToVideo, 'wf_a1b2', 6).usage).not.toHaveProperty('inputVideoSeconds')
    })
})
