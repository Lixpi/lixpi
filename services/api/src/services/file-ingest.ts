'use strict'

import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    type MediaKind,
    type DocumentFile,
    type ConvertFileRequest,
    type ConvertFileResult,
    type ConvertFileNotification,
} from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'
import { detectFileType } from './file-type-detection.ts'
import { storeWorkspaceFile } from './file-storage.ts'

const { FILE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

// Generous ceiling for a single heavy conversion (a long video re-encode). The
// upload request has already returned `processing`, so this only bounds the
// background NATS request to the workload before we surface a failure.
const CONVERSION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

// Thrown when detection rejects a file (deny-listed / unknown / unsupported).
// The route maps this to 422 with the specific reason, distinct from a 500.
export class FileRejectedError extends Error {
    constructor(public readonly reason: string) {
        super(reason)
        this.name = 'FileRejectedError'
    }
}

// Result of an ingest. The API does NO heavy processing — it stores the original
// and returns immediately:
//   - `ready`: the original is directly usable (model-safe image, or text /
//     markdown) and no transcode or probe is needed. The browser builds the node
//     now (measuring image aspectRatio client-side).
//   - `processing`: the file needs the file-conversion NEX workload (a transcode,
//     and/or ffmpeg/poppler hints like poster, duration, pageCount). The browser
//     shows an upload placeholder and subscribes to the per-upload completion
//     subject (CONVERT_RESPONSE.<workspaceId>.<conversionId>).
export type IngestResult = {
    status: 'ready' | 'processing'
    fileId: string
    kind: MediaKind
    url: string
    modelSafe: boolean
    conversionId?: string       // present when status === 'processing'
    sourceFileId?: string
    canonicalFileId?: string
    canonicalMimeType?: string
}

// True when a file needs the file-conversion workload: either it is not
// model-safe (needs a transcode) or its kind needs a server-derived canvas hint
// even when already model-safe — image aspectRatio (sharp), video/audio
// duration + poster (ffmpeg), or PDF page count + poster (poppler). The browser
// stays inert and never inspects bytes itself. Only plain text / Markdown are
// ready with no server hint.
const needsConversionWorkload = (kind: MediaKind, modelSafe: boolean, mimeType: string): boolean =>
    !modelSafe ||
    kind === 'image' ||
    kind === 'video' ||
    kind === 'audio' ||
    (kind === 'document' && mimeType === 'application/pdf')

// Detect → store the ORIGINAL → either return `ready` or hand the heavy work off
// to the NEX file-conversion workload and return `processing`. The single ingest
// path behind both the upload route and the URL-import route. No sharp / ffmpeg /
// libreoffice / poppler ever runs here.
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

    // Always store the original; the canonical (if any) is produced later by the
    // workload, never here.
    const stored = await storeWorkspaceFile({
        workspaceId,
        buffer,
        originalName,
        mimeType,
        kind,
        modelSafe,
        useContentHash,
    })

    // A hash-dedup hit already has its canonical (from the first ingest); reuse it
    // and return immediately rather than re-running the workload.
    if (stored.isDuplicate) {
        const canvasFileId = stored.canonicalFileId ?? stored.fileId
        return {
            status: 'ready',
            fileId: canvasFileId,
            ...(stored.canonicalFileId ? { sourceFileId: stored.fileId } : {}),
            kind,
            url: `/api/files/${workspaceId}/${canvasFileId}`,
            modelSafe: true,
            canonicalFileId: stored.canonicalFileId,
            canonicalMimeType: stored.canonicalMimeType,
        }
    }

    // Plain text / Markdown: nothing to transcode or probe on the server — the
    // browser builds the node directly.
    if (!needsConversionWorkload(kind, modelSafe, mimeType)) {
        info(`Ingested file ${stored.fileId} (kind=${kind}) ready without conversion for workspace ${workspaceId}`)
        return {
            status: 'ready',
            fileId: stored.fileId,
            kind,
            url: `/api/files/${workspaceId}/${stored.fileId}`,
            modelSafe: true,
        }
    }

    // Hand the heavy work to the NEX file-conversion workload and return now. The
    // background request resolves later and notifies the browser.
    const conversionId = uuid()
    void runFileConversion({
        workspaceId,
        fileId: stored.fileId,
        originalName,
        mimeType,
        kind,
        modelSafe,
        canonicalMime,
        conversionId,
    })

    // Model-safe files (e.g. mp4/pdf) are NOT transcoded — they're queued only for
    // poster/metadata extraction. Non-model-safe files are queued for a transcode.
    const work = modelSafe ? 'poster/metadata only' : 'transcode'
    info(`Ingested file ${stored.fileId} (kind=${kind}, modelSafe=${modelSafe}) queued for media processing ${conversionId} (${work}) in workspace ${workspaceId}`)
    return {
        status: 'processing',
        fileId: stored.fileId,
        conversionId,
        kind,
        url: `/api/files/${workspaceId}/${stored.fileId}`,
        modelSafe,
    }
}

// Background: ask the file-conversion workload to transcode/probe the stored
// original, persist the resulting metadata, and notify the browser on the
// per-upload completion subject. Never throws into the caller — failures are
// reported to the browser as a failed conversion so the placeholder can settle.
const runFileConversion = async ({
    workspaceId,
    fileId,
    originalName,
    mimeType,
    kind,
    modelSafe,
    canonicalMime,
    conversionId,
}: {
    workspaceId: string
    fileId: string
    originalName: string
    mimeType: string
    kind: MediaKind
    modelSafe: boolean
    canonicalMime: string
    conversionId: string
}): Promise<void> => {
    const natsService = NATS_Service.getInstance()
    const responseSubject = `${FILE_SUBJECTS.CONVERT_RESPONSE}.${workspaceId}.${conversionId}`

    let result: ConvertFileResult
    try {
        if (!natsService) {
            throw new Error('NATS service unavailable')
        }
        const request: ConvertFileRequest = {
            workspaceId,
            fileId,
            originalName,
            mimeType,
            kind,
            modelSafe,
            canonicalMime,
        }
        result = await natsService.request<ConvertFileRequest, ConvertFileResult>(
            FILE_SUBJECTS.CONVERT,
            request,
            CONVERSION_REQUEST_TIMEOUT_MS,
        )
    } catch (e: any) {
        err(`File conversion request failed for ${workspaceId}/${fileId} (${conversionId}):`, e)
        result = { success: false, error: 'File conversion timed out or the converter was unavailable.' }
    }

    // Persist the conversion outputs into the workspace file registry.
    if (result.success) {
        try {
            if (result.canonicalFileId && result.canonicalMimeType) {
                await Workspace.setFileCanonical({
                    workspaceId,
                    fileId,
                    canonicalFileId: result.canonicalFileId,
                    canonicalMimeType: result.canonicalMimeType,
                })
            }
            if (result.posterFileId) {
                const poster: DocumentFile = {
                    id: result.posterFileId,
                    name: `${originalName}-poster.png`,
                    mimeType: 'image/png',
                    size: 0,
                    uploadedAt: Date.now(),
                    kind: 'image',
                    modelSafe: true,
                }
                await Workspace.addFile({ workspaceId, file: poster })
            }
        } catch (e: any) {
            err(`Failed to persist conversion result for ${workspaceId}/${fileId} (${conversionId}):`, e)
            result = { success: false, error: 'Conversion succeeded but the result could not be saved.' }
        }
    }

    const notification: ConvertFileNotification = { conversionId, workspaceId, fileId, ...result }
    natsService?.publish(responseSubject, notification)
    info(`Conversion ${conversionId} settled for ${workspaceId}/${fileId}: success=${result.success}`)
}
