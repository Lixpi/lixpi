'use strict'

import { info, warn } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    MEDIA_LIBRARY_ITEM_KIND,
    MEDIA_LIBRARY_ITEM_STATUS,
    MEDIA_LIBRARY_SCOPE,
    type MediaLibraryImageItem,
    type MediaLibraryVideoItem,
} from '@lixpi/constants'

import MediaLibraryItem, {
    buildMediaLibraryScopeAndOwnerKey,
    type MediaLibraryRequesterContext,
} from '../../models/media-library-item.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import {
    copyWorkspaceImageToLibrary,
    copyWorkspaceVideoToLibrary,
    deleteLibraryImageObject,
    deleteLibraryVideoObject,
    materializeLibraryImageToWorkspace,
    materializeLibraryVideoToWorkspace,
} from '../../services/media-library-storage.ts'

const { MEDIA_LIBRARY_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

// The owning organization is resolved server-side from the authenticated user. The
// client has no active-org concept and workspaces carry no org link, so this is the
// single source of truth for both the write path (create) and the read paths
// (list/get/materialize/delete) — they MUST resolve identically. Mirrors
// resolveUserOrganizationId in feature-subjects.ts.
const resolveUserOrganizationId = async (userId: string): Promise<string | undefined> => {
    const organizations = await Organization.getUserOrganizations({ userId })
    return organizations[0]?.organizationId
}

const getRequesterContext = async (userId: string): Promise<MediaLibraryRequesterContext> => {
    const organizationId = await resolveUserOrganizationId(userId)
    return {
        userId,
        organizationIds: organizationId ? [organizationId] : [],
    }
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
            const { user: { userId }, workspaceId, fileId, descriptor } = data
            if (!workspaceId || !fileId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const organizationId = await resolveUserOrganizationId(userId)
            if (!organizationId) {
                return { error: 'ORGANIZATION_ACCESS_DENIED' }
            }

            const existing = await MediaLibraryItem.findActiveOrgImageBySource({ organizationId, sourceFileId: fileId, userId })
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
                scope: MEDIA_LIBRARY_SCOPE.ORGANIZATION,
                scopeOwnerId: organizationId,
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
                scope: MEDIA_LIBRARY_SCOPE.ORGANIZATION,
                scopeOwnerId: organizationId,
                scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.ORGANIZATION, organizationId),
                status: MEDIA_LIBRARY_ITEM_STATUS.ACTIVE,
                asset: copied.asset,
                image: copied.image,
                ...(descriptor ? { descriptor } : {}),
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
            const { user: { userId }, itemId } = data
            // Widened to either-kind GET — the client may not know whether a given
            // itemId is image or video. The item is kind-discriminated.
            return MediaLibraryItem.getAnyItem({
                itemId,
                requesterContext: await getRequesterContext(userId),
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
            const { user: { userId }, query } = data
            const requesterContext = await getRequesterContext(userId)
            const organizationIds = requesterContext.organizationIds ?? []
            return {
                items: await MediaLibraryItem.listAvailable({
                    scopes: [MEDIA_LIBRARY_SCOPE.ORGANIZATION],
                    scopeOwnerIds: { [MEDIA_LIBRARY_SCOPE.ORGANIZATION]: organizationIds },
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
                requesterContext: await getRequesterContext(userId),
            })
            if ('error' in item) return item
            const stored = await materializeLibraryImageToWorkspace({ item, workspaceId })
            return { ...stored, itemId, width: item.image.width, height: item.image.height, descriptor: item.descriptor }
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
                descriptor,
            } = data as {
                user: { userId: string }
                workspaceId: string
                fileId: string
                posterFileId?: string
                durationSeconds: number
                aspectRatio: number
                hasAudio: boolean
                descriptor?: any
            }
            if (!workspaceId || !fileId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const organizationId = await resolveUserOrganizationId(userId)
            if (!organizationId) {
                return { error: 'ORGANIZATION_ACCESS_DENIED' }
            }

            const existing = await MediaLibraryItem.findActiveOrgVideoBySource({ organizationId, sourceFileId: fileId, userId })
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
                scope: MEDIA_LIBRARY_SCOPE.ORGANIZATION,
                scopeOwnerId: organizationId,
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
                scope: MEDIA_LIBRARY_SCOPE.ORGANIZATION,
                scopeOwnerId: organizationId,
                scopeAndOwner: buildMediaLibraryScopeAndOwnerKey(MEDIA_LIBRARY_SCOPE.ORGANIZATION, organizationId),
                status: MEDIA_LIBRARY_ITEM_STATUS.ACTIVE,
                asset: copied.asset,
                ...(copied.poster ? { poster: copied.poster } : {}),
                video: copied.video,
                ...(descriptor ? { descriptor } : {}),
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
                requesterContext: await getRequesterContext(userId),
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
                descriptor: item.descriptor,
            }
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
            // Media is org-wide: any member of the owning org can delete it.
            const item = await MediaLibraryItem.getAnyItem({
                itemId,
                requesterContext: await getRequesterContext(userId),
            })
            if ('error' in item) return item
            if (item.kind === 'image') {
                await MediaLibraryItem.deleteImageItem({ item })
                await deleteLibraryImageObject(item).catch((error) => {
                    warn(`Failed to delete Media Library image object ${item.itemId}: ${error.message}`)
                })
            } else {
                await MediaLibraryItem.deleteVideoItem({ item })
                await deleteLibraryVideoObject(item).catch((error) => {
                    warn(`Failed to delete Media Library video object ${item.itemId}: ${error.message}`)
                })
            }
            info(`Deleted Media Library item ${itemId} (kind=${item.kind})`)
            NATS_Service.getInstance()?.publish(MEDIA_LIBRARY_SUBJECTS.EVENTS.DELETED, {
                type: 'deleted',
                itemId,
            })
            return { success: true, itemId }
        },
    },
]
