'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    detectFileType: vi.fn(),
    storeWorkspaceFile: vi.fn(),
    natsRequest: vi.fn(),
    natsPublish: vi.fn(),
    natsGetInstance: vi.fn(),
    setFileCanonical: vi.fn(),
    addFile: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('./file-type-detection.ts', () => ({ detectFileType: mocks.detectFileType }))
vi.mock('./file-storage.ts', () => ({ storeWorkspaceFile: mocks.storeWorkspaceFile }))
vi.mock('../models/workspace.ts', () => ({
    default: { setFileCanonical: mocks.setFileCanonical, addFile: mocks.addFile },
}))
vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: mocks.natsGetInstance,
    },
}))
vi.mock('uuid', () => ({ v4: () => 'conv-123' }))

import { FileRejectedError, ingestWorkspaceFile } from './file-ingest.ts'

const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.natsGetInstance.mockReturnValue({ request: mocks.natsRequest, publish: mocks.natsPublish })
    mocks.natsRequest.mockResolvedValue({ success: true })
})

describe('ingestWorkspaceFile — ready (no workload)', () => {
    it('queues even a model-safe image for the workload (aspectRatio probe, no transcode)', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'image/png', kind: 'image', modelSafe: true, canonicalMime: 'image/png',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({ fileId: 'f1', isDuplicate: false, kind: 'image', modelSafe: true })
        mocks.natsRequest.mockResolvedValue({ success: true, aspectRatio: 1.5 })

        const result = await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('x'), originalName: 'a.png' })

        // Images always go to the workload so aspectRatio comes from the server,
        // never the browser. No canonical is passed at store time.
        expect(result.status).toBe('processing')
        expect(result.conversionId).toBe('conv-123')
        expect(mocks.storeWorkspaceFile.mock.calls[0][0]).not.toHaveProperty('canonical')
        await flushMicrotasks()
        expect(mocks.natsRequest).toHaveBeenCalledWith('workspace.file.convert', expect.objectContaining({ fileId: 'f1', modelSafe: true, kind: 'image' }), expect.any(Number))
    })

    it('returns ready for plain text without queuing conversion', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'text/plain', kind: 'document', modelSafe: true, canonicalMime: 'text/plain',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({ fileId: 'f2', isDuplicate: false, kind: 'document', modelSafe: true })

        const result = await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('hi'), originalName: 'a.txt' })

        expect(result.status).toBe('ready')
        expect(mocks.natsRequest).not.toHaveBeenCalled()
    })
})

describe('ingestWorkspaceFile — processing (workload)', () => {
    it('queues a non-model-safe image and returns processing with a conversionId', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'image/heic', kind: 'image', modelSafe: false, canonicalMime: 'image/jpeg',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({ fileId: 'orig', isDuplicate: false, kind: 'image', modelSafe: false })
        mocks.natsRequest.mockResolvedValue({ success: true, canonicalFileId: 'orig-canonical', canonicalMimeType: 'image/jpeg', aspectRatio: 2 })

        const result = await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('heic'), originalName: 'p.heic' })

        expect(result).toMatchObject({ status: 'processing', fileId: 'orig', conversionId: 'conv-123', kind: 'image' })

        await flushMicrotasks()
        // The workload was asked to convert, and the canonical pointer persisted.
        expect(mocks.natsRequest).toHaveBeenCalledWith('workspace.file.convert', expect.objectContaining({ fileId: 'orig', modelSafe: false }), expect.any(Number))
        expect(mocks.setFileCanonical).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', fileId: 'orig', canonicalFileId: 'orig-canonical' }))
        // Browser is notified on the per-upload completion subject.
        expect(mocks.natsPublish).toHaveBeenCalledWith('workspace.file.convert.response.ws.conv-123', expect.objectContaining({ success: true, conversionId: 'conv-123' }))
    })

    it('queues a model-safe video (needs poster/duration probe) as processing', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'video/mp4', kind: 'video', modelSafe: true, canonicalMime: 'video/mp4',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({ fileId: 'vid', isDuplicate: false, kind: 'video', modelSafe: true })
        mocks.natsRequest.mockResolvedValue({ success: true, posterFileId: 'vid-poster', durationSeconds: 5 })

        const result = await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('mp4'), originalName: 'v.mp4' })

        expect(result.status).toBe('processing')
        await flushMicrotasks()
        // No canonical for a model-safe video, but the poster gets registered.
        expect(mocks.setFileCanonical).not.toHaveBeenCalled()
        expect(mocks.addFile).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: 'vid-poster', kind: 'image' }) }))
    })

    it('publishes a failure notification when the workload reports failure', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'image/heic', kind: 'image', modelSafe: false, canonicalMime: 'image/jpeg',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({ fileId: 'orig', isDuplicate: false, kind: 'image', modelSafe: false })
        mocks.natsRequest.mockResolvedValue({ success: false, error: 'bad seek' })

        await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('heic'), originalName: 'p.heic' })
        await flushMicrotasks()

        expect(mocks.setFileCanonical).not.toHaveBeenCalled()
        expect(mocks.natsPublish).toHaveBeenCalledWith('workspace.file.convert.response.ws.conv-123', expect.objectContaining({ success: false, error: 'bad seek' }))
    })
})

describe('ingestWorkspaceFile — dedup & rejection', () => {
    it('returns ready reusing the existing canonical on a hash-dedup hit', async () => {
        mocks.detectFileType.mockResolvedValue({
            rejected: false, mimeType: 'image/heic', kind: 'image', modelSafe: false, canonicalMime: 'image/jpeg',
        })
        mocks.storeWorkspaceFile.mockResolvedValue({
            fileId: 'orig', isDuplicate: true, kind: 'image', modelSafe: false,
            canonicalFileId: 'orig-canonical', canonicalMimeType: 'image/jpeg',
        })

        const result = await ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('heic'), originalName: 'p.heic', useContentHash: true })

        expect(result).toMatchObject({ status: 'ready', fileId: 'orig-canonical', sourceFileId: 'orig', canonicalFileId: 'orig-canonical' })
        expect(mocks.natsRequest).not.toHaveBeenCalled()
    })

    it('throws FileRejectedError for a denied file', async () => {
        mocks.detectFileType.mockResolvedValue({ rejected: true, reason: 'Executable files are not permitted.' })
        await expect(ingestWorkspaceFile({ workspaceId: 'ws', buffer: Buffer.from('x'), originalName: 'a.exe' }))
            .rejects.toBeInstanceOf(FileRejectedError)
    })
})
