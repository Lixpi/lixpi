'use strict'

import { info } from '@lixpi/debug-tools'
import type {
    ConvertFileRequest,
    ConvertFileResult,
    ExtractFramesRequest,
    ExtractFramesResult,
} from '@lixpi/constants'

import { transcodeImage, getImageAspectRatio } from './transcoders/image.ts'
import { transcodeAudioVideo, extractPosterFrame, extractRepresentativeFrame, probeMedia } from './transcoders/audiovideo.ts'
import { convertDocumentToPdf, renderPdfFirstPagePoster, getPdfPageCount } from './transcoders/document.ts'

// The slice of @lixpi/nats-service the converter needs — declared as an
// interface so the orchestration is unit-testable with an in-memory store and
// never has to spin up real JetStream.
export interface ConversionStorage {
    getObject(bucketName: string, name: string): Promise<Uint8Array | null>
    putObject(
        bucketName: string,
        name: string,
        data: Uint8Array,
        meta?: { name?: string; description?: string },
    ): Promise<unknown>
}

const getWorkspaceBucketName = (workspaceId: string): string => `workspace-${workspaceId}-files`

// Human-readable byte size for the conversion logs.
const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    const units = ['KB', 'MB', 'GB']
    let value = bytes / 1024
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)}${units[unitIndex]}`
}

// Signed percentage change from `from` to `to` (e.g. "-42%"), for transcode logs.
const percentDelta = (from: number, to: number): string => {
    if (from <= 0) return 'n/a'
    const pct = Math.round(((to - from) / from) * 100)
    return `${pct >= 0 ? '+' : ''}${pct}%`
}

// All heavy media processing for Lixpi lives here, on the NEX node — never on the
// API. Reads the stored original from the workspace Object Store bucket,
// transcodes it to its canonical model-safe form, writes the canonical (+ a
// poster for video/PDF) back to the same bucket, and returns the per-kind canvas
// hints. The bytes never travel over NATS — only the small ids/metadata do.
//
// A failure is returned as `{ success: false, error }`, never thrown out, so the
// workload's responder loop survives a single bad file (e.g. an undecodable HEIC).
export const convertWorkspaceFile = async (
    req: ConvertFileRequest,
    storage: ConversionStorage,
): Promise<ConvertFileResult> => {
    const { workspaceId, fileId, originalName, mimeType, kind, modelSafe, canonicalMime } = req
    const bucketName = getWorkspaceBucketName(workspaceId)
    const startedAt = Date.now()

    const originalData = await storage.getObject(bucketName, fileId)
    if (!originalData) {
        return { success: false, error: 'The uploaded file could not be read from storage.' }
    }
    const buffer = Buffer.from(originalData)

    const result: ConvertFileResult = { success: true }
    let posterBytes = 0

    // Transcode only when the original is not model-safe. A model-safe input
    // (e.g. an mp4 or pdf) skips the re-encode entirely and is probed in place —
    // the original bytes are the model bytes.
    let modelBuffer: Buffer
    if (modelSafe) {
        modelBuffer = buffer
    } else {
        try {
            if (kind === 'image') {
                modelBuffer = await transcodeImage(buffer, canonicalMime, {
                    sourceMime: mimeType,
                    unlimited: mimeType === 'image/heic' || mimeType === 'image/heif',
                })
            } else if (kind === 'audio' || kind === 'video') {
                modelBuffer = await transcodeAudioVideo(buffer, canonicalMime)
            } else if (kind === 'document') {
                modelBuffer = await convertDocumentToPdf(buffer, originalName)
            } else {
                return { success: false, error: `Unsupported media kind: ${kind}` }
            }
        } catch (error: any) {
            const details = error?.message ? ` ${error.message}` : ''
            return { success: false, error: `Could not convert this ${kind} to ${canonicalMime}.${details}` }
        }

        // Persist the canonical derivative beside the original.
        const canonicalFileId = `${fileId}-canonical`
        await storage.putObject(bucketName, canonicalFileId, modelBuffer, {
            name: canonicalFileId,
            description: `${originalName} (canonical)`,
        })
        result.canonicalFileId = canonicalFileId
        result.canonicalMimeType = canonicalMime
    }

    // The effective mime of the model bytes: the canonical target when transcoded,
    // else the original's mime.
    const effectiveMime = modelSafe ? mimeType : canonicalMime

    // Per-kind canvas hints derived from the model-safe bytes — the same
    // derivations the synchronous API ingest used to do inline.
    if (kind === 'image') {
        result.aspectRatio = (await getImageAspectRatio(modelBuffer)) ?? 1
    } else if (kind === 'video') {
        const probe = await probeMedia(modelBuffer)
        result.aspectRatio = probe.aspectRatio ?? 1
        if (probe.durationSeconds !== null) result.durationSeconds = probe.durationSeconds
        result.hasAudio = probe.hasAudio
        const poster = await extractPosterFrame(modelBuffer)
        if (poster) {
            const posterFileId = `${fileId}-poster`
            await storage.putObject(bucketName, posterFileId, poster, {
                name: posterFileId,
                description: `${originalName} (poster)`,
            })
            result.posterFileId = posterFileId
            posterBytes = poster.length
        }
    } else if (kind === 'audio') {
        const probe = await probeMedia(modelBuffer)
        if (probe.durationSeconds !== null) result.durationSeconds = probe.durationSeconds
        result.hasAudio = true
    } else if (kind === 'document' && effectiveMime === 'application/pdf') {
        const pageCount = await getPdfPageCount(modelBuffer)
        if (pageCount !== null) result.pageCount = pageCount
        const poster = await renderPdfFirstPagePoster(modelBuffer)
        if (poster) {
            const posterFileId = `${fileId}-poster`
            await storage.putObject(bucketName, posterFileId, poster, {
                name: posterFileId,
                description: `${originalName} (poster)`,
            })
            result.posterFileId = posterFileId
            posterBytes = poster.length
            // Size the canvas node to the actual poster so it isn't letterboxed
            // against a hardcoded A4 default.
            const posterAspect = await getImageAspectRatio(poster)
            if (posterAspect) result.aspectRatio = posterAspect
        }
    }

    // Rich completion log: original → output formats, timing, sizes, and the
    // per-kind hints derived. "Processed", not "converted", for model-safe inputs
    // — those are NOT re-encoded (only probed + given a poster); only the
    // non-model-safe branch above re-encodes.
    const elapsedMs = Date.now() - startedAt
    const outputBytes = modelSafe ? buffer.length : modelBuffer.length
    const transcoded = Boolean(result.canonicalFileId)
    const parts: string[] = [
        `workspace=${workspaceId}`,
        `file=${fileId}`,
        `name="${originalName}"`,
        `kind=${kind}`,
        transcoded
            ? `transcode=${mimeType} → ${canonicalMime}`
            : `transcode=none (model-safe ${mimeType})`,
        `in=${formatBytes(buffer.length)}`,
        `out=${formatBytes(outputBytes)}${transcoded ? ` (${percentDelta(buffer.length, outputBytes)})` : ''}`,
    ]
    if (posterBytes > 0) parts.push(`poster=${formatBytes(posterBytes)}`)
    if (result.aspectRatio !== undefined) parts.push(`aspect=${result.aspectRatio.toFixed(3)}`)
    if (result.durationSeconds !== undefined) parts.push(`duration=${result.durationSeconds.toFixed(2)}s`)
    if (result.hasAudio !== undefined) parts.push(`hasAudio=${result.hasAudio}`)
    if (result.pageCount !== undefined) parts.push(`pages=${result.pageCount}`)
    parts.push(`took=${elapsedMs}ms`)

    info(`✅ ${transcoded ? 'Converted' : 'Processed'} ${kind}: ${parts.join(' ')}`)
    return result
}

// Extract a poster frame + representative (image-to-video anchor) frame from a
// staged generated video. Keeps ffmpeg off the API: the AI video-generation
// providers stage the video to a temp Object Store key and call this; the frames
// are written back to temp keys for the provider to read and then clean up.
// Never throws — a failure is returned so the responder loop survives it.
export const extractVideoFrames = async (
    req: ExtractFramesRequest,
    storage: ConversionStorage,
): Promise<ExtractFramesResult> => {
    const { workspaceId, videoFileId, atSeconds } = req
    const bucketName = getWorkspaceBucketName(workspaceId)

    const videoData = await storage.getObject(bucketName, videoFileId)
    if (!videoData) {
        return { success: false, error: 'The staged video could not be read from storage.' }
    }
    const videoBuffer = Buffer.from(videoData)

    const result: ExtractFramesResult = { success: true }

    const poster = await extractPosterFrame(videoBuffer)
    if (poster) {
        const posterFileId = `${videoFileId}-poster`
        await storage.putObject(bucketName, posterFileId, poster, { name: posterFileId })
        result.posterFileId = posterFileId
    }

    const frame = await extractRepresentativeFrame(videoBuffer, atSeconds)
    if (frame) {
        const frameFileId = `${videoFileId}-frame`
        await storage.putObject(bucketName, frameFileId, frame, { name: frameFileId })
        result.frameFileId = frameFileId
    }

    info(`Extracted frames for ${videoFileId} in workspace ${workspaceId} (poster=${Boolean(result.posterFileId)}, frame=${Boolean(result.frameFileId)})`)
    return result
}
