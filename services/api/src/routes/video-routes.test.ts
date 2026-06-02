'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    getWorkspace: vi.fn(),
    getObject: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
    extractPosterFrame: vi.fn(),
    storeWorkspaceImage: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({ err: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => ({ getObject: mocks.getObject }) },
}))
vi.mock('../helpers/auth.ts', () => ({
    jwtVerifier: { verify: mocks.verify },
}))
vi.mock('../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))
vi.mock('../services/video-storage.ts', () => ({
    storeWorkspaceVideo: mocks.storeWorkspaceVideo,
    extractPosterFrame: mocks.extractPosterFrame,
}))
vi.mock('../services/image-storage.ts', () => ({
    storeWorkspaceImage: mocks.storeWorkspaceImage,
}))

import videoRoutes from './video-routes.ts'

const findRoute = (path: string, method: string) => {
    return (videoRoutes as any).stack
        .find((layer: any) => layer.route?.path === path && layer.route?.methods?.[method])
        .route
}

const createResponse = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
})

// =============================================================================
// VIDEO UPLOAD ROUTE
// =============================================================================

describe('Video upload route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1', files: [] })
        mocks.storeWorkspaceVideo.mockResolvedValue({
            fileId: 'video-file',
            url: '/api/videos/workspace-1/video-file',
            isDuplicate: false,
            size: 12,
            mimeType: 'video/mp4',
        })
        mocks.extractPosterFrame.mockResolvedValue(Buffer.from('poster'))
        mocks.storeWorkspaceImage.mockResolvedValue({
            fileId: 'poster-file',
            url: '/api/images/workspace-1/poster-file',
            isDuplicate: false,
            size: 6,
            mimeType: 'image/png',
        })
    })

    it('stores uploaded video bytes and returns the generated poster reference', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const handler = route.stack.at(-1).handle
        const req: any = {
            params: { workspaceId: 'workspace-1' },
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await handler(req, res)

        expect(mocks.storeWorkspaceVideo).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: req.file.buffer,
            originalName: 'clip.mp4',
            mimeType: 'video/mp4',
        })
        expect(mocks.extractPosterFrame).toHaveBeenCalledWith(req.file.buffer)
        expect(mocks.storeWorkspaceImage).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('poster'),
            originalName: 'clip.mp4-poster.png',
            mimeType: 'image/png',
        })
        expect(res.json).toHaveBeenCalledWith({
            fileId: 'video-file',
            url: '/api/videos/workspace-1/video-file',
            isDuplicate: false,
            size: 12,
            mimeType: 'video/mp4',
            posterFileId: 'poster-file',
            posterUrl: '/api/images/workspace-1/poster-file',
        })
    })
})
