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
    it('workspace import does not wipe the workspace bucket before writing archive objects', () => {
        const source = readSource('../routes/workspace-export-routes.ts')

        expectSourceNotToContain(source, 'ensureObjectStore', 'workspace export/import route')
        const putImageIndex = source.indexOf('await natsService.putObject(bucketName, image.fileId')
        const deleteBucketIndex = source.indexOf('await natsService.deleteObjectStore(bucketName)')
        const missingArchiveCheckIndex = source.indexOf('missingArchiveFileIds.length > 0')
        const deleteDocumentsIndex = source.indexOf('Document.deleteWorkspaceDocuments({ workspaceId })')

        expect(putImageIndex, 'workspace import should write image objects').toBeGreaterThan(-1)
        expect(deleteBucketIndex, 'workspace import should not destroy the bucket').toBe(-1)
        expect(missingArchiveCheckIndex, 'workspace import should validate archive object completeness').toBeGreaterThan(-1)
        expect(deleteDocumentsIndex, 'workspace import should delete documents after validation').toBeGreaterThan(-1)
        expect(missingArchiveCheckIndex, 'workspace import should validate before document deletion')
            .toBeLessThan(deleteDocumentsIndex)
    })

    it('workspace creation provisions only the workspace file bucket (media buckets are org-scoped)', () => {
        const source = readSource('../NATS/subscriptions/workspace-subjects.ts')

        expectSourceToContain(
            source,
            'await natsService.createObjectStore(bucketName',
            'workspace create handler'
        )
        expectSourceToContain(
            source,
            'await natsService.deleteObjectStore(bucketName).catch(() => {})',
            'workspace create rollback'
        )
        // No per-workspace media-library bucket is provisioned anymore.
        expectSourceNotToContain(
            source,
            'getMediaLibraryWorkspaceBucketName',
            'workspace create handler'
        )
        expectSourceNotToContain(
            source,
            'createObjectStore(mediaLibraryBucketName',
            'workspace create handler'
        )
    })

    it('media-library buckets are org-scoped and created on demand at save time', () => {
        const source = readSource('./media-library-storage.ts')

        expectSourceToContain(
            source,
            '`media-library-${scope}-${scopeOwnerId}-files`',
            'media-library bucket name'
        )
        expectSourceToContain(
            source,
            'const ensureMediaLibraryBucket',
            'on-demand bucket creation'
        )
        // The per-workspace media bucket helpers were removed with org-wide scoping.
        expectSourceNotToContain(
            source,
            'getMediaLibraryWorkspaceBucketName',
            'media-library storage'
        )
    })
})
