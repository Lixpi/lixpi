'use strict'

import { readFileSync } from 'node:fs'
import {
    describe,
    expect,
    it,
} from 'vitest'

const readSource = (relativeUrl: string): string => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')

function expectSourceToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`,
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`,
    ).toBe(false)
}

// =============================================================================
// API STORAGE BUCKET CONTRACT
// =============================================================================

describe('API storage bucket contract', () => {
    it('Blob storage is organization-scoped, content-addressed, and created on demand', () => {
        const source = readSource('./blob-storage.ts')

        expectSourceToContain(
            source,
            'export const getOrganizationBlobBucketName = (organizationId: string): string =>',
            'blob-storage bucket naming',
        )
        expectSourceToContain(
            source,
            '`blobs-${organizationId}-files`',
            'organization-scoped blob bucket name',
        )
        expectSourceToContain(
            source,
            'export const ensureOrganizationAssetStorage',
            'on-demand bucket creation',
        )
        expectSourceToContain(
            source,
            'await natsService.createObjectStore(bucketName',
            'blob bucket creation',
        )
        // No per-workspace or per-media-library bucket helpers remain — every
        // Blob lives in one org-scoped, content-addressed bucket.
        expectSourceNotToContain(
            source,
            'getMediaLibraryWorkspaceBucketName',
            'blob-storage',
        )
        expectSourceNotToContain(
            source,
            'workspace-${workspaceId}-files',
            'blob-storage',
        )
    })

    it('deleting a content-addressed Blob only removes its own object, never the shared bucket', () => {
        const source = readSource('./blob-storage.ts')

        expectSourceToContain(
            source,
            'export const deleteContentAddressedBlob = async (blob: BlobRecord): Promise<void> => {',
            'blob deletion',
        )
        expectSourceToContain(
            source,
            'await natsService.deleteObject(blob.bucketName, blob.objectKey)',
            'blob deletion',
        )
        expectSourceNotToContain(
            source,
            'await natsService.deleteObjectStore(',
            'blob-storage',
        )
    })

    it('workspace creation does not provision a per-workspace Object Store bucket', () => {
        const source = readSource('../NATS/subscriptions/workspace-subjects.ts')

        expectSourceNotToContain(
            source,
            'createObjectStore',
            'workspace create handler',
        )
        expectSourceNotToContain(
            source,
            'ObjectStore',
            'workspace subjects handlers',
        )
    })
})
