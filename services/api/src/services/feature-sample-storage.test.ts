'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Feature } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getObject: vi.fn(),
    blobGet: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ getObject: mocks.getObject }),
    },
}))

vi.mock('../models/blob.ts', () => ({
    default: { get: mocks.blobGet },
}))

import { findFeatureSampleRef, readFeatureSampleObject } from './feature-sample-storage.ts'

const feature: Feature = {
    featureId: 'feature-1',
    version: 1,
    category: 'illustration-style',
    name: 'painted-light',
    summary: 'Soft painted illumination.',
    tags: [],
    instructions: '',
    parameters: {},
    sampleImages: [{ idx: 0, subject: 'reference', ext: 'png', blobHash: 'a'.repeat(64) }],
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

const blobRecord = {
    blobKey: `org-1#${'a'.repeat(64)}`,
    blobHash: 'a'.repeat(64),
    organizationId: 'org-1',
    bucketName: 'blobs-org-1-files',
    objectKey: `sha256/aa/${'a'.repeat(64)}`,
    mimeType: 'image/png',
    byteSize: 3,
    status: 'active',
    referenceCount: 1,
    createdAt: 1,
    updatedAt: 1,
}

describe('Feature sample storage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('reads sample bytes from the organization Blob bucket', async () => {
        const data = new Uint8Array([1, 2, 3])
        mocks.blobGet.mockResolvedValueOnce(blobRecord)
        mocks.getObject.mockResolvedValueOnce(data)

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(result).toBe(data)
        expect(mocks.blobGet).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'a'.repeat(64) })
        expect(mocks.getObject).toHaveBeenCalledTimes(1)
        expect(mocks.getObject).toHaveBeenCalledWith('blobs-org-1-files', `sha256/aa/${'a'.repeat(64)}`)
    })

    it('returns null when the Blob registry has no entry for the sample', async () => {
        mocks.blobGet.mockResolvedValueOnce(undefined)

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(result).toBeNull()
        expect(mocks.getObject).not.toHaveBeenCalled()
    })

    it('returns null when the durable object bytes are missing', async () => {
        mocks.blobGet.mockResolvedValueOnce(blobRecord)
        mocks.getObject.mockRejectedValueOnce(new Error('missing durable copy'))

        const result = await readFeatureSampleObject({ feature, sample: feature.sampleImages[0] })

        expect(result).toBeNull()
        expect(mocks.getObject).toHaveBeenCalledTimes(1)
    })

    it('resolves samples beyond the former three-preview limit by stored index', () => {
        const laterSample = { idx: 12, subject: 'later sample', ext: 'png', blobHash: 'b'.repeat(64) }
        const featureWithLaterSample = { ...feature, sampleImages: [...feature.sampleImages, laterSample] }

        expect(findFeatureSampleRef(featureWithLaterSample, 12)).toEqual(laterSample)
    })
})
