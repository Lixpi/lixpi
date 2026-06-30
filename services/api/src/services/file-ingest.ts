'use strict'

import { type MediaKind } from '@lixpi/constants'
import { info } from '@lixpi/debug-tools'

import { detectFileType } from './file-type-detection.ts'
import { storeWorkspaceFile } from './file-storage.ts'
import { transcodeImage, getImageAspectRatio } from './transcoders/image.ts'
import { transcodeAudioVideo, extractPosterFrame, probeMedia } from './transcoders/audiovideo.ts'
import { convertDocumentToPdf, renderPdfFirstPagePoster, getPdfPageCount } from './transcoders/document.ts'

// Thrown when detection rejects a file (deny-listed / unknown / unsupported).
// The route maps this to 422 with the specific reason, distinct from a 500.
export class FileRejectedError extends Error {
    constructor(public readonly reason: string) {
        super(reason)
        this.name = 'FileRejectedError'
    }
}

// Result of a successful ingest — the fields the client needs to build the
// matching typed canvas node. `kind` selects the node; the rest are per-kind
// hints (geometry, duration, poster, page count).
export type IngestResult = {
    fileId: string
    kind: MediaKind
    url: string
    modelSafe: boolean
    canonicalFileId?: string
    aspectRatio?: number
    durationSeconds?: number
    hasAudio?: boolean
    posterFileId?: string
    posterUrl?: string
    pageCount?: number
}

// Detect → (transcode by kind) → store original + canonical → produce the
// per-kind node hints the client needs. The single ingest path behind both the
// upload route and the URL-import route.
export const ingestWorkspaceFile = async ({
    workspaceId,
    buffer,
    originalName,
    useContentHash = false,
}: {
    workspaceId: string
    buffer: Buffer
    originalName: string
    useContentHash?: boolean
}): Promise<IngestResult> => {
    const detection = await detectFileType(buffer, originalName)
    if (detection.rejected) {
        throw new FileRejectedError(detection.reason)
    }

    const { mimeType, kind, modelSafe, canonicalMime } = detection

    // Transcode non-model-safe inputs to their canonical format. The canonical
    // bytes are what models read; the original is always preserved by the store.
    let canonicalBuffer: Buffer | undefined
    if (!modelSafe) {
        if (kind === 'image') {
            canonicalBuffer = await transcodeImage(buffer, canonicalMime)
        } else if (kind === 'audio' || kind === 'video') {
            canonicalBuffer = await transcodeAudioVideo(buffer, canonicalMime)
        } else if (kind === 'document') {
            canonicalBuffer = await convertDocumentToPdf(buffer, originalName)
        }
    }

    // The bytes a model would read: canonical when transcoded, else the original.
    const modelBuffer = canonicalBuffer ?? buffer

    const stored = await storeWorkspaceFile({
        workspaceId,
        buffer,
        originalName,
        mimeType,
        kind,
        modelSafe,
        canonical: canonicalBuffer ? { buffer: canonicalBuffer, mimeType: canonicalMime } : undefined,
        useContentHash,
    })

    const result: IngestResult = {
        fileId: stored.fileId,
        kind,
        url: stored.url,
        modelSafe,
        canonicalFileId: stored.canonicalFileId,
    }

    // Per-kind node hints derived from the model-safe bytes.
    if (kind === 'image') {
        result.aspectRatio = (await getImageAspectRatio(modelBuffer)) ?? 1
    } else if (kind === 'video') {
        const probe = await probeMedia(modelBuffer)
        result.aspectRatio = probe.aspectRatio ?? 1
        if (probe.durationSeconds !== null) result.durationSeconds = probe.durationSeconds
        result.hasAudio = probe.hasAudio
        const poster = await extractPosterFrame(modelBuffer)
        if (poster) {
            const posterStored = await storeWorkspaceFile({
                workspaceId,
                buffer: poster,
                originalName: `${originalName}-poster.png`,
                mimeType: 'image/png',
                kind: 'image',
                modelSafe: true,
            })
            result.posterFileId = posterStored.fileId
            result.posterUrl = posterStored.url
        }
    } else if (kind === 'audio') {
        const probe = await probeMedia(modelBuffer)
        if (probe.durationSeconds !== null) result.durationSeconds = probe.durationSeconds
        result.hasAudio = true
    } else if (kind === 'document' && canonicalMime === 'application/pdf') {
        // Only PDFs (native or converted) get a first-page poster + page count;
        // plain text / Markdown render as text, with no poster.
        const pageCount = await getPdfPageCount(modelBuffer)
        if (pageCount !== null) result.pageCount = pageCount
        const poster = await renderPdfFirstPagePoster(modelBuffer)
        if (poster) {
            const posterStored = await storeWorkspaceFile({
                workspaceId,
                buffer: poster,
                originalName: `${originalName}-poster.png`,
                mimeType: 'image/png',
                kind: 'image',
                modelSafe: true,
            })
            result.posterFileId = posterStored.fileId
            result.posterUrl = posterStored.url
        }
    }

    info(`Ingested file ${stored.fileId} (kind=${kind}, modelSafe=${modelSafe}) for workspace ${workspaceId}`)
    return result
}
