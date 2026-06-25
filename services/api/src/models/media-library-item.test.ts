'use strict'

import { describe, expect, it } from 'vitest'

import type { MediaLibraryImageItem, MediaLibraryScope } from '@lixpi/constants'

import {
    buildMediaLibraryScopeAndOwnerKey,
    canReadMediaLibraryItem,
} from './media-library-item.ts'

const makeItem = (
    scope: MediaLibraryScope,
    scopeOwnerId: string,
    overrides: Partial<MediaLibraryImageItem> = {}
): MediaLibraryImageItem => ({
    itemId: 'item-1',
    version: 1,
    kind: 'image',
    displayName: 'Reference image',
    ownerUserId: 'owner-1',
    originWorkspaceId: 'workspace-1',
    sourceFileId: 'file-1',
    scope,
    scopeOwnerId,
    scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(scope, scopeOwnerId),
    status: 'active',
    asset: {
        bucketName: 'bucket-1',
        objectKey: 'item-1',
        mimeType: 'image/png',
        byteSize: 42,
        originalName: 'reference.png',
    },
    image: {
        width: 100,
        height: 80,
        aspectRatio: 1.25,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

describe('Media Library access rules', () => {
    it('uses a stable scope and owner lookup key', () => {
        expect(buildMediaLibraryScopeAndOwnerKey('organization', 'organization-1'))
            .toBe('organization#organization-1')
    })

    it('grants access to a member of the owning organization', () => {
        // A different user than the owner, but same org, can read it.
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1'), {
            userId: 'member-1',
            organizationIds: ['organization-1'],
        })).toBe(true)
    })

    it('denies access to members of a different organization', () => {
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1'), {
            userId: 'member-1',
            organizationIds: ['organization-2'],
        })).toBe(false)
    })

    it('denies access when no organization context is supplied', () => {
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1'), {
            userId: 'owner-1',
        })).toBe(false)
    })

    it('denies access to shared-scoped items (deferred to a future release)', () => {
        expect(canReadMediaLibraryItem(makeItem('shared', 'organization-1'), {
            userId: 'owner-1',
            organizationIds: ['organization-1'],
        })).toBe(false)
    })

    it('does not expose deleted items, including to a member of the owning org', () => {
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1', { status: 'deleted' }), {
            userId: 'owner-1',
            organizationIds: ['organization-1'],
        })).toBe(false)
    })
})
