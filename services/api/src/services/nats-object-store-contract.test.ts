'use strict'

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (relativeUrl: string): string =>
    readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')

function expectSourceToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`
    ).toBe(false)
}

// =============================================================================
// API STORAGE BUCKET CONTRACT
// =============================================================================

describe('API storage bucket contract', () => {
    it('workspace import explicitly recreates the wiped workspace bucket before image writes', () => {
        const source = readSource('../routes/workspace-export-routes.ts')

        expectSourceNotToContain(source, 'ensureObjectStore', 'workspace export/import route')
        const createBucketIndex = source.indexOf('await natsService.createObjectStore(bucketName)')
        const putImageIndex = source.indexOf('await natsService.putObject(bucketName, image.fileId')

        expect(createBucketIndex, 'workspace import should create the bucket explicitly').toBeGreaterThan(-1)
        expect(putImageIndex, 'workspace import should write image objects').toBeGreaterThan(-1)
        expect(createBucketIndex, 'workspace import should create the bucket before writing images')
            .toBeLessThan(putImageIndex)
    })

    it('workspace creation provisions both primary and media-library buckets and rolls back both on failure', () => {
        const source = readSource('../NATS/subscriptions/workspace-subjects.ts')

        expectSourceToContain(
            source,
            'const mediaLibraryBucketName = getMediaLibraryWorkspaceBucketName(workspace.workspaceId)',
            'workspace create handler'
        )
        expectSourceToContain(
            source,
            'await natsService.createObjectStore(bucketName',
            'workspace create handler'
        )
        expectSourceToContain(
            source,
            'await natsService.createObjectStore(mediaLibraryBucketName',
            'workspace create handler'
        )
        expectSourceToContain(
            source,
            'await natsService.deleteObjectStore(bucketName).catch(() => {})',
            'workspace create rollback'
        )
        expectSourceToContain(
            source,
            'await natsService.deleteObjectStore(mediaLibraryBucketName).catch(() => {})',
            'workspace create rollback'
        )
    })

    it('media-library workspace bucket naming is centralized for create and delete paths', () => {
        const source = readSource('./media-library-storage.ts')

        expectSourceToContain(
            source,
            'export const getMediaLibraryWorkspaceBucketName = (workspaceId: string): string =>',
            'media-library storage'
        )
        expectSourceToContain(
            source,
            'deleteObjectStore(getMediaLibraryWorkspaceBucketName(workspaceId))',
            'media-library workspace bucket delete'
        )
    })
})
