'use strict'

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    storeWorkspaceFile: vi.fn(),
}))

vi.mock('./file-storage.ts', () => ({
    storeWorkspaceFile: mocks.storeWorkspaceFile,
}))

import { storeWorkspaceImage, storeWorkspaceVideo } from './store-media-adapters.ts'

describe('storeMediaAdapters', () => {
    it('defaults image uploads to ai-generated image metadata', async () => {
        mocks.storeWorkspaceFile.mockResolvedValue('stored')

        const result = await storeWorkspaceImage({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('img'),
        })

        expect(result).toBe('stored')
        expect(mocks.storeWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('img'),
            originalName: 'ai-generated-image.png',
            mimeType: 'image/png',
            kind: 'image',
            modelSafe: true,
        })
    })

    it('keeps explicit image metadata while forcing kind and safety', async () => {
        mocks.storeWorkspaceFile.mockResolvedValue('stored')

        await storeWorkspaceImage({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('img'),
            originalName: 'custom.png',
            mimeType: 'image/webp',
        })

        expect(mocks.storeWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('img'),
            originalName: 'custom.png',
            mimeType: 'image/webp',
            kind: 'image',
            modelSafe: true,
        })
    })

    it('defaults video uploads to generated-video metadata', async () => {
        mocks.storeWorkspaceFile.mockResolvedValue('stored')

        const result = await storeWorkspaceVideo({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('mp4'),
        })

        expect(result).toBe('stored')
        expect(mocks.storeWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('mp4'),
            originalName: 'generated-video.mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            modelSafe: true,
        })
    })
})
