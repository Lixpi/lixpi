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
        expect(buildMediaLibraryScopeAndOwnerKey('workspace', 'workspace-1'))
            .toBe('workspace#workspace-1')
    })

    it('allows active owner, workspace, organization, and public access', () => {
        expect(canReadMediaLibraryItem(makeItem('user', 'owner-1'), { userId: 'owner-1' })).toBe(true)
        expect(canReadMediaLibraryItem(makeItem('workspace', 'workspace-1'), {
            userId: 'member-1',
            workspaceIds: ['workspace-1'],
        })).toBe(true)
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1'), {
            userId: 'member-1',
            organizationIds: ['organization-1'],
        })).toBe(true)
        expect(canReadMediaLibraryItem(makeItem('public', 'public'), { userId: 'member-1' })).toBe(true)
    })

    it('does not expose user-private or unrelated scoped items', () => {
        expect(canReadMediaLibraryItem(makeItem('user', 'owner-1'), { userId: 'member-1' })).toBe(false)
        expect(canReadMediaLibraryItem(makeItem('workspace', 'workspace-1'), {
            userId: 'member-1',
            workspaceIds: ['workspace-2'],
        })).toBe(false)
        expect(canReadMediaLibraryItem(makeItem('organization', 'organization-1'), {
            userId: 'member-1',
            organizationIds: ['organization-2'],
        })).toBe(false)
    })

    it('does not expose deleted items, including to their owner', () => {
        expect(canReadMediaLibraryItem(makeItem('user', 'owner-1', { status: 'deleted' }), {
            userId: 'owner-1',
        })).toBe(false)
    })
})
