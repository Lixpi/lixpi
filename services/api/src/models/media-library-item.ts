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
    // Media is org-wide: any member of the owning organization can read it.
    // 'shared' (external sharing) has no allow path yet — deferred to a future release.
    if (item.scope === MEDIA_LIBRARY_SCOPE.ORGANIZATION) {
        return requesterContext.organizationIds?.includes(item.scopeOwnerId) ?? false
    }
    return false
}

const buildMeta = (item: MediaLibraryImageItem): MediaLibraryImageMeta => ({
    itemId: item.itemId,
    kind: item.kind,
    displayName: item.displayName,
    ownerUserId: item.ownerUserId,
    originWorkspaceId: item.originWorkspaceId,
    sourceFileId: item.sourceFileId,
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
    sourceFileId: item.sourceFileId,
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

        // All three rows commit or fail together — atomicity is the database's job.
        await dynamoDBService.transactWrite({
            operations: [
                { type: 'put', tableName: itemTableName(), item },
                { type: 'put', tableName: metaTableName(), item: meta },
                { type: 'put', tableName: accessListTableName(), item: ownerAccess },
            ],
            origin: 'MediaLibraryItem.createImageItem',
        })

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
                    keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(scope, scopeOwnerId) },
                    fetchAllItems: true,
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

    deleteImageItem: async ({ item }: { item: MediaLibraryImageItem }): Promise<void> => {
        await dynamoDBService.transactWrite({
            operations: [
                { type: 'delete', tableName: itemTableName(), key: { itemId: item.itemId, version: item.version } },
                { type: 'delete', tableName: metaTableName(), key: { scopeAndOwner: item.scopeAndOwner, itemId: item.itemId } },
                { type: 'delete', tableName: accessListTableName(), key: { principalId: item.ownerUserId, itemId: item.itemId } },
            ],
            origin: 'MediaLibraryItem.deleteImageItem',
        })
    },

    // Dedup lookup: a save always lands at scope='organization', so the same source
    // image re-saved into the same org by the same owner is reused, not copied again.
    findActiveOrgImageBySource: async ({
        organizationId,
        sourceFileId,
        userId,
    }: {
        organizationId: string
        sourceFileId: string
        userId: string
    }): Promise<MediaLibraryImageItem | undefined> => {
        // The meta projection carries sourceFileId precisely so dedup can run
        // against the scope partition; the full body is a point read after a hit.
        const result = await dynamoDBService.queryItems({
            tableName: metaTableName(),
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.ORGANIZATION, organizationId) },
            fetchAllItems: true,
            origin: `MediaLibraryItem.findActiveOrgImageBySource(${organizationId})`,
        })
        const match = ((result?.items ?? []) as MediaLibraryMeta[])
            .find((existing) => existing.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE
                && existing.kind === 'image'
                && existing.sourceFileId === sourceFileId
                && existing.ownerUserId === userId)
        if (!match) return undefined
        return await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId: match.itemId, version: 1 },
            origin: `MediaLibraryItem.findActiveOrgImageBySource(${organizationId}):item`,
        }) as MediaLibraryImageItem | undefined
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

        // All three rows commit or fail together — atomicity is the database's job.
        await dynamoDBService.transactWrite({
            operations: [
                { type: 'put', tableName: itemTableName(), item },
                { type: 'put', tableName: metaTableName(), item: meta },
                { type: 'put', tableName: accessListTableName(), item: ownerAccess },
            ],
            origin: 'MediaLibraryItem.createVideoItem',
        })

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

    deleteVideoItem: async ({ item }: { item: MediaLibraryVideoItem }): Promise<void> => {
        await dynamoDBService.transactWrite({
            operations: [
                { type: 'delete', tableName: itemTableName(), key: { itemId: item.itemId, version: item.version } },
                { type: 'delete', tableName: metaTableName(), key: { scopeAndOwner: item.scopeAndOwner, itemId: item.itemId } },
                { type: 'delete', tableName: accessListTableName(), key: { principalId: item.ownerUserId, itemId: item.itemId } },
            ],
            origin: 'MediaLibraryItem.deleteVideoItem',
        })
    },

    findActiveOrgVideoBySource: async ({
        organizationId,
        sourceFileId,
        userId,
    }: {
        organizationId: string
        sourceFileId: string
        userId: string
    }): Promise<MediaLibraryVideoItem | undefined> => {
        // Same meta-partition dedup path as the image lookup.
        const result = await dynamoDBService.queryItems({
            tableName: metaTableName(),
            keyConditions: { scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.ORGANIZATION, organizationId) },
            fetchAllItems: true,
            origin: `MediaLibraryItem.findActiveOrgVideoBySource(${organizationId})`,
        })
        const match = ((result?.items ?? []) as MediaLibraryMeta[])
            .find((existing) => existing.status === MEDIA_LIBRARY_ITEM_STATUS.ACTIVE
                && existing.kind === 'video'
                && existing.sourceFileId === sourceFileId
                && existing.ownerUserId === userId)
        if (!match) return undefined
        return await dynamoDBService.getItem({
            tableName: itemTableName(),
            key: { itemId: match.itemId, version: 1 },
            origin: `MediaLibraryItem.findActiveOrgVideoBySource(${organizationId}):item`,
        }) as MediaLibraryVideoItem | undefined
    },
}
