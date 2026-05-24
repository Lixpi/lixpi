'use strict'

import {
    NATS_SUBJECTS,
    type MediaLibraryImageMeta,
    type MediaLibraryScope,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'

const { MEDIA_LIBRARY_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const request = async <T>(subject: string, data: Record<string, unknown>): Promise<T> => {
    const nats = servicesStore.getData('nats')
    if (!nats) throw new Error('Media Library is offline.')
    return nats.request(subject, {
        token: await AuthService.getTokenSilently(),
        ...data,
    }) as Promise<T>
}

export type MediaLibraryListImagesOptions = {
    workspaceId: string
    scopes: MediaLibraryScope[]
    includeAllAvailable: boolean
    query?: string
}

export default class MediaLibraryService {
    async listImages(options: MediaLibraryListImagesOptions): Promise<MediaLibraryImageMeta[]> {
        const result = await request<{ items?: MediaLibraryImageMeta[] }>(
            MEDIA_LIBRARY_SUBJECTS.LIST_AVAILABLE,
            options,
        )
        return result.items ?? []
    }

    async addCanvasImage({ workspaceId, fileId }: { workspaceId: string; fileId: string }): Promise<{ itemId?: string; displayName?: string; deduplicated?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_IMAGE, { workspaceId, fileId })
    }

    async materializeImage({
        workspaceId,
        itemId,
    }: {
        workspaceId: string
        itemId: string
    }): Promise<{ fileId?: string; url?: string; width?: number; height?: number; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE, { workspaceId, itemId })
    }

    async changeImageScope({
        workspaceId,
        itemId,
        newScope,
        organizationId,
    }: {
        workspaceId: string
        itemId: string
        newScope: MediaLibraryScope
        organizationId?: string
    }): Promise<{ success?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.CHANGE_SCOPE, {
            workspaceId,
            itemId,
            newScope,
            organizationId,
        })
    }

    async deleteImage(itemId: string): Promise<{ success?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.DELETE, { itemId })
    }
}
