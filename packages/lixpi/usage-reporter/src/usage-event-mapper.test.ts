import {
    describe,
    it,
    expect,
} from 'vitest'

import {
    usageRecordForTextCall,
    usageRecordForImageCall,
    usageRecordForVideoCall,
} from './usage-event-mapper.ts'
import {
    type TextProviderUsage,
    type ImageProviderUsage,
    type VideoProviderUsage,
} from './usage-reporter.ts'

const eventMeta = {
    organizationId: 'org_1',
    userId: 'usr_1',
    workspaceId: 'ws_1',
}
const head = {
    eventMeta,
    aiVendorRequestId: 'req_77',
    aiModel: 'OpenAI:gpt-5', // display id
    modelVersion: 'gpt-5', // canonical vendor id sent to the metering backend
    aiRequestReceivedAt: 1000,
    aiRequestFinishedAt: Date.UTC(2026, 0, 1),
}

describe('usageRecordForTextCall', () => {
    const report = {
        ...head,
        prompt: {
            usageTokens: 700,
            cachedTokens: 100,
        },
        completion: {
            usageTokens: 112,
            reasoningTokens: 30,
        },
        total: { usageTokens: 812 },
    } as unknown as TextProviderUsage

    it('maps tokens to a usage record with the prompt and completion split, and no cost', () => {
        const req = usageRecordForTextCall(report, 'wf_a1b2', 1)
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
            usage: {
                promptTokens: 700,
                completionTokens: 112,
                cachedTokens: 100,
                reasoningTokens: 30,
            },
        })
        expect(req.occurredAt).toBe('2026-01-01T00:00:00.000Z')
        expect('currency' in req).toBe(false)
        expect('resaleCost' in req).toBe(false)
    })
})

describe('usageRecordForImageCall', () => {
    const report = {
        ...head,
        image: {
            size: '1024x1024',
            quality: 'high',
            count: 1,
        },
    } as unknown as ImageProviderUsage

    it('maps an image call to count/size/quality dimensions', () => {
        const req = usageRecordForImageCall(report, 'wf_a1b2', 2)
        expect(req).toMatchObject({
            modality: 'image',
            measuringUnit: 'images',
            workflowSeq: 2,
            usage: {
                imageCount: 1,
                imageSize: '1024x1024',
                imageQuality: 'high',
            },
        })
    })
})

describe('usageRecordForVideoCall', () => {
    it('maps a per-second (VEO) video call to durationSeconds + resolution', () => {
        const report = {
            ...head,
            video: {
                measuringUnit: 'seconds',
                durationSeconds: 8,
                resolution: '720p',
                aspectRatio: '16:9',
            },
        } as unknown as VideoProviderUsage
        const req = usageRecordForVideoCall(report, 'wf_a1b2', 3)
        expect(req).toMatchObject({
            modality: 'video',
            measuringUnit: 'seconds',
            usage: {
                durationSeconds: 8,
                resolution: '720p',
            },
        })
    })

    it('maps a token-metered (Seedance) video call to videoTokens', () => {
        const report = {
            ...head,
            video: {
                measuringUnit: 'tokens',
                durationSeconds: 5,
                totalTokens: 1000,
                completionTokens: 1000,
            },
        } as unknown as VideoProviderUsage
        const req = usageRecordForVideoCall(report, 'wf_a1b2', 4)
        expect(req).toMatchObject({
            modality: 'video',
            measuringUnit: 'tokens',
            usage: { videoTokens: 1000 },
        })
    })
})
