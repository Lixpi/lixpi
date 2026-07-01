'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    getAnyItem: vi.fn(),
    getUserWorkspaces: vi.fn(),
    getUserOrganizations: vi.fn(),
    getObject: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({ err: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => ({ getObject: mocks.getObject }) },
}))
vi.mock('../helpers/auth.ts', () => ({
    jwtVerifier: { verify: mocks.verify },
}))
vi.mock('../models/media-library-item.ts', () => ({
    default: { getAnyItem: mocks.getAnyItem },
}))
vi.mock('../models/workspace.ts', () => ({
    default: { getUserWorkspaces: mocks.getUserWorkspaces },
}))
vi.mock('../models/organization.ts', () => ({
    default: { getUserOrganizations: mocks.getUserOrganizations },
}))

import mediaLibraryRoutes from './media-library-routes.ts'

const contentRoute = (mediaLibraryRoutes as any).stack
    .find((layer: any) => layer.route?.path === '/items/:itemId/content')
    .route
const posterRoute = (mediaLibraryRoutes as any).stack
    .find((layer: any) => layer.route?.path === '/items/:itemId/poster')
    .route

const createResponse = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
})

const createAuthHeaders = () => ({ authorization: 'Bearer token-1' })

const makeBaseRequest = (itemId: string) => ({
    params: { itemId },
    headers: createAuthHeaders(),
    query: {},
    user: { userId: 'user-1' },
})

describe('Media Library preview route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3]))
        mocks.getUserWorkspaces.mockResolvedValue([
            { workspaceId: 'workspace-current' },
            { workspaceId: 'workspace-other' },
        ])
        mocks.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.getAnyItem.mockResolvedValue({
            kind: 'image',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-1',
                mimeType: 'image/png',
            },
        })
        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3]))
    })

    it('checks preview access against all user-accessible workspaces and organizations', async () => {
        const req: any = makeBaseRequest('item-1')
        const res = createResponse()
        const next = vi.fn()

        await contentRoute.stack[0].handle(req, res, next)
        expect(next).toHaveBeenCalledOnce()
        await contentRoute.stack[1].handle(req, res)

        expect(mocks.getAnyItem).toHaveBeenCalledWith({
            itemId: 'item-1',
            requesterContext: {
                userId: 'user-1',
                workspaceIds: ['workspace-current', 'workspace-other'],
                organizationIds: ['organization-1'],
            },
        })
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600')
        expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    })

    it('serves seekable video with a valid byte-range response', async () => {
        const req: any = {
            ...makeBaseRequest('item-video'),
            headers: {
                ...createAuthHeaders(),
                range: 'bytes=1-2',
            },
        }
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'video',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-video',
                mimeType: 'video/mp4',
            },
        })
        mocks.getObject.mockResolvedValue(Uint8Array.from([10, 11, 12, 13, 14]))

        await contentRoute.stack[0].handle(req, res, vi.fn())
        await contentRoute.stack[1].handle(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 1-2/5')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 2)
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600')
        expect(res.status).toHaveBeenCalledWith(206)
        expect(res.end).toHaveBeenCalledWith(Buffer.from([11, 12]))
    })

    it('falls back to a full response when byte-range parsing fails', async () => {
        const req: any = {
            ...makeBaseRequest('item-video'),
            headers: {
                ...createAuthHeaders(),
                range: 'bytes=this-is-not-valid',
            },
        }
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'video',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-video',
                mimeType: 'video/mp4',
            },
        })

        await contentRoute.stack[0].handle(req, res, vi.fn())
        await contentRoute.stack[1].handle(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
        expect(res.status).not.toHaveBeenCalledWith(206)
        expect(res.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    })

    it('does not read object bytes when item authorization fails', async () => {
        mocks.getAnyItem.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })
        const req: any = makeBaseRequest('item-1')
        const res = createResponse()

        await contentRoute.stack[1].handle(req, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(mocks.getObject).not.toHaveBeenCalled()
    })
})

describe('Media Library poster route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3]))
        mocks.getUserWorkspaces.mockResolvedValue([
            { workspaceId: 'workspace-current' },
            { workspaceId: 'workspace-other' },
        ])
        mocks.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
    })

    it('serves poster content for video items', async () => {
        const req: any = makeBaseRequest('item-video')
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'video',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-video',
                mimeType: 'video/mp4',
            },
            poster: {
                bucketName: 'media-library-workspace-workspace-other-posters',
                objectKey: 'poster-video',
                mimeType: 'image/png',
            },
        })

        await posterRoute.stack[0].handle(req, res, vi.fn())
        await posterRoute.stack[1].handle(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600')
        expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    })

    it('serves poster content for document items', async () => {
        const req: any = makeBaseRequest('item-doc')
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'document',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-doc',
                mimeType: 'application/pdf',
            },
            poster: {
                bucketName: 'media-library-workspace-workspace-other-posters',
                objectKey: 'poster-doc',
                mimeType: 'image/png',
            },
        })

        await posterRoute.stack[0].handle(req, res, vi.fn())
        await posterRoute.stack[1].handle(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
        expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    })

    it('returns 404 when a non-video/non-document item requests poster', async () => {
        const req: any = makeBaseRequest('item-image')
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'image',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-image',
                mimeType: 'image/png',
            },
        })

        await posterRoute.stack[0].handle(req, res, vi.fn())
        await posterRoute.stack[1].handle(req, res)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: 'Poster not available' })
        expect(mocks.getObject).not.toHaveBeenCalled()
    })

    it('returns 500 when poster lookup throws', async () => {
        const req: any = makeBaseRequest('item-doc')
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'document',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-doc',
                mimeType: 'application/pdf',
            },
            poster: {
                bucketName: 'media-library-workspace-workspace-other-posters',
                objectKey: 'poster-doc',
                mimeType: 'image/png',
            },
        })
        mocks.getObject.mockImplementation(() => {
            throw new Error('storage unavailable')
        })

        await posterRoute.stack[0].handle(req, res, vi.fn())
        await posterRoute.stack[1].handle(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed to retrieve poster' })
    })

    it('returns 404 when poster object is missing', async () => {
        const req: any = makeBaseRequest('item-doc')
        const res = createResponse()

        mocks.getAnyItem.mockResolvedValue({
            kind: 'document',
            asset: {
                bucketName: 'media-library-workspace-workspace-other-files',
                objectKey: 'item-doc',
                mimeType: 'application/pdf',
            },
            poster: {
                bucketName: 'media-library-workspace-workspace-other-posters',
                objectKey: 'poster-doc',
                mimeType: 'image/png',
            },
        })
        mocks.getObject.mockResolvedValue(undefined)

        await posterRoute.stack[0].handle(req, res, vi.fn())
        await posterRoute.stack[1].handle(req, res)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: 'Poster not found' })
    })
})
