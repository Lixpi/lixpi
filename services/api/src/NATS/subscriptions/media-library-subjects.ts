'use strict'

import { info, warn } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    MEDIA_LIBRARY_ITEM_KIND,
    MEDIA_LIBRARY_ITEM_STATUS,
    MEDIA_LIBRARY_PUBLIC_OWNER_ID,
    MEDIA_LIBRARY_SCOPE,
    type MediaLibraryImageItem,
    type MediaLibraryScope,
    type MediaLibraryVideoItem,
} from '@lixpi/constants'

import MediaLibraryItem, {
    buildMediaLibraryScopeAndOwnerKey,
    type MediaLibraryRequesterContext,
} from '../../models/media-library-item.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import {
    copyLibraryImageToScope,
    copyLibraryVideoToScope,
    copyWorkspaceImageToLibrary,
    copyWorkspaceVideoToLibrary,
    deleteLibraryImageObject,
    deleteLibraryVideoObject,
    materializeLibraryImageToWorkspace,
    materializeLibraryVideoToWorkspace,
} from '../../services/media-library-storage.ts'

const { MEDIA_LIBRARY_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const VALID_SCOPES: MediaLibraryScope[] = Object.values(MEDIA_LIBRARY_SCOPE)

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

const getOrganizationIds = async (userId: string, organizationId?: string): Promise<string[]> => {
    if (organizationId) {
        const organization = await Organization.getOrganization({ userId, organizationId })
        return 'error' in organization ? [] : [organizationId]
    }
    const organizations = await Organization.getUserOrganizations({ userId })
    return organizations.map((organization) => organization.organizationId)
}

const getRequesterContext = async ({
    userId,
    workspaceId,
    organizationId,
    includeAllAvailable = false,
}: {
    userId: string
    workspaceId?: string
    organizationId?: string
    includeAllAvailable?: boolean
}): Promise<MediaLibraryRequesterContext> => {
    const workspaceIds: string[] = []
    if (includeAllAvailable) {
        const workspaces = await Workspace.getUserWorkspaces({ userId })
        workspaceIds.push(...workspaces.map((workspace) => workspace.workspaceId))
    } else if (workspaceId && await verifyWorkspaceAccess(userId, workspaceId)) {
        workspaceIds.push(workspaceId)
    }

    return {
        userId,
        workspaceIds,
        organizationIds: await getOrganizationIds(userId, organizationId),
    }
}

const getTargetScopeOwnerId = async ({
    userId,
    workspaceId,
    organizationId,
    scope,
}: {
    userId: string
    workspaceId?: string
    organizationId?: string
    scope: MediaLibraryScope
}): Promise<string | { error: string }> => {
    if (scope === MEDIA_LIBRARY_SCOPE.USER) return userId
    if (scope === MEDIA_LIBRARY_SCOPE.PUBLIC) return MEDIA_LIBRARY_PUBLIC_OWNER_ID
    if (scope === MEDIA_LIBRARY_SCOPE.WORKSPACE) {
        if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
            return { error: 'WORKSPACE_ACCESS_DENIED' }
        }
        return workspaceId
    }
    if (!organizationId || (await getOrganizationIds(userId, organizationId)).length === 0) {
        return { error: 'ORGANIZATION_ACCESS_DENIED' }
    }
    return organizationId
}

export const mediaLibrarySubjects = [
    {
        subject: MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_IMAGE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_IMAGE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_IMAGE, MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED] },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, fileId } = data
            if (!workspaceId || !fileId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }

            const existing = await MediaLibraryItem.findActiveWorkspaceImageBySource({ workspaceId, sourceFileId: fileId, userId })
            if (existing) {
                return {
                    success: true,
                    deduplicated: true,
                    itemId: existing.itemId,
                    kind: existing.kind,
                    displayName: existing.displayName,
                }
            }

            const copied = await copyWorkspaceImageToLibrary({
                workspaceId,
                fileId,
                scope: MEDIA_LIBRARY_SCOPE.WORKSPACE,
                scopeOwnerId: workspaceId,
            })
            const now = Date.now()
            const item: MediaLibraryImageItem = {
                itemId: copied.itemId,
                version: 1,
                kind: MEDIA_LIBRARY_ITEM_KIND.IMAGE,
                displayName: copied.displayName,
                ownerUserId: userId,
                originWorkspaceId: workspaceId,
                sourceFileId: fileId,
                scope: MEDIA_LIBRARY_SCOPE.WORKSPACE,
                scopeOwnerId: workspaceId,
                scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId),
                status: MEDIA_LIBRARY_ITEM_STATUS.ACTIVE,
                asset: copied.asset,
                image: copied.image,
                createdAt: now,
                updatedAt: now,
            }

            try {
                await MediaLibraryItem.createImageItem(item)
            } catch (error) {
                await deleteLibraryImageObject(item).catch(() => {})
                throw error
            }

            NATS_Service.getInstance()?.publish(MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED, {
                type: 'created',
                itemId: item.itemId,
                kind: item.kind,
            })
            return {
                success: true,
                itemId: item.itemId,
                kind: item.kind,
                displayName: item.displayName,
            }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.GET] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.GET] },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, organizationId, itemId } = data
            // Widened to either-kind GET — the client may not know whether a given
            // itemId is image or video. The item is kind-discriminated.
            return MediaLibraryItem.getAnyItem({
                itemId,
                requesterContext: await getRequesterContext({
                    userId,
                    workspaceId,
                    organizationId,
                    includeAllAvailable: true,
                }),
            })
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.LIST_AVAILABLE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.LIST_AVAILABLE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.LIST_AVAILABLE] },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, organizationId, query, includeAllAvailable } = data
            const scopes = ((data.scopes ?? [MEDIA_LIBRARY_SCOPE.WORKSPACE]) as MediaLibraryScope[])
                .filter((scope) => VALID_SCOPES.includes(scope))
            const requesterContext = await getRequesterContext({
                userId,
                workspaceId,
                organizationId,
                includeAllAvailable: Boolean(includeAllAvailable),
            })
            const scopeOwnerIds: Partial<Record<MediaLibraryScope, string[]>> = {
                [MEDIA_LIBRARY_SCOPE.WORKSPACE]: requesterContext.workspaceIds,
                [MEDIA_LIBRARY_SCOPE.USER]: [userId],
                [MEDIA_LIBRARY_SCOPE.ORGANIZATION]: requesterContext.organizationIds,
                [MEDIA_LIBRARY_SCOPE.PUBLIC]: [MEDIA_LIBRARY_PUBLIC_OWNER_ID],
            }
            return {
                items: await MediaLibraryItem.listAvailable({
                    scopes,
                    scopeOwnerIds,
                    requesterContext,
                    query,
                }),
            }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE] },
        },
        handler: async (data: any) => {
            const { user: { userId }, itemId, workspaceId } = data
            if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const item = await MediaLibraryItem.getImageItem({
                itemId,
                requesterContext: await getRequesterContext({ userId, includeAllAvailable: true }),
            })
            if ('error' in item) return item
            const stored = await materializeLibraryImageToWorkspace({ item, workspaceId })
            return { ...stored, itemId, width: item.image.width, height: item.image.height }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_VIDEO,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_VIDEO] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_VIDEO, MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED] },
        },
        handler: async (data: any) => {
            const {
                user: { userId },
                workspaceId,
                fileId,
                posterFileId,
                durationSeconds,
                aspectRatio,
                hasAudio,
            } = data as {
                user: { userId: string }
                workspaceId: string
                fileId: string
                posterFileId?: string
                durationSeconds: number
                aspectRatio: number
                hasAudio: boolean
            }
            if (!workspaceId || !fileId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }

            const existing = await MediaLibraryItem.findActiveWorkspaceVideoBySource({ workspaceId, sourceFileId: fileId, userId })
            if (existing) {
                return {
                    success: true,
                    deduplicated: true,
                    itemId: existing.itemId,
                    kind: existing.kind,
                    displayName: existing.displayName,
                }
            }

            const copied = await copyWorkspaceVideoToLibrary({
                workspaceId,
                fileId,
                posterFileId,
                durationSeconds,
                aspectRatio,
                hasAudio,
                scope: MEDIA_LIBRARY_SCOPE.WORKSPACE,
                scopeOwnerId: workspaceId,
            })
            const now = Date.now()
            const item: MediaLibraryVideoItem = {
                itemId: copied.itemId,
                version: 1,
                kind: MEDIA_LIBRARY_ITEM_KIND.VIDEO,
                displayName: copied.displayName,
                ownerUserId: userId,
                originWorkspaceId: workspaceId,
                sourceFileId: fileId,
                ...(posterFileId ? { sourcePosterFileId: posterFileId } : {}),
                scope: MEDIA_LIBRARY_SCOPE.WORKSPACE,
                scopeOwnerId: workspaceId,
                scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId),
                status: MEDIA_LIBRARY_ITEM_STATUS.ACTIVE,
                asset: copied.asset,
                ...(copied.poster ? { poster: copied.poster } : {}),
                video: copied.video,
                createdAt: now,
                updatedAt: now,
            }

            try {
                await MediaLibraryItem.createVideoItem(item)
            } catch (error) {
                await deleteLibraryVideoObject(item).catch(() => {})
                throw error
            }

            NATS_Service.getInstance()?.publish(MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED, {
                type: 'created',
                itemId: item.itemId,
                kind: item.kind,
            })
            return {
                success: true,
                itemId: item.itemId,
                kind: item.kind,
                displayName: item.displayName,
            }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_VIDEO_TO_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_VIDEO_TO_WORKSPACE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_VIDEO_TO_WORKSPACE] },
        },
        handler: async (data: any) => {
            const { user: { userId }, itemId, workspaceId } = data
            if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const item = await MediaLibraryItem.getVideoItem({
                itemId,
                requesterContext: await getRequesterContext({ userId, includeAllAvailable: true }),
            })
            if ('error' in item) return item
            const stored = await materializeLibraryVideoToWorkspace({ item, workspaceId })
            return {
                itemId,
                video: stored.video,
                ...(stored.poster ? { poster: stored.poster } : {}),
                durationSeconds: item.video.durationSeconds,
                aspectRatio: item.video.aspectRatio,
                hasAudio: item.video.hasAudio,
                ...(typeof item.video.width === 'number' ? { width: item.video.width } : {}),
                ...(typeof item.video.height === 'number' ? { height: item.video.height } : {}),
            }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.CHANGE_SCOPE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.CHANGE_SCOPE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.CHANGE_SCOPE, MEDIA_LIBRARY_SUBJECTS.EVENTS.UPDATED] },
        },
        handler: async (data: any) => {
            const { user: { userId }, itemId, newScope, workspaceId, organizationId } = data
            if (!VALID_SCOPES.includes(newScope as MediaLibraryScope)) return { error: 'INVALID_SCOPE' }
            const owned = await MediaLibraryItem.getOwnedAnyItem({ itemId, userId })
            if ('error' in owned) return owned
            const newScopeOwnerId = await getTargetScopeOwnerId({
                userId,
                workspaceId,
                organizationId,
                scope: newScope as MediaLibraryScope,
            })
            if (typeof newScopeOwnerId !== 'string') return newScopeOwnerId

            let updatedScope: MediaLibraryScope
            if (owned.kind === 'image') {
                const newAsset = await copyLibraryImageToScope({
                    item: owned,
                    newScope: newScope as MediaLibraryScope,
                    newScopeOwnerId,
                })
                let updatedItem: MediaLibraryImageItem
                try {
                    updatedItem = await MediaLibraryItem.changeScope({
                        item: owned,
                        newScope: newScope as MediaLibraryScope,
                        newScopeOwnerId,
                        newAsset,
                    })
                } catch (error) {
                    warn(`Failed to update Media Library scope for ${owned.itemId}; retaining copied object for reconciliation.`)
                    throw error
                }
                await deleteLibraryImageObject(owned).catch((error) => {
                    warn(`Failed to delete old Media Library object ${owned.itemId}: ${error.message}`)
                })
                updatedScope = updatedItem.scope
            } else {
                const { asset: newAsset, poster: newPoster } = await copyLibraryVideoToScope({
                    item: owned,
                    newScope: newScope as MediaLibraryScope,
                    newScopeOwnerId,
                })
                let updatedItem: MediaLibraryVideoItem
                try {
                    updatedItem = await MediaLibraryItem.changeScopeVideo({
                        item: owned,
                        newScope: newScope as MediaLibraryScope,
                        newScopeOwnerId,
                        newAsset,
                        newPoster,
                    })
                } catch (error) {
                    warn(`Failed to update Media Library scope for ${owned.itemId}; retaining copied object for reconciliation.`)
                    throw error
                }
                await deleteLibraryVideoObject(owned).catch((error) => {
                    warn(`Failed to delete old Media Library object ${owned.itemId}: ${error.message}`)
                })
                updatedScope = updatedItem.scope
            }
            NATS_Service.getInstance()?.publish(MEDIA_LIBRARY_SUBJECTS.EVENTS.UPDATED, {
                type: 'scopeChanged',
                itemId,
                newScope,
            })
            return { success: true, itemId, scope: updatedScope }
        },
    },
    {
        subject: MEDIA_LIBRARY_SUBJECTS.DELETE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_LIBRARY_SUBJECTS.DELETE] },
            sub: { allow: [MEDIA_LIBRARY_SUBJECTS.DELETE, MEDIA_LIBRARY_SUBJECTS.EVENTS.DELETED] },
        },
        handler: async (data: any) => {
            const { user: { userId }, itemId } = data
            const owned = await MediaLibraryItem.getOwnedAnyItem({ itemId, userId })
            if ('error' in owned) return owned
            if (owned.kind === 'image') {
                await MediaLibraryItem.deleteImageItem({ item: owned })
                await deleteLibraryImageObject(owned).catch((error) => {
                    warn(`Failed to delete Media Library image object ${owned.itemId}: ${error.message}`)
                })
            } else {
                await MediaLibraryItem.deleteVideoItem({ item: owned })
                await deleteLibraryVideoObject(owned).catch((error) => {
                    warn(`Failed to delete Media Library video object ${owned.itemId}: ${error.message}`)
                })
            }
            info(`Deleted Media Library item ${itemId} (kind=${owned.kind})`)
            NATS_Service.getInstance()?.publish(MEDIA_LIBRARY_SUBJECTS.EVENTS.DELETED, {
                type: 'deleted',
                itemId,
            })
            return { success: true, itemId }
        },
    },
]
