'use strict'

import { storeWorkspaceFile, type StoreFileResult } from './file-storage.ts'

// Adapters that map the legacy per-kind store signatures (used by the AI
// generation pipeline and Media Library materialize helpers) onto the unified
// storeWorkspaceFile. AI-generated and library-materialized media are always a
// model-safe canonical format (PNG/JPEG/MP4), so `kind`/`modelSafe` are fixed
// here rather than sniffed.

type LegacyStoreInput = {
    workspaceId: string
    buffer: Buffer
    originalName?: string
    mimeType?: string
    useContentHash?: boolean
}

export const storeWorkspaceImage = (input: LegacyStoreInput): Promise<StoreFileResult> =>
    storeWorkspaceFile({
        ...input,
        originalName: input.originalName ?? 'ai-generated-image.png',
        mimeType: input.mimeType ?? 'image/png',
        kind: 'image',
        modelSafe: true,
    })

export const storeWorkspaceVideo = (input: LegacyStoreInput): Promise<StoreFileResult> =>
    storeWorkspaceFile({
        ...input,
        originalName: input.originalName ?? 'generated-video.mp4',
        mimeType: input.mimeType ?? 'video/mp4',
        kind: 'video',
        modelSafe: true,
    })
