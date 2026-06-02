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

// Requests a compact summary of a text node (a document or chat-thread node).
// The caller passes the node's already-flattened plain text (+ optional title) —
// no pixels. Shares the MEDIA_DESCRIBE subject and result shape with describeMedia;
// the server branches on `text` vs `fileId`.
export const describeText = async ({
    workspaceId,
    text,
    title,
    aiModel,
}: {
    workspaceId: string
    text: string
    title?: string
    aiModel: string
}): Promise<DescribeMediaResult> => {
    const nats = servicesStore.getData('nats')
    if (!nats) return { error: 'OFFLINE' }
    return nats.request(MEDIA_DESCRIBE, {
        token: await AuthService.getTokenSilently(),
        workspaceId,
        text,
        title,
        aiModel,
    }) as Promise<DescribeMediaResult>
}
