'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Feature } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getObject: vi.fn(),
    getObjectStream: vi.fn(),
    putObjectFromReadable: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => mocks,
    },
}))

import { ensureFeatureSamplesForScope, findFeatureSampleRef, readFeatureSampleObject } from './feature-sample-storage.ts'

const feature: Feature = {
    featureId: 'feature-1',
    version: 1,
    category: 'illustration-style',
    name: 'painted-light',
    summary: 'Soft painted illumination.',
    tags: [],
    instructions: '',
    parameters: {},
    sampleImages: [{ idx: 0, subject: 'reference', ext: 'png', fileId: 'features/feature-1/sample-0.png' }],
    scope: 'public',
    scopeOwnerId: 'public',
    status: 'active',
    ownerUserId: 'user-1',
    workspaceId: 'workspace-1',
    sourceContext: {
        extractionRunId: 'run-1',
        sourceWorkspaceId: 'workspace-1',
    },
    reportCount: 0,
    createdAt: 1,
    updatedAt: 1,
}

describe('Feature sample storage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('falls back to the source workspace for legacy promoted samples', async () => {
        const data = new Uint8Array([1, 2, 3])
        mocks.getObject
            .mockRejectedValueOnce(new Error('missing durable copy'))
            .mockResolvedValueOnce(data)

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(mocks.getObject).toHaveBeenNthCalledWith(1, 'user-user-1-features', 'features/feature-1/sample-0.png')
        expect(mocks.getObject).toHaveBeenNthCalledWith(2, 'workspace-workspace-1-files', 'features/feature-1/sample-0.png')
        expect(result).toBe(data)
    })

    it('copies workspace samples into durable user-owned storage before promotion', async () => {
        const workspaceFeature = { ...feature, scope: 'workspace' as const, scopeOwnerId: 'workspace-1' }
        const stream = { readable: true }
        mocks.getObject.mockRejectedValueOnce(new Error('missing destination'))
        mocks.getObjectStream.mockResolvedValueOnce(stream)

        await ensureFeatureSamplesForScope({
            feature: workspaceFeature,
            newScope: 'public',
            newScopeOwnerId: 'public',
        })

        expect(mocks.getObject).toHaveBeenCalledWith('user-user-1-features', 'features/feature-1/sample-0.png')
        expect(mocks.getObjectStream).toHaveBeenCalledWith('workspace-workspace-1-files', 'features/feature-1/sample-0.png')
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'user-user-1-features',
            'features/feature-1/sample-0.png',
            stream,
            { name: 'features/feature-1/sample-0.png', description: 'reference' },
        )
    })

    it('resolves samples beyond the former three-preview limit by stored index', () => {
        const laterSample = { idx: 12, subject: 'later sample', ext: 'png', fileId: 'features/feature-1/sample-12.png' }
        const featureWithLaterSample = { ...feature, sampleImages: [...feature.sampleImages, laterSample] }

        expect(findFeatureSampleRef(featureWithLaterSample, 12)).toEqual(laterSample)
    })
})
