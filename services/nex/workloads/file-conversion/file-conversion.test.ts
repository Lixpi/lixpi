'use strict'

import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'

import type { ConvertFileRequest } from '@lixpi/constants'

import { convertWorkspaceFile, type ConversionStorage } from './file-conversion.ts'

vi.mock('@lixpi/debug-tools', () => ({
    info: () => undefined,
    warn: () => undefined,
    err: () => undefined,
}))

// In-memory Object Store stand-in so the orchestration is testable without real
// JetStream. Keys are `${bucket}/${name}`.
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
    originalName: 'photo.tiff',
    mimeType: 'image/tiff',
    kind: 'image',
    modelSafe: false,
    canonicalMime: 'image/png',
    ...overrides,
})

describe('convertWorkspaceFile', () => {
    it('returns a failure (not a throw) when the original is missing from storage', async () => {
        const storage = new MemoryStorage()
        const result = await convertWorkspaceFile(baseRequest(), storage)
        expect(result.success).toBe(false)
        if (!result.success) expect(result.error).toMatch(/could not be read/i)
    })

    it('skips transcoding for model-safe media, yet still writes canvas hints', async () => {
        const storage = new MemoryStorage()
        const png = await sharp({
            create: { width: 4, height: 2, channels: 3, background: { r: 30, g: 40, b: 50 } },
        }).png().toBuffer()
        await storage.putObject('workspace-ws-1-files', 'file-1', png)

        const result = await convertWorkspaceFile(baseRequest({
            kind: 'image',
            modelSafe: true,
            canonicalMime: 'image/webp',
            mimeType: 'image/png',
        }), storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.canonicalFileId).toBeUndefined()
            expect(result.canonicalMimeType).toBeUndefined()
            expect(result.aspectRatio).toBeCloseTo(2, 1)
        }
        const canonical = await storage.getObject('workspace-ws-1-files', 'file-1-canonical')
        expect(canonical).toBeNull()
    })

    it('transcodes an image, writes the canonical, and reports aspectRatio', async () => {
        const storage = new MemoryStorage()
        // A 20x10 TIFF original (not model-safe) → canonical PNG.
        const tiff = await sharp({
            create: { width: 20, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } },
        }).tiff().toBuffer()
        await storage.putObject('workspace-ws-1-files', 'file-1', tiff)

        const result = await convertWorkspaceFile(baseRequest(), storage)

        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.canonicalFileId).toBe('file-1-canonical')
            expect(result.canonicalMimeType).toBe('image/png')
            expect(result.aspectRatio).toBeCloseTo(2, 1)
        }
        // The canonical bytes were persisted beside the original.
        const canonical = await storage.getObject('workspace-ws-1-files', 'file-1-canonical')
        expect(canonical).not.toBeNull()
        const meta = await sharp(Buffer.from(canonical!)).metadata()
        expect(meta.format).toBe('png')
    })

    it('returns a failure for unsupported media kinds', async () => {
        const storage = new MemoryStorage()
        const png = await sharp({
            create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
        }).png().toBuffer()
        await storage.putObject('workspace-ws-1-files', 'file-1', png)

        const result = await convertWorkspaceFile(baseRequest({ kind: 'blob' as ConvertFileRequest['kind'] }), storage)

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.error).toMatch(/Unsupported media kind: blob/)
        }
    })

    it('returns a failure for an undecodable image rather than throwing', async () => {
        const storage = new MemoryStorage()
        await storage.putObject('workspace-ws-1-files', 'file-1', Buffer.from('not an image'))

        const result = await convertWorkspaceFile(
            baseRequest({ mimeType: 'image/heic', canonicalMime: 'image/jpeg' }),
            storage,
        )
        expect(result.success).toBe(false)
        if (!result.success) expect(result.error).toMatch(/could not convert this image/i)
    })
})
