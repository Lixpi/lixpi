'use strict'

import { createHash } from 'node:crypto'

import sharp from 'sharp'
import type {
    AssetRenditionName,
    FailedRenditionResult,
    GenerateRenditionsRequest,
    GenerateRenditionsResponse,
    GeneratedRenditionResult,
} from '@lixpi/constants'
import {
    createImageRendition,
    transcodeImage,
} from './transcoders/image.ts'
import {
    createVideoPreview,
    extractPosterFrame,
    extractRepresentativeFrame,
    probeMedia,
    transcodeAudioVideo,
} from './transcoders/audiovideo.ts'
import {
    convertDocumentToPdf,
    getPdfPageCount,
    renderPdfFirstPagePoster,
} from './transcoders/document.ts'

export type ConversionStorage = {
    getObject: (bucketName: string, objectKey: string) => Promise<Uint8Array | null>
    putObject: (
        bucketName: string,
        objectKey: string,
        data: Uint8Array,
        options?: { name?: string; description?: string },
    ) => Promise<unknown>
}

const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const getObjectKey = (blobHash: string): string => `sha256/${blobHash.slice(0, 2)}/${blobHash}`

const writeRendition = async ({
    storage,
    bucketName,
    name,
    mimeType,
    data,
    width,
    height,
    durationSeconds,
    pageCount,
}: {
    storage: ConversionStorage
    bucketName: string
    name: AssetRenditionName
    mimeType: string
    data: Buffer
    width?: number
    height?: number
    durationSeconds?: number
    pageCount?: number
}): Promise<GeneratedRenditionResult> => {
    const blobHash = hashBytes(data)
    const objectKey = getObjectKey(blobHash)
    const existing = await storage.getObject(bucketName, objectKey)
    if (existing && hashBytes(existing) !== blobHash) {
        throw new Error(`RENDITION_OBJECT_HASH_CONFLICT:${name}`)
    }
    if (!existing) {
        await storage.putObject(bucketName, objectKey, data, {
            name: objectKey,
            description: `${name} sha256:${blobHash}`,
        })
    }
    return {
        name,
        status: 'ready',
        blobHash,
        objectKey,
        mimeType,
        byteSize: data.byteLength,
        ...(typeof width === 'number' ? { width } : {}),
        ...(typeof height === 'number' ? { height } : {}),
        ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
        ...(typeof pageCount === 'number' ? { pageCount } : {}),
    }
}

const failed = (name: AssetRenditionName, errorCode: string): FailedRenditionResult => ({
    name,
    status: 'failed',
    errorCode,
})

const errorCodeFor = (name: AssetRenditionName, error: unknown): string => {
    const candidate = error as { code?: string; message?: string }
    const raw = candidate.code ?? candidate.message ?? `${name.toUpperCase()}_GENERATION_FAILED`
    return raw
        .toUpperCase()
        .replaceAll(/[^A-Z0-9]+/g, '_')
        .replaceAll(/^_+|_+$/g, '')
        .slice(0, 96) || `${name.toUpperCase()}_GENERATION_FAILED`
}

const escapeXml = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')

const renderTextDocumentPoster = async (buffer: Buffer): Promise<Buffer> => {
    const words = buffer.toString('utf8').replaceAll(/\s+/g, ' ').trim().split(' ')
    const lines: string[] = []
    let line = ''
    for (const word of words) {
        if (`${line} ${word}`.trim().length > 78) {
            lines.push(line)
            line = word
        } else {
            line = `${line} ${word}`.trim()
        }
        if (lines.length >= 38) break
    }
    if (line && lines.length < 39) lines.push(line)
    const text = lines
        .map((currentLine, index) => `<text x="72" y="${112 + index * 34}" font-family="sans-serif" font-size="24" fill="#182033">${escapeXml(currentLine)}</text>`)
        .join('')
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1448"><rect width="1024" height="1448" fill="#fffdf9"/>${text}</svg>`)
    return await sharp(svg).png().toBuffer()
}

const makeCanonical = async (request: GenerateRenditionsRequest, original: Buffer): Promise<Buffer> => {
    if (request.mediaKind === 'image') {
        return await transcodeImage(original, request.canonicalMimeType, {
            sourceMime: request.sourceMimeType,
            unlimited: request.sourceMimeType === 'image/heic' || request.sourceMimeType === 'image/heif',
        })
    }
    if (request.mediaKind === 'audio' || request.mediaKind === 'video') {
        return await transcodeAudioVideo(original, request.canonicalMimeType)
    }
    return await convertDocumentToPdf(original, request.originalName)
}

export const generateAssetRenditions = async (
    request: GenerateRenditionsRequest,
    storage: ConversionStorage,
): Promise<GenerateRenditionsResponse> => {
    const expectedBucketName = `blobs-${request.organizationId}-files`
    if (request.bucketName !== expectedBucketName) throw new Error('BLOB_BUCKET_TENANT_MISMATCH')
    if (request.sourceObjectKey !== getObjectKey(request.sourceBlobHash)) throw new Error('SOURCE_OBJECT_KEY_MISMATCH')
    if (!/^[a-f0-9]{64}$/.test(request.sourceBlobHash)) throw new Error('INVALID_SOURCE_BLOB_HASH')
    if (new Set(request.requestedRenditions).size !== request.requestedRenditions.length) {
        throw new Error('DUPLICATE_REQUESTED_RENDITION')
    }
    const source = await storage.getObject(request.bucketName, request.sourceObjectKey)
    if (!source) throw new Error('SOURCE_BLOB_NOT_FOUND')
    const original = Buffer.from(source)
    if (hashBytes(original) !== request.sourceBlobHash) throw new Error('SOURCE_BLOB_HASH_MISMATCH')

    const requested = new Set(request.requestedRenditions)
    const renditions: Array<GeneratedRenditionResult | FailedRenditionResult> = []
    const originalResult: GeneratedRenditionResult = {
        name: 'original',
        status: 'ready',
        blobHash: request.sourceBlobHash,
        objectKey: request.sourceObjectKey,
        mimeType: request.sourceMimeType,
        byteSize: original.byteLength,
    }
    if (requested.has('original')) renditions.push(originalResult)

    let modelBuffer = original
    let modelMimeType = request.sourceMimeType
    if (!request.modelSafe) {
        try {
            modelBuffer = await makeCanonical(request, original)
            modelMimeType = request.canonicalMimeType
            if (requested.has('canonical')) {
                renditions.push(
                    await writeRendition({
                        storage,
                        bucketName: request.bucketName,
                        name: 'canonical',
                        mimeType: modelMimeType,
                        data: modelBuffer,
                    }),
                )
            }
        } catch (error) {
            if (requested.has('canonical')) {
                renditions.push(failed('canonical', errorCodeFor('canonical', error)))
            }
            for (const name of requested) {
                if (name !== 'original' && name !== 'canonical') {
                    renditions.push(failed(name, 'CANONICAL_UNAVAILABLE'))
                }
            }
            return {
                jobId: request.jobId,
                jobKey: request.jobKey,
                organizationId: request.organizationId,
                assetId: request.assetId,
                sourceBlobHash: request.sourceBlobHash,
                renditions,
            }
        }
    }

    const response: GenerateRenditionsResponse = {
        jobId: request.jobId,
        jobKey: request.jobKey,
        organizationId: request.organizationId,
        assetId: request.assetId,
        sourceBlobHash: request.sourceBlobHash,
        renditions,
    }

    if (request.mediaKind === 'image') {
        const metadata = await sharp(modelBuffer, { failOn: 'none' }).metadata()
        if (metadata.width) response.width = metadata.width
        if (metadata.height) response.height = metadata.height
        if (metadata.width && metadata.height) response.aspectRatio = metadata.width / metadata.height
        for (
            const config of [
                { name: 'preview' as const, maxWidth: 2048, maxHeight: 2048, quality: 86 },
                { name: 'thumbnail' as const, maxWidth: 512, maxHeight: 512, quality: 78 },
            ]
        ) {
            if (!requested.has(config.name)) continue
            try {
                const generated = await createImageRendition({ buffer: modelBuffer, ...config })
                renditions.push(
                    await writeRendition({
                        storage,
                        bucketName: request.bucketName,
                        name: config.name,
                        mimeType: 'image/webp',
                        data: generated.data,
                        width: generated.width,
                        height: generated.height,
                    }),
                )
            } catch (error) {
                renditions.push(failed(config.name, errorCodeFor(config.name, error)))
            }
        }
        return response
    }

    if (request.mediaKind === 'audio') {
        const probe = await probeMedia(modelBuffer)
        if (probe.durationSeconds !== null) response.durationSeconds = probe.durationSeconds
        response.hasAudio = true
        return response
    }

    if (request.mediaKind === 'video') {
        const probe = await probeMedia(modelBuffer)
        if (probe.durationSeconds !== null) response.durationSeconds = probe.durationSeconds
        if (probe.aspectRatio !== null) response.aspectRatio = probe.aspectRatio
        if (probe.width !== null) response.width = probe.width
        if (probe.height !== null) response.height = probe.height
        response.hasAudio = probe.hasAudio

        if (requested.has('preview')) {
            try {
                const preview = await createVideoPreview(modelBuffer)
                renditions.push(
                    await writeRendition({
                        storage,
                        bucketName: request.bucketName,
                        name: 'preview',
                        mimeType: 'video/mp4',
                        data: preview,
                        durationSeconds: probe.durationSeconds ?? undefined,
                    }),
                )
            } catch (error) {
                renditions.push(failed('preview', errorCodeFor('preview', error)))
            }
        }

        let poster: Buffer | null = null
        let posterErrorCode = 'POSTER_EXTRACTION_FAILED'
        if (requested.has('poster') || requested.has('thumbnail')) {
            try {
                poster = await extractPosterFrame(modelBuffer)
            } catch (error) {
                posterErrorCode = errorCodeFor('poster', error)
            }
            if (requested.has('poster')) {
                if (poster) {
                    try {
                        renditions.push(
                            await writeRendition({
                                storage,
                                bucketName: request.bucketName,
                                name: 'poster',
                                mimeType: 'image/png',
                                data: poster,
                            }),
                        )
                    } catch (error) {
                        renditions.push(failed('poster', errorCodeFor('poster', error)))
                    }
                } else {
                    renditions.push(failed('poster', posterErrorCode))
                }
            }
        }
        if (requested.has('thumbnail')) {
            if (!poster) {
                renditions.push(failed('thumbnail', 'POSTER_UNAVAILABLE'))
            } else {
                try {
                    const thumbnail = await createImageRendition({
                        buffer: poster,
                        maxWidth: 512,
                        maxHeight: 512,
                        quality: 78,
                    })
                    renditions.push(
                        await writeRendition({
                            storage,
                            bucketName: request.bucketName,
                            name: 'thumbnail',
                            mimeType: 'image/webp',
                            data: thumbnail.data,
                            width: thumbnail.width,
                            height: thumbnail.height,
                        }),
                    )
                } catch (error) {
                    renditions.push(failed('thumbnail', errorCodeFor('thumbnail', error)))
                }
            }
        }
        if (requested.has('representativeFrame')) {
            try {
                const frame = await extractRepresentativeFrame(modelBuffer, (probe.durationSeconds ?? 0) / 2)
                if (frame) {
                    renditions.push(
                        await writeRendition({
                            storage,
                            bucketName: request.bucketName,
                            name: 'representativeFrame',
                            mimeType: 'image/png',
                            data: frame,
                        }),
                    )
                } else {
                    renditions.push(failed('representativeFrame', 'REPRESENTATIVE_FRAME_EXTRACTION_FAILED'))
                }
            } catch (error) {
                renditions.push(failed('representativeFrame', errorCodeFor('representativeFrame', error)))
            }
        }
        return response
    }

    let pageCount: number | null = null
    let poster: Buffer | null = null
    let posterErrorCode = 'DOCUMENT_POSTER_GENERATION_FAILED'
    if (modelMimeType === 'application/pdf') {
        try {
            pageCount = await getPdfPageCount(modelBuffer)
        } catch {
            pageCount = null
        }
        try {
            poster = await renderPdfFirstPagePoster(modelBuffer)
        } catch (error) {
            posterErrorCode = errorCodeFor('poster', error)
        }
    } else if (modelMimeType === 'text/plain' || modelMimeType === 'text/markdown') {
        try {
            poster = await renderTextDocumentPoster(modelBuffer)
        } catch (error) {
            posterErrorCode = errorCodeFor('poster', error)
        }
    }
    if (pageCount !== null) response.pageCount = pageCount
    if (requested.has('poster')) {
        if (poster) {
            try {
                renditions.push(
                    await writeRendition({
                        storage,
                        bucketName: request.bucketName,
                        name: 'poster',
                        mimeType: 'image/png',
                        data: poster,
                        pageCount: pageCount ?? undefined,
                    }),
                )
            } catch (error) {
                renditions.push(failed('poster', errorCodeFor('poster', error)))
            }
        } else {
            renditions.push(failed('poster', posterErrorCode))
        }
    }
    if (requested.has('thumbnail')) {
        if (!poster) {
            renditions.push(failed('thumbnail', 'POSTER_UNAVAILABLE'))
        } else {
            try {
                const thumbnail = await createImageRendition({
                    buffer: poster,
                    maxWidth: 512,
                    maxHeight: 512,
                    quality: 78,
                })
                renditions.push(
                    await writeRendition({
                        storage,
                        bucketName: request.bucketName,
                        name: 'thumbnail',
                        mimeType: 'image/webp',
                        data: thumbnail.data,
                        width: thumbnail.width,
                        height: thumbnail.height,
                    }),
                )
            } catch (error) {
                renditions.push(failed('thumbnail', errorCodeFor('thumbnail', error)))
            }
        }
    }
    return response
}
