'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Feature } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getObject: vi.fn(),
    getObjectStream: vi.fn(),
    putObjectFromReadable: vi.fn(),
    getObjectStore: vi.fn(),
    createObjectStore: vi.fn(),
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
    scope: 'organization',
    scopeOwnerId: 'org-1',
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

    it('reads sample bytes only from the durable, org-scoped bucket', async () => {
        const data = new Uint8Array([1, 2, 3])
        mocks.getObject.mockResolvedValueOnce(data)

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(result).toBe(data)
        expect(mocks.getObject).toHaveBeenCalledTimes(1)
        expect(mocks.getObject).toHaveBeenCalledWith('feature-organization-org-1-files', 'features/feature-1/sample-0.png')
    })

    it('never falls back to the workspace bucket when the durable object is missing', async () => {
        mocks.getObject.mockRejectedValueOnce(new Error('missing durable copy'))

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(result).toBeNull()
        // Only the durable bucket is consulted — features are decoupled from the workspace.
        expect(mocks.getObject).toHaveBeenCalledTimes(1)
        expect(mocks.getObject).toHaveBeenCalledWith('feature-organization-org-1-files', 'features/feature-1/sample-0.png')
    })

    it('copies extraction scratch bytes into the durable bucket at creation, creating it on demand', async () => {
        const stream = { readable: true }
        mocks.getObjectStore.mockRejectedValueOnce(new Error('object store not found'))
        mocks.createObjectStore.mockResolvedValueOnce({})
        mocks.getObject.mockRejectedValueOnce(new Error('missing destination'))
        mocks.getObjectStream.mockResolvedValueOnce(stream)

        await ensureFeatureSamplesForScope({ feature })

        // Durable bucket is created on demand the first time samples are saved for the org.
        expect(mocks.createObjectStore).toHaveBeenCalledWith(
            'feature-organization-org-1-files',
            expect.objectContaining({ description: expect.any(String) }),
        )
        // Source bytes are pulled from the origin workspace scratch bucket...
        expect(mocks.getObjectStream).toHaveBeenCalledWith('workspace-workspace-1-files', 'features/feature-1/sample-0.png')
        // ...and written into the durable, workspace-independent bucket.
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'feature-organization-org-1-files',
            'features/feature-1/sample-0.png',
            stream,
            { name: 'features/feature-1/sample-0.png', description: 'reference' },
        )
    })

    it('throws when a sample has no source bytes to make durable', async () => {
        mocks.getObjectStore.mockResolvedValueOnce({})
        mocks.getObject.mockRejectedValueOnce(new Error('missing destination'))
        mocks.getObjectStream.mockRejectedValueOnce(new Error('not in workspace'))

        await expect(ensureFeatureSamplesForScope({ feature }))
            .rejects.toThrow('Feature sample object not found')
    })

    it('resolves samples beyond the former three-preview limit by stored index', () => {
        const laterSample = { idx: 12, subject: 'later sample', ext: 'png', fileId: 'features/feature-1/sample-12.png' }
        const featureWithLaterSample = { ...feature, sampleImages: [...feature.sampleImages, laterSample] }

        expect(findFeatureSampleRef(featureWithLaterSample, 12)).toEqual(laterSample)
    })
})
