'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import PromptReferenceRecentModel, {
    buildPromptReferenceKey,
    getPromptReferenceId,
} from './prompt-reference-recent.ts'

const dynamo = {
    queryItems: vi.fn(),
    transactWrite: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
    dynamo.queryItems.mockResolvedValue({ items: [] })
    dynamo.transactWrite.mockResolvedValue(undefined)
})

describe('PromptReferenceRecentModel', () => {
    it('uses one stable identity per reference family', () => {
        expect(getPromptReferenceId({ referenceType: 'media', assetId: 'asset-1', mediaKind: 'image' })).toBe('asset-1')
        expect(getPromptReferenceId({ referenceType: 'capability-module', moduleId: 'module-1' })).toBe('module-1')
        expect(getPromptReferenceId({ referenceType: 'tool', capabilityId: 'tool-1' })).toBe('tool-1')
        expect(buildPromptReferenceKey('skill', 'skill-1')).toBe('skill#skill-1')
    })

    it('returns newest rows from only the requested category', async () => {
        dynamo.queryItems.mockResolvedValue({
            items: [
                { userId: 'user-1', referenceKey: 'tool#tool-1', referenceType: 'tool', referenceId: 'tool-1', updatedAt: 5 },
                { userId: 'user-1', referenceKey: 'media#asset-1', referenceType: 'media', referenceId: 'asset-1', updatedAt: 4 },
                { userId: 'user-1', referenceKey: 'media#asset-2', referenceType: 'media', referenceId: 'asset-2', updatedAt: 3 },
            ],
        })

        const result = await PromptReferenceRecentModel.list({
            userId: 'user-1',
            referenceTypes: ['media'],
            limit: 1,
        })

        expect(result.map(item => item.referenceId)).toEqual(['asset-1'])
    })

    it('deduplicates accepted references and trims overflow beyond 100 rows', async () => {
        dynamo.queryItems.mockResolvedValue({
            items: Array.from({ length: 102 }, (_, index) => ({
                userId: 'user-1',
                referenceKey: `media#asset-${index}`,
                referenceType: 'media',
                referenceId: `asset-${index}`,
                updatedAt: 1000 - index,
            })),
        })

        await PromptReferenceRecentModel.recordAccepted({
            userId: 'user-1',
            references: [
                { referenceType: 'media', assetId: 'asset-1', mediaKind: 'image' },
                { referenceType: 'media', assetId: 'asset-1', mediaKind: 'image' },
                { referenceType: 'capability-module', moduleId: 'character-creator' },
            ],
            now: 50,
        })

        expect(dynamo.transactWrite).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                origin: 'PromptReferenceRecent.recordAccepted',
                operations: [
                    expect.objectContaining({
                        type: 'put',
                        item: expect.objectContaining({ referenceKey: 'media#asset-1', updatedAt: 51 }),
                    }),
                    expect.objectContaining({
                        type: 'put',
                        item: expect.objectContaining({ referenceKey: 'capability-module#character-creator', updatedAt: 52 }),
                    }),
                ],
            }),
        )
        expect(dynamo.transactWrite).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                origin: 'PromptReferenceRecent.trimOverflow',
                operations: expect.arrayContaining([
                    expect.objectContaining({ type: 'delete', key: { userId: 'user-1', referenceKey: 'media#asset-100' } }),
                    expect.objectContaining({ type: 'delete', key: { userId: 'user-1', referenceKey: 'media#asset-101' } }),
                ]),
            }),
        )
    })
})
