'use strict'

import {
    NATS_SUBJECTS,
    type MediaDescriptor,
    type MediaLibraryImageMeta,
    type MediaLibraryMeta,
    type MediaLibraryVideoMeta,
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

// Media items are org-scoped and resolved server-side from the authenticated user,
// so listing takes no scope/workspace arguments — only an optional name filter.
export type MediaLibraryListImagesOptions = {
    query?: string
}

export default class MediaLibraryService {
    // listItems returns both image and video meta records (kind-mixed). Pre-Phase-8
    // callers that used `listImages` should switch to `listItems` and filter by
    // `kind` when only images are expected.
    async listItems(options: MediaLibraryListImagesOptions = {}): Promise<MediaLibraryMeta[]> {
        const result = await request<{ items?: MediaLibraryMeta[] }>(
            MEDIA_LIBRARY_SUBJECTS.LIST_AVAILABLE,
            options,
        )
        return result.items ?? []
    }

    // Back-compat shim — emits only image meta so existing Media Library panel
    // call-sites that haven't been updated to handle the union don't break.
    async listImages(options: MediaLibraryListImagesOptions = {}): Promise<MediaLibraryImageMeta[]> {
        const items = await this.listItems(options)
        return items.filter((item): item is MediaLibraryImageMeta => item.kind === 'image')
    }

    async listVideos(options: MediaLibraryListImagesOptions = {}): Promise<MediaLibraryVideoMeta[]> {
        const items = await this.listItems(options)
        return items.filter((item): item is MediaLibraryVideoMeta => item.kind === 'video')
    }

    async addCanvasImage({ workspaceId, fileId, descriptor }: { workspaceId: string; fileId: string; descriptor?: MediaDescriptor }): Promise<{ itemId?: string; displayName?: string; deduplicated?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_IMAGE, { workspaceId, fileId, descriptor })
    }

    async addCanvasVideo({
        workspaceId,
        fileId,
        posterFileId,
        durationSeconds,
        aspectRatio,
        hasAudio,
        descriptor,
    }: {
        workspaceId: string
        fileId: string
        posterFileId?: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        descriptor?: MediaDescriptor
    }): Promise<{ itemId?: string; displayName?: string; deduplicated?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.CREATE_FROM_VIDEO, {
            workspaceId,
            fileId,
            posterFileId,
            durationSeconds,
            aspectRatio,
            hasAudio,
            descriptor,
        })
    }

    async materializeImage({
        workspaceId,
        itemId,
    }: {
        workspaceId: string
        itemId: string
    }): Promise<{ fileId?: string; url?: string; width?: number; height?: number; descriptor?: MediaDescriptor; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE, { workspaceId, itemId })
    }

    async materializeVideo({
        workspaceId,
        itemId,
    }: {
        workspaceId: string
        itemId: string
    }): Promise<{
        itemId?: string
        video?: { fileId: string; url: string; size: number; mimeType: string }
        poster?: { fileId: string; url: string; size: number; mimeType: string }
        durationSeconds?: number
        aspectRatio?: number
        hasAudio?: boolean
        width?: number
        height?: number
        descriptor?: MediaDescriptor
        error?: string
    }> {
        return request(MEDIA_LIBRARY_SUBJECTS.MATERIALIZE_VIDEO_TO_WORKSPACE, { workspaceId, itemId })
    }

    async deleteImage(itemId: string): Promise<{ success?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.DELETE, { itemId })
    }

    // Either-kind delete (server picks the right cleanup path by item.kind).
    async deleteItem(itemId: string): Promise<{ success?: boolean; error?: string }> {
        return request(MEDIA_LIBRARY_SUBJECTS.DELETE, { itemId })
    }
}
