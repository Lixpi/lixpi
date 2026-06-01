'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'

const { MEDIA_DESCRIBE } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

export type DescribeMediaResult = {
    summary?: string
    entityTags?: string[]
    styleTags?: string[]
    error?: string
}

// Requests a compact VLM description of a single media still (an image's own
// file, or a video's representative frame/poster). The MP4 is never sent — the
// caller resolves the still fileId. `aiModel` is the user's currently-selected
// VLM-capable model (same one the chat uses), so no model is hardcoded server-side.
export const describeMedia = async ({
    workspaceId,
    fileId,
    aiModel,
}: {
    workspaceId: string
    fileId: string
    aiModel: string
}): Promise<DescribeMediaResult> => {
    const nats = servicesStore.getData('nats')
    if (!nats) return { error: 'OFFLINE' }
    return nats.request(MEDIA_DESCRIBE, {
        token: await AuthService.getTokenSilently(),
        workspaceId,
        fileId,
        aiModel,
    }) as Promise<DescribeMediaResult>
}
