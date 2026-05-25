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
    type MediaLibraryScope,
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

export const canReadMediaLibraryItem = (
    item: MediaLibraryImageItem,
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
    }): Promise<MediaLibraryImageMeta[]> => {
        const records: MediaLibraryImageMeta[] = []
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
                records.push(...(result?.items ?? []) as MediaLibraryImageMeta[])
            }
        }

        const normalizedQuery = query?.trim().toLowerCase()
        return records
            .filter((item) => item.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE)
            .filter((item) => {
                const readableItem = {
                    ...item,
                    asset: {
                        bucketName: '',
                        objectKey: '',
                        mimeType: item.mimeType,
                        byteSize: item.byteSize,
                        originalName: item.displayName,
                    },
                    image: {
                        width: item.width,
                        height: item.height,
                        aspectRatio: item.aspectRatio,
                    },
                    sourceFileId: '',
                    version: 1 as const,
                } satisfies MediaLibraryImageItem
                return canReadMediaLibraryItem(readableItem, requesterContext)
            })
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

    listWorkspaceItemsForCleanup: async (workspaceId: string): Promise<MediaLibraryImageItem[]> => {
        const result = await dynamoDBService.queryItems({
            tableName: itemTableName(),
            indexName: 'scopeAndOwner',
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId) },
            fetchAllItems: true,
            scanIndexForward: false,
            origin: `MediaLibraryItem.listWorkspaceItemsForCleanup(${workspaceId})`,
        })
        return ((result?.items ?? []) as MediaLibraryImageItem[])
            .filter((item) => item.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE && item.scope === MEDIA_LIBRARY_SCOPE.WORKSPACE)
    },
}
