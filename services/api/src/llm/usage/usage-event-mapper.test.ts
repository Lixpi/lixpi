import {
    describe,
    it,
    expect,
} from 'vitest'

import {
    tokenUsageConfirm,
    imageUsageConfirm,
    videoUsageConfirm,
} from './usage-event-mapper.ts'
import {
    type UsageReport,
    type ImageUsageReport,
    type VideoUsageReport,
} from './usage-reporter.ts'

const eventMeta = { organizationId: 'org_1', userId: 'usr_1', workspaceId: 'ws_1' }
const head = {
    eventMeta,
    aiVendorRequestId: 'req_77',
    aiModel: 'OpenAI:gpt-5', // display id
    modelVersion: 'gpt-5', // canonical vendor id sent to the metering backend
    aiRequestReceivedAt: 1000,
    aiRequestFinishedAt: Date.UTC(2026, 0, 1),
}

describe('tokenUsageConfirm', () => {
    const report = {
        ...head,
        prompt: { usageTokens: 700, cachedTokens: 100 },
        completion: { usageTokens: 112, reasoningTokens: 30 },
        total: { usageTokens: 812 },
    } as unknown as UsageReport

    it('maps tokens to a confirm request with the prompt/completion split (no cost)', () => {
        const req = tokenUsageConfirm(report, 'wf_a1b2', 1)
        expect(req).toMatchObject({
            providerRequestId: 'req_77',
            orgId: 'org_1',
            userId: 'usr_1',
            workspaceId: 'ws_1',
            workflowId: 'wf_a1b2',
            workflowSeq: 1,
            model: 'gpt-5',
            modality: 'tokens',
            measuringUnit: 'tokens',
            usage: { promptTokens: 700, completionTokens: 112, cachedTokens: 100, reasoningTokens: 30 },
            currency: 'USD',
        })
        expect(req.occurredAt).toBe('2026-01-01T00:00:00.000Z')
        expect('resaleCost' in req).toBe(false)
    })
})

describe('imageUsageConfirm', () => {
    const report = {
        ...head,
        image: { size: '1024x1024', quality: 'high', count: 1, pricePerImageResale: '0.05', purchasedFor: '0.04', soldToClientFor: '0.05' },
    } as unknown as ImageUsageReport

    it('maps an image call to count/size/quality dimensions', () => {
        const req = imageUsageConfirm(report, 'wf_a1b2', 2)
        expect(req).toMatchObject({
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
            video: { measuringUnit: 'seconds', durationSeconds: 8, resolution: '720p', aspectRatio: '16:9', purchasedFor: '0.64', soldToClientFor: '0.80' },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 3)
        expect(req).toMatchObject({
            modality: 'video',
            measuringUnit: 'seconds',
            usage: { durationSeconds: 8, resolution: '720p' },
        })
    })

    it('maps a token-metered (Seedance) video call to videoTokens', () => {
        const report = {
            ...head,
            video: { measuringUnit: 'tokens', durationSeconds: 5, totalTokens: 1000, completionTokens: 1000, purchasedFor: '0.02', soldToClientFor: '0.03' },
        } as unknown as VideoUsageReport
        const req = videoUsageConfirm(report, 'wf_a1b2', 4)
        expect(req).toMatchObject({
            modality: 'video',
            measuringUnit: 'tokens',
            usage: { videoTokens: 1000 },
        })
    })
})
