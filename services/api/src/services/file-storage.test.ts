'use strict'

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { storeWorkspaceFile } from './file-storage.ts'

const workspaceId = 'workspace-1'
const bucketName = `workspace-${workspaceId}-files`

const contentHashInput = Buffer.from('deterministic-bytes')
const contentHash = createHash('sha256').update(contentHashInput).digest('hex')
const hashFileId = `hash-${contentHash}`

const mocks = vi.hoisted(() => ({
    getWorkspaceInternal: vi.fn(),
    addFile: vi.fn(),
    getInstance: vi.fn(),
    getObjectInfo: vi.fn(),
    putObject: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), warn: vi.fn(), err: vi.fn() }))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: mocks.getInstance,
    },
}))

vi.mock('../models/workspace.ts', () => ({
    default: {
        getWorkspaceInternal: mocks.getWorkspaceInternal,
        addFile: mocks.addFile,
    },
}))

vi.mock('uuid', () => ({ v4: () => 'uuid-file' }))

describe('storeWorkspaceFile persistence contract', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getInstance.mockReturnValue({
            getObjectInfo: mocks.getObjectInfo,
            putObject: mocks.putObject,
        })
    })

    it('throws when workspace does not exist', async () => {
        mocks.getWorkspaceInternal.mockResolvedValue(null)

        await expect(storeWorkspaceFile({
            workspaceId,
            buffer: contentHashInput,
            originalName: 'x.bin',
            mimeType: 'application/octet-stream',
            kind: 'document',
            modelSafe: true,
        })).rejects.toThrow('Workspace not found')
    })

    it('throws when the NATS service is unavailable', async () => {
        mocks.getWorkspaceInternal.mockResolvedValue({ workspaceId })
        mocks.getInstance.mockReturnValue(undefined)

        await expect(storeWorkspaceFile({
            workspaceId,
            buffer: contentHashInput,
            originalName: 'x.bin',
            mimeType: 'application/octet-stream',
            kind: 'document',
            modelSafe: true,
        })).rejects.toThrow('NATS service unavailable')
    })

    it('reuses an existing file when hash-dedup bytes are present', async () => {
        const existingFiles = [{
            id: hashFileId,
            name: 'x.bin',
            mimeType: 'application/octet-stream',
            size: contentHashInput.length,
            uploadedAt: 1,
            kind: 'document',
            modelSafe: true,
        }]

        mocks.getWorkspaceInternal.mockResolvedValue({ workspaceId, files: existingFiles })
        mocks.getObjectInfo.mockResolvedValueOnce({ deleted: false })

        const stored = await storeWorkspaceFile({
            workspaceId,
            buffer: contentHashInput,
            originalName: 'x.bin',
            mimeType: 'application/octet-stream',
            kind: 'document',
            modelSafe: true,
            useContentHash: true,
        })

        expect(stored).toMatchObject({
            isDuplicate: true,
            fileId: hashFileId,
            kind: 'document',
            modelSafe: true,
        })
        expect(mocks.getObjectInfo).toHaveBeenCalledWith(bucketName, hashFileId)
        expect(mocks.putObject).not.toHaveBeenCalled()
        expect(mocks.addFile).not.toHaveBeenCalled()
    })

    it('retries storage when canonical bytes are missing, even after a hash match', async () => {
        const canonicalFileId = `${hashFileId}-canonical`

        mocks.getWorkspaceInternal.mockResolvedValue({
            workspaceId,
            files: [{
                id: hashFileId,
                canonicalFileId,
                name: 'x.bin',
                mimeType: 'image/png',
                size: contentHashInput.length,
                uploadedAt: 1,
                kind: 'image',
                modelSafe: true,
                canonicalMimeType: 'image/png',
            }],
        })
        mocks.getObjectInfo
            .mockResolvedValueOnce({ deleted: false })
            .mockResolvedValueOnce({ deleted: true })
        mocks.putObject.mockResolvedValue(undefined)
        mocks.addFile.mockResolvedValue(undefined)

        const stored = await storeWorkspaceFile({
            workspaceId,
            buffer: contentHashInput,
            originalName: 'x.png',
            mimeType: 'image/png',
            kind: 'image',
            modelSafe: true,
            useContentHash: true,
        })

        expect(stored).toMatchObject({
            isDuplicate: false,
            fileId: hashFileId,
            kind: 'image',
        })
        expect(mocks.putObject).toHaveBeenCalledWith(bucketName, hashFileId, contentHashInput, {
            name: hashFileId,
            description: 'x.png',
        })
        expect(mocks.addFile).toHaveBeenCalledWith({
            workspaceId,
            file: expect.objectContaining({
                id: hashFileId,
                name: 'x.png',
                mimeType: 'image/png',
                kind: 'image',
                modelSafe: true,
            }),
        })
    })

    it('stores canonical output when provided and returns a canonical id', async () => {
        mocks.getWorkspaceInternal.mockResolvedValue({ workspaceId, files: [] })
        mocks.putObject.mockResolvedValue(undefined)
        mocks.addFile.mockResolvedValue(undefined)

        const stored = await storeWorkspaceFile({
            workspaceId,
            buffer: Buffer.from('raw-video'),
            originalName: 'input.mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            modelSafe: true,
            canonical: {
                buffer: Buffer.from('canonical-video'),
                mimeType: 'video/mp4',
            },
        })

        expect(stored).toEqual(expect.objectContaining({
            isDuplicate: false,
            fileId: 'uuid-file',
            kind: 'video',
            canonicalFileId: 'uuid-file-canonical',
            canonicalMimeType: 'video/mp4',
        }))
        expect(mocks.putObject).toHaveBeenCalledWith(bucketName, 'uuid-file', Buffer.from('raw-video'), {
            name: 'uuid-file',
            description: 'input.mp4',
        })
        expect(mocks.putObject).toHaveBeenCalledWith(bucketName, 'uuid-file-canonical', Buffer.from('canonical-video'), {
            name: 'uuid-file-canonical',
            description: 'input.mp4 (canonical)',
        })
        expect(mocks.addFile).toHaveBeenCalledWith({
            workspaceId,
            file: expect.objectContaining({
                id: 'uuid-file',
                canonicalFileId: 'uuid-file-canonical',
                canonicalMimeType: 'video/mp4',
            }),
        })
    })
})
