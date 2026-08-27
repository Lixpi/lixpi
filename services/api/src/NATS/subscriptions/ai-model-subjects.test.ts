'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    aiModel: {
        getAvailableAiModels: vi.fn(),
    },
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({
    log: mocks.log,
    info: mocks.info,
    infoStr: mocks.infoStr,
    warn: mocks.warn,
    err: mocks.err,
}))

vi.mock('../../models/ai-model.ts', () => ({ default: mocks.aiModel }))

import { aiModelSubjects } from './ai-model-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.AI_MODELS_SUBJECTS

const getSubscription = (subject: string) =>
    aiModelSubjects.find((subscription) => subscription.subject === subject)!

describe('AI model subject registration', () => {
    it('registers exactly the GET_AVAILABLE_MODELS and MODELS_SYNC_COMPLETED subjects', () => {
        expect(aiModelSubjects.map((subscription) => subscription.subject)).toEqual([
            SUBJECTS.GET_AVAILABLE_MODELS,
            SUBJECTS.MODELS_SYNC_COMPLETED,
        ])
    })

    it('exposes GET_AVAILABLE_MODELS as a reply subscription authorized to publish only itself', () => {
        const subscription = getSubscription(SUBJECTS.GET_AVAILABLE_MODELS)
        expect(subscription.type).toBe('reply')
        expect(subscription.payloadType).toBe('json')
        expect(subscription.permissions).toEqual({
            pub: { allow: [SUBJECTS.GET_AVAILABLE_MODELS] },
            sub: { allow: [] },
        })
    })

    it('exposes MODELS_SYNC_COMPLETED as a plain subscription authorized to subscribe only to itself', () => {
        const subscription = getSubscription(SUBJECTS.MODELS_SYNC_COMPLETED)
        expect(subscription.type).toBe('subscribe')
        expect(subscription.payloadType).toBe('json')
        expect(subscription.permissions).toEqual({
            sub: { allow: [SUBJECTS.MODELS_SYNC_COMPLETED] },
        })
    })
})

describe('GET_AVAILABLE_MODELS handler', () => {
    afterEach(() => {
        mocks.aiModel.getAvailableAiModels.mockReset()
    })

    it('replies with the catalog returned by AiModel.getAvailableAiModels', async () => {
        const catalog = {
            models: [{ provider: 'Anthropic', model: 'claude-sonnet-4-6' }],
            defaultModels: { reasoning: 'Anthropic:claude-sonnet-4-6' },
            mediaGenerationConfigMatrix: { groups: [] },
        }
        mocks.aiModel.getAvailableAiModels.mockResolvedValue(catalog)

        const handler = getSubscription(SUBJECTS.GET_AVAILABLE_MODELS).handler
        const result = await handler({}, {} as any)

        expect(mocks.aiModel.getAvailableAiModels).toHaveBeenCalledTimes(1)
        expect(result).toBe(catalog)
    })

    it('propagates a rejection from AiModel.getAvailableAiModels to the caller', async () => {
        mocks.aiModel.getAvailableAiModels.mockRejectedValue(new Error('DynamoDB scan failed'))

        const handler = getSubscription(SUBJECTS.GET_AVAILABLE_MODELS).handler
        await expect(handler({}, {} as any)).rejects.toThrow('DynamoDB scan failed')
    })
})

describe('MODELS_SYNC_COMPLETED handler', () => {
    let infoSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        infoSpy = vi.spyOn(mocks, 'info')
    })

    afterEach(() => {
        infoSpy?.mockRestore()
        infoSpy = null
        mocks.info.mockClear()
    })

    it('logs sync completion details from a fully populated payload', async () => {
        const handler = getSubscription(SUBJECTS.MODELS_SYNC_COMPLETED).handler

        await handler({
            totalNew: 3,
            totalUpdated: 5,
            totalDeleted: 1,
            ranAt: '2026-08-22T00:00:00.000Z',
        }, {} as any)

        expect(mocks.info).toHaveBeenCalledWith(
            'AI models sync completed -> new=3 updated=5 deleted=1 ranAt=2026-08-22T00:00:00.000Z',
        )
    })

    it('defaults missing counters to 0 and missing ranAt to n/a', async () => {
        const handler = getSubscription(SUBJECTS.MODELS_SYNC_COMPLETED).handler

        await handler({}, {} as any)

        expect(mocks.info).toHaveBeenCalledWith(
            'AI models sync completed -> new=0 updated=0 deleted=0 ranAt=n/a',
        )
    })

    it('tolerates a null payload the same way as an empty one', async () => {
        const handler = getSubscription(SUBJECTS.MODELS_SYNC_COMPLETED).handler

        await handler(null, {} as any)

        expect(mocks.info).toHaveBeenCalledWith(
            'AI models sync completed -> new=0 updated=0 deleted=0 ranAt=n/a',
        )
    })

    it('does not call AiModel.getAvailableAiModels — it only logs the sync signal', async () => {
        const handler = getSubscription(SUBJECTS.MODELS_SYNC_COMPLETED).handler

        await handler({ totalNew: 1 }, {} as any)

        expect(mocks.aiModel.getAvailableAiModels).not.toHaveBeenCalled()
    })
})
