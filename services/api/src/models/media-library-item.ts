'use strict'

import * as process from 'process'

import {
    getDynamoDbTableStageName,
    ACCESS_LEVEL,
    MEDIA_LIBRARY_ITEM_STATUS,
    MEDIA_LIBRARY_SCOPE,
    type MediaLibraryAccessList,
    type MediaLibraryImageItem,
    type MediaLibraryImageMeta,
    type MediaLibraryItem,
    type MediaLibraryMeta,
    type MediaLibraryScope,
    type MediaLibraryVideoItem,
    type MediaLibraryVideoMeta,
} from '@lixpi/constants'

const { ORG_NAME, STAGE } = process.env

export type MediaLibraryRequesterContext = {
    userId: string
    workspaceIds?: string[]
    organizationIds?: string[]
}

export const buildMediaLibraryScopeAndOwnerKey = (
    scope: MediaLibraryScope,
    scopeOwnerId: string
): string => `${scope}#${scopeOwnerId}`

// Widened to accept either kind. Access check is identical across image and
// video — both share the same scope/owner model. Meta records carry the same
// scope fields, so the check works on either an item or a meta record.
export const canReadMediaLibraryItem = (
    item: {
        status: typeof MEDIA_LIBRARY_ITEM_STATUS[keyof typeof MEDIA_LIBRARY_ITEM_STATUS]
        ownerUserId: string
        scope: MediaLibraryScope
        scopeOwnerId: string
    },
    requesterContext: MediaLibraryRequesterContext
): boolean => {
    if (item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) return false
    if (item.ownerUserId === requesterContext.userId) return true
    if (item.scope === MEDIA_LIBRARY_SCOPE.PUBLIC) return true
    if (item.scope === MEDIA_LIBRARY_SCOPE.USER) return item.scopeOwnerId === requesterContext.userId
    if (item.scope === MEDIA_LIBRARY_SCOPE.WORKSPACE) return requesterContext.workspaceIds?.includes(item.scopeOwnerId) ?? false
    return requesterContext.organizationIds?.includes(item.scopeOwnerId) ?? false
}

const buildMeta = (item: MediaLibraryImageItem): MediaLibraryImageMeta => ({
    itemId: item.itemId,
    kind: item.kind,
    displayName: item.displayName,
    ownerUserId: item.ownerUserId,
    originWorkspaceId: item.originWorkspaceId,
    scope: item.scope,
    scopeOwnerId: item.scopeOwnerId,
    scopeAndOwner: item.scopeAndOwner,
    status: item.status,
    mimeType: item.asset.mimeType,
    byteSize: item.asset.byteSize,
    width: item.image.width,
    height: item.image.height,
    aspectRatio: item.image.aspectRatio,
    previewUrl: `/api/media-library/items/${item.itemId}/content`,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
})

const buildVideoMeta = (item: MediaLibraryVideoItem): MediaLibraryVideoMeta => ({
    itemId: item.itemId,
    kind: item.kind,
    displayName: item.displayName,
    ownerUserId: item.ownerUserId,
    originWorkspaceId: item.originWorkspaceId,
    scope: item.scope,
    scopeOwnerId: item.scopeOwnerId,
    scopeAndOwner: item.scopeAndOwner,
    status: item.status,
    mimeType: item.asset.mimeType,
    byteSize: item.asset.byteSize,
    durationSeconds: item.video.durationSeconds,
    aspectRatio: item.video.aspectRatio,
    hasAudio: item.video.hasAudio,
    ...(typeof item.video.width === 'number' ? { width: item.video.width } : {}),
    ...(typeof item.video.height === 'number' ? { height: item.video.height } : {}),
    previewUrl: `/api/media-library/items/${item.itemId}/content`,
    ...(item.poster ? { posterPreviewUrl: `/api/media-library/items/${item.itemId}/poster` } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
})

const itemTableName = () => getDynamoDbTableStageName('MEDIA_LIBRARY_ITEMS', ORG_NAME, STAGE)
const metaTableName = () => getDynamoDbTableStageName('MEDIA_LIBRARY_ITEMS_META', ORG_NAME, STAGE)
const accessListTableName = () => getDynamoDbTableStageName('MEDIA_LIBRARY_ITEMS_ACCESS_LIST', ORG_NAME, STAGE)

export default {
    createImageItem: async (item: MediaLibraryImageItem): Promise<MediaLibraryImageItem> => {
        const meta = buildMeta(item)
        const ownerAccess: MediaLibraryAccessList = {
            itemId: item.itemId,
            principalId: item.ownerUserId,
            accessLevel: ACCESS_LEVEL.OWNER,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        }

        await dynamoDBService.putItem({
            tableName: itemTableName(),
            item,
            origin: 'MediaLibraryItem.createImageItem',
        })
        try {
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: meta,
                origin: 'MediaLibraryItem.createImageItem:meta',
            })
            await dynamoDBService.putItem({
                tableName: accessListTableName(),
                item: ownerAccess,
                origin: 'MediaLibraryItem.createImageItem:accessList',
            })
        } catch (error) {
            await dynamoDBService.deleteItems({
                tableName: itemTableName(),
                key: { itemId: item.itemId, version: item.version },
                origin: 'MediaLibraryItem.createImageItem:rollback',
            }).catch(() => {})
            await dynamoDBService.deleteItems({
                tableName: metaTableName(),
                key: { itemId: item.itemId },
                origin: 'MediaLibraryItem.createImageItem:metaRollback',
            }).catch(() => {})
            throw error
        }

        return item
    },

    getImageItem: async ({
        itemId,
        requesterContext,
    }: {
        itemId: string
        requesterContext: MediaLibraryRequesterContext
    }): Promise<MediaLibraryImageItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getImageItem(${itemId})`,
        }) as MediaLibraryImageItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (!canReadMediaLibraryItem(item, requesterContext)) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    getOwnedImageItem: async ({
        itemId,
        userId,
    }: {
        itemId: string
        userId: string
    }): Promise<MediaLibraryImageItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getOwnedImageItem(${itemId})`,
        }) as MediaLibraryImageItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (item.ownerUserId !== userId) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    listAvailable: async ({
        scopes,
        scopeOwnerIds,
        requesterContext,
        query,
    }: {
        scopes: MediaLibraryScope[]
        scopeOwnerIds: Partial<Record<MediaLibraryScope, string[]>>
        requesterContext: MediaLibraryRequesterContext
        query?: string
    }): Promise<MediaLibraryMeta[]> => {
        // Meta table is kind-mixed; rows discriminate on `kind`. canReadMediaLibraryItem
        // checks scope/owner fields only, which both meta shapes carry.
        const records: MediaLibraryMeta[] = []
        for (const scope of scopes) {
            for (const scopeOwnerId of scopeOwnerIds[scope] ?? []) {
                const result = await dynamoDBService.queryItems({
                    tableName: metaTableName(),
                    indexName: 'scopeAndOwner',
                    keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(scope, scopeOwnerId) },
                    fetchAllItems: true,
                    scanIndexForward: false,
                    origin: `MediaLibraryItem.listAvailable(${scope})`,
                })
                records.push(...(result?.items ?? []) as MediaLibraryMeta[])
            }
        }

        const normalizedQuery = query?.trim().toLowerCase()
        return records
            .filter((item) => item.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE)
            .filter((item) => canReadMediaLibraryItem(item, requesterContext))
            .filter((item) => !normalizedQuery || item.displayName.toLowerCase().includes(normalizedQuery))
            .sort((left, right) => right.updatedAt - left.updatedAt)
    },

    changeScope: async ({
        item,
        newScope,
        newScopeOwnerId,
        newAsset,
    }: {
        item: MediaLibraryImageItem
        newScope: MediaLibraryScope
        newScopeOwnerId: string
        newAsset: MediaLibraryImageItem['asset']
    }): Promise<MediaLibraryImageItem> => {
        const updatedItem: MediaLibraryImageItem = {
            ...item,
            scope: newScope,
            scopeOwnerId: newScopeOwnerId,
            scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(newScope, newScopeOwnerId),
            asset: newAsset,
            updatedAt: Date.now(),
        }
        try {
            await dynamoDBService.putItem({
                tableName: itemTableName(),
                item: updatedItem,
                origin: 'MediaLibraryItem.changeScope',
            })
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: buildMeta(updatedItem),
                origin: 'MediaLibraryItem.changeScope:meta',
            })
        } catch (error) {
            await dynamoDBService.putItem({
                tableName: itemTableName(),
                item,
                origin: 'MediaLibraryItem.changeScope:rollback',
            }).catch(() => {})
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: buildMeta(item),
                origin: 'MediaLibraryItem.changeScope:metaRollback',
            }).catch(() => {})
            throw error
        }
        return updatedItem
    },

    deleteImageItem: async ({ item }: { item: MediaLibraryImageItem }): Promise<void> => {
        await dynamoDBService.deleteItems({
            tableName: itemTableName(),
            key: { itemId: item.itemId, version: item.version },
            origin: 'MediaLibraryItem.deleteImageItem',
        })
        await dynamoDBService.deleteItems({
            tableName: metaTableName(),
            key: { itemId: item.itemId },
            origin: 'MediaLibraryItem.deleteImageItem:meta',
        })
        await dynamoDBService.deleteItems({
            tableName: accessListTableName(),
            key: { principalId: item.ownerUserId, itemId: item.itemId },
            origin: 'MediaLibraryItem.deleteImageItem:accessList',
        })
    },

    // Dedup lookup: a workspace save always lands at scope='workspace', so the same
    // source image re-saved into the same workspace by the same owner is reused, not copied again.
    findActiveWorkspaceImageBySource: async ({
        workspaceId,
        sourceFileId,
        userId,
    }: {
        workspaceId: string
        sourceFileId: string
        userId: string
    }): Promise<MediaLibraryImageItem | undefined> => {
        const result = await dynamoDBService.queryItems({
            tableName: itemTableName(),
            indexName: 'scopeAndOwner',
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId) },
            fetchAllItems: true,
            scanIndexForward: false,
            origin: `MediaLibraryItem.findActiveWorkspaceImageBySource(${workspaceId})`,
        })
        return ((result?.items ?? []) as MediaLibraryImageItem[])
            .find((existing) => existing.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE
                && existing.sourceFileId === sourceFileId
                && existing.ownerUserId === userId)
    },

    listWorkspaceItemsForCleanup: async (workspaceId: string): Promise<MediaLibraryItem[]> => {
        // Workspace cleanup must reap both kinds of items — the item table is
        // kind-mixed, so we widen to the union and downstream callers branch
        // on `item.kind` to pick the right asset-deletion helper.
        const result = await dynamoDBService.queryItems({
            tableName: itemTableName(),
            indexName: 'scopeAndOwner',
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId) },
            fetchAllItems: true,
            scanIndexForward: false,
            origin: `MediaLibraryItem.listWorkspaceItemsForCleanup(${workspaceId})`,
        })
        return ((result?.items ?? []) as MediaLibraryItem[])
            .filter((item) => item.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE && item.scope === MEDIA_LIBRARY_SCOPE.WORKSPACE)
    },

    // =============================================================================
    // VIDEO ITEM CRUD — mirrors the image surface 1:1, with separate keys so the
    // image-only callers don't need to widen their return-type expectations.
    // =============================================================================

    createVideoItem: async (item: MediaLibraryVideoItem): Promise<MediaLibraryVideoItem> => {
        const meta = buildVideoMeta(item)
        const ownerAccess: MediaLibraryAccessList = {
            itemId: item.itemId,
            principalId: item.ownerUserId,
            accessLevel: ACCESS_LEVEL.OWNER,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        }

        await dynamoDBService.putItem({
            tableName: itemTableName(),
            item,
            origin: 'MediaLibraryItem.createVideoItem',
        })
        try {
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: meta,
                origin: 'MediaLibraryItem.createVideoItem:meta',
            })
            await dynamoDBService.putItem({
                tableName: accessListTableName(),
                item: ownerAccess,
                origin: 'MediaLibraryItem.createVideoItem:accessList',
            })
        } catch (error) {
            await dynamoDBService.deleteItems({
                tableName: itemTableName(),
                key: { itemId: item.itemId, version: item.version },
                origin: 'MediaLibraryItem.createVideoItem:rollback',
            }).catch(() => {})
            await dynamoDBService.deleteItems({
                tableName: metaTableName(),
                key: { itemId: item.itemId },
                origin: 'MediaLibraryItem.createVideoItem:metaRollback',
            }).catch(() => {})
            throw error
        }

        return item
    },

    getVideoItem: async ({
        itemId,
        requesterContext,
    }: {
        itemId: string
        requesterContext: MediaLibraryRequesterContext
    }): Promise<MediaLibraryVideoItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getVideoItem(${itemId})`,
        }) as MediaLibraryVideoItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (item.kind !== 'video') {
            return { error: 'NOT_FOUND' }
        }
        if (!canReadMediaLibraryItem(item, requesterContext)) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    getOwnedVideoItem: async ({
        itemId,
        userId,
    }: {
        itemId: string
        userId: string
    }): Promise<MediaLibraryVideoItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getOwnedVideoItem(${itemId})`,
        }) as MediaLibraryVideoItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (item.kind !== 'video' || item.ownerUserId !== userId) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    // Either-kind getter for the GET subject + content/poster routes — they
    // don't know the kind in advance and the meta `previewUrl` is the same
    // route for both. Returns the kind-discriminated item so callers can
    // pick MP4 vs PNG path.
    getAnyItem: async ({
        itemId,
        requesterContext,
    }: {
        itemId: string
        requesterContext: MediaLibraryRequesterContext
    }): Promise<MediaLibraryItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getAnyItem(${itemId})`,
        }) as MediaLibraryItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (!canReadMediaLibraryItem(item, requesterContext)) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    // Owner-only getter that doesn't pin to a specific kind. Used by
    // change-scope and delete which must work on either kind.
    getOwnedAnyItem: async ({
        itemId,
        userId,
    }: {
        itemId: string
        userId: string
    }): Promise<MediaLibraryItem | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId, version: 1 },
            origin: `MediaLibraryItem.getOwnedAnyItem(${itemId})`,
        }) as MediaLibraryItem | undefined

        if (!item || Object.keys(item).length === 0 || item.status !== MEDIA_LIBRARY_ITEM_STATUS.ACTIVE) {
            return { error: 'NOT_FOUND' }
        }
        if (item.ownerUserId !== userId) {
            return { error: 'PERMISSION_DENIED' }
        }
        return item
    },

    changeScopeVideo: async ({
        item,
        newScope,
        newScopeOwnerId,
        newAsset,
        newPoster,
    }: {
        item: MediaLibraryVideoItem
        newScope: MediaLibraryScope
        newScopeOwnerId: string
        newAsset: MediaLibraryVideoItem['asset']
        newPoster: MediaLibraryVideoItem['poster']
    }): Promise<MediaLibraryVideoItem> => {
        const updatedItem: MediaLibraryVideoItem = {
            ...item,
            scope: newScope,
            scopeOwnerId: newScopeOwnerId,
            scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(newScope, newScopeOwnerId),
            asset: newAsset,
            ...(newPoster ? { poster: newPoster } : { poster: undefined }),
            updatedAt: Date.now(),
        }
        try {
            await dynamoDBService.putItem({
                tableName: itemTableName(),
                item: updatedItem,
                origin: 'MediaLibraryItem.changeScopeVideo',
            })
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: buildVideoMeta(updatedItem),
                origin: 'MediaLibraryItem.changeScopeVideo:meta',
            })
        } catch (error) {
            await dynamoDBService.putItem({
                tableName: itemTableName(),
                item,
                origin: 'MediaLibraryItem.changeScopeVideo:rollback',
            }).catch(() => {})
            await dynamoDBService.putItem({
                tableName: metaTableName(),
                item: buildVideoMeta(item),
                origin: 'MediaLibraryItem.changeScopeVideo:metaRollback',
            }).catch(() => {})
            throw error
        }
        return updatedItem
    },

    deleteVideoItem: async ({ item }: { item: MediaLibraryVideoItem }): Promise<void> => {
        await dynamoDBService.deleteItems({
            tableName: itemTableName(),
            key: { itemId: item.itemId, version: item.version },
            origin: 'MediaLibraryItem.deleteVideoItem',
        })
        await dynamoDBService.deleteItems({
            tableName: metaTableName(),
            key: { itemId: item.itemId },
            origin: 'MediaLibraryItem.deleteVideoItem:meta',
        })
        await dynamoDBService.deleteItems({
            tableName: accessListTableName(),
            key: { principalId: item.ownerUserId, itemId: item.itemId },
            origin: 'MediaLibraryItem.deleteVideoItem:accessList',
        })
    },

    findActiveWorkspaceVideoBySource: async ({
        workspaceId,
        sourceFileId,
        userId,
    }: {
        workspaceId: string
        sourceFileId: string
        userId: string
    }): Promise<MediaLibraryVideoItem | undefined> => {
        const result = await dynamoDBService.queryItems({
            tableName: itemTableName(),
            indexName: 'scopeAndOwner',
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId) },
            fetchAllItems: true,
            scanIndexForward: false,
            origin: `MediaLibraryItem.findActiveWorkspaceVideoBySource(${workspaceId})`,
        })
        return ((result?.items ?? []) as MediaLibraryItem[])
            .filter((it): it is MediaLibraryVideoItem => it.kind === 'video')
            .find((existing) => existing.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE
                && existing.sourceFileId === sourceFileId
                && existing.ownerUserId === userId)
    },
}
