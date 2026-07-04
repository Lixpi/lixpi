'use strict'

import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { ConvertFileRequest } from '@lixpi/constants'

import type { ConversionStorage } from './file-conversion.ts'

vi.mock('@lixpi/debug-tools', () => ({
    info: () => undefined,
    warn: () => undefined,
    err: () => undefined,
}))

const transcodeImageMock = vi.fn()
const getImageAspectRatioMock = vi.fn()
const transcodeAudioVideoMock = vi.fn()
const convertDocumentToPdfMock = vi.fn()
const getPdfPageCountMock = vi.fn()
const renderPdfFirstPagePosterMock = vi.fn()
const extractPosterFrameMock = vi.fn()
const extractRepresentativeFrameMock = vi.fn()
const probeMediaMock = vi.fn()

vi.mock('./transcoders/image.ts', () => ({
    transcodeImage: (...args: Parameters<typeof transcodeImageMock>) => transcodeImageMock(...args),
    getImageAspectRatio: (...args: Parameters<typeof getImageAspectRatioMock>) => getImageAspectRatioMock(...args),
}))

vi.mock('./transcoders/audiovideo.ts', () => ({
    transcodeAudioVideo: (...args: Parameters<typeof transcodeAudioVideoMock>) => transcodeAudioVideoMock(...args),
    probeMedia: (...args: Parameters<typeof probeMediaMock>) => probeMediaMock(...args),
    extractPosterFrame: (...args: Parameters<typeof extractPosterFrameMock>) => extractPosterFrameMock(...args),
    extractRepresentativeFrame: (...args: Parameters<typeof extractRepresentativeFrameMock>) =>
        extractRepresentativeFrameMock(...args),
}))

vi.mock('./transcoders/document.ts', () => ({
    convertDocumentToPdf: (...args: Parameters<typeof convertDocumentToPdfMock>) => convertDocumentToPdfMock(...args),
    getPdfPageCount: (...args: Parameters<typeof getPdfPageCountMock>) => getPdfPageCountMock(...args),
    renderPdfFirstPagePoster: (...args: Parameters<typeof renderPdfFirstPagePosterMock>) =>
        renderPdfFirstPagePosterMock(...args),
}))

import { convertWorkspaceFile, extractVideoFrames } from './file-conversion.ts'

class MemoryStorage implements ConversionStorage {
    store = new Map<string, Uint8Array>()

    async getObject(bucketName: string, name: string): Promise<Uint8Array | null> {
        return this.store.get(`${bucketName}/${name}`) ?? null
    }

    async putObject(bucketName: string, name: string, data: Uint8Array): Promise<unknown> {
        this.store.set(`${bucketName}/${name}`, data)
        return { name, size: data.length }
    }
}

const baseRequest = (overrides: Partial<ConvertFileRequest> = {}): ConvertFileRequest => ({
    workspaceId: 'ws-1',
    fileId: 'file-1',
    originalName: 'media.bin',
    mimeType: 'application/octet-stream',
    kind: 'video',
    modelSafe: false,
    canonicalMime: 'video/mp4',
    ...overrides,
})

beforeEach(() => {
    transcodeImageMock.mockReset()
    getImageAspectRatioMock.mockReset()
    transcodeAudioVideoMock.mockReset()
    convertDocumentToPdfMock.mockReset()
    getPdfPageCountMock.mockReset()
    renderPdfFirstPagePosterMock.mockReset()
    extractPosterFrameMock.mockReset()
    extractRepresentativeFrameMock.mockReset()
    probeMediaMock.mockReset()
})

describe('convertWorkspaceFile', () => {
    it('generates an audio hint set with duration and confirms audio presence even without audio tracks', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'file-1', Buffer.from('raw-audio'))
        transcodeAudioVideoMock.mockResolvedValue(Buffer.from('audio-model'))
        probeMediaMock.mockResolvedValue({
            durationSeconds: 12.34,
            aspectRatio: 16 / 9,
            hasAudio: false,
        })

        const result = await convertWorkspaceFile(baseRequest({
            kind: 'audio',
            mimeType: 'audio/mpeg',
            canonicalMime: 'audio/mpeg',
        }), storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.canonicalFileId).toBe('file-1-canonical')
            expect(result.durationSeconds).toBe(12.34)
            expect(result.hasAudio).toBe(true)
            expect(result.aspectRatio).toBeUndefined()
        }
        expect(transcodeAudioVideoMock).toHaveBeenCalledWith(Buffer.from('raw-audio'), 'audio/mpeg')
        expect(probeMediaMock).toHaveBeenCalledWith(Buffer.from('audio-model'))
    })

    it('derives video hints and writes a poster for non-model-safe video', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'file-1', Buffer.from('raw-video'))
        transcodeAudioVideoMock.mockResolvedValue(Buffer.from('model-video'))
        probeMediaMock.mockResolvedValue({
            durationSeconds: 3.21,
            aspectRatio: 4 / 3,
            hasAudio: true,
        })
        extractPosterFrameMock.mockResolvedValue(Buffer.from('poster'))

        const result = await convertWorkspaceFile(baseRequest({
            kind: 'video',
            mimeType: 'video/mp4',
            canonicalMime: 'video/mp4',
        }), storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.durationSeconds).toBe(3.21)
            expect(result.hasAudio).toBe(true)
            expect(result.aspectRatio).toBeCloseTo(1.333, 3)
            expect(result.posterFileId).toBe('file-1-poster')
        }
        const storedPoster = await storage.getObject('workspace-ws-1-files', 'file-1-poster')
        expect(storedPoster).toEqual(Buffer.from('poster'))
        expect(transcodeAudioVideoMock).toHaveBeenCalledWith(Buffer.from('raw-video'), 'video/mp4')
        expect(extractPosterFrameMock).toHaveBeenCalledWith(Buffer.from('model-video'))
    })

    it('derives poster + page count for PDFs and sizes by first-page aspect ratio', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'file-1', Buffer.from('raw-doc'))
        convertDocumentToPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4'))
        getPdfPageCountMock.mockResolvedValue(11)
        renderPdfFirstPagePosterMock.mockResolvedValue(Buffer.from('poster'))
        getImageAspectRatioMock.mockResolvedValue(1.25)

        const result = await convertWorkspaceFile(baseRequest({
            kind: 'document',
            canonicalMime: 'application/pdf',
            originalName: 'report.docx',
        }), storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.canonicalFileId).toBe('file-1-canonical')
            expect(result.pageCount).toBe(11)
            expect(result.posterFileId).toBe('file-1-poster')
            expect(result.aspectRatio).toBe(1.25)
        }
        expect(convertDocumentToPdfMock).toHaveBeenCalledWith(Buffer.from('raw-doc'), 'report.docx')
        expect(getPdfPageCountMock).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'))
        expect(renderPdfFirstPagePosterMock).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'))
        expect(getImageAspectRatioMock).toHaveBeenCalledWith(Buffer.from('poster'))
    })

    it('returns a failure when transcoding throws', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'file-1', Buffer.from('bad'))
        transcodeImageMock.mockRejectedValue(new Error('unsupported codec'))

        const result = await convertWorkspaceFile(baseRequest({
            kind: 'image',
            mimeType: 'image/png',
            canonicalMime: 'image/webp',
        }), storage)

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.error).toMatch(/Could not convert this image to image\/webp\. unsupported codec/)
        }
    })
})

describe('extractVideoFrames', () => {
    it('writes both poster and representative frame ids when extraction succeeds', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'video-id', Buffer.from('video'))
        extractPosterFrameMock.mockResolvedValue(Buffer.from('poster'))
        extractRepresentativeFrameMock.mockResolvedValue(Buffer.from('frame'))

        const result = await extractVideoFrames({
            workspaceId: 'ws-1',
            videoFileId: 'video-id',
            atSeconds: 1.2,
        }, storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.posterFileId).toBe('video-id-poster')
            expect(result.frameFileId).toBe('video-id-frame')
        }
        expect(await storage.getObject('workspace-ws-1-files', 'video-id-poster')).toEqual(Buffer.from('poster'))
        expect(await storage.getObject('workspace-ws-1-files', 'video-id-frame')).toEqual(Buffer.from('frame'))
        expect(extractPosterFrameMock).toHaveBeenCalledWith(Buffer.from('video'))
        expect(extractRepresentativeFrameMock).toHaveBeenCalledWith(Buffer.from('video'), 1.2)
    })

    it('still succeeds when extractors return null for either frame path', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'video-id', Buffer.from('video'))
        extractPosterFrameMock.mockResolvedValue(null)
        extractRepresentativeFrameMock.mockResolvedValue(null)

        const result = await extractVideoFrames({
            workspaceId: 'ws-1',
            videoFileId: 'video-id',
            atSeconds: undefined,
        }, storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.posterFileId).toBeUndefined()
            expect(result.frameFileId).toBeUndefined()
        }
        expect(await storage.getObject('workspace-ws-1-files', 'video-id-poster')).toBeNull()
        expect(await storage.getObject('workspace-ws-1-files', 'video-id-frame')).toBeNull()
    })
})
