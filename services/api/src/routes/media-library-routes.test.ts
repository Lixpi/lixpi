'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    // After Phase 8 the content route serves both kinds, so the model exposes
    // a kind-agnostic getAnyItem instead of getImageItem.
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

const route = (mediaLibraryRoutes as any).stack
    .find((layer: any) => layer.route?.path === '/items/:itemId/content')
    .route

const createResponse = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
})

describe('Media Library preview route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
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
        const req: any = {
            params: { itemId: 'item-1' },
            headers: { authorization: 'Bearer token-1' },
            query: {},
        }
        const res = createResponse()
        const next = vi.fn()

        await route.stack[0].handle(req, res, next)
        expect(next).toHaveBeenCalledOnce()
        await route.stack[1].handle(req, res)

        expect(mocks.getAnyItem).toHaveBeenCalledWith({
            itemId: 'item-1',
            requesterContext: {
                userId: 'user-1',
                workspaceIds: ['workspace-current', 'workspace-other'],
                organizationIds: ['organization-1'],
            },
        })
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
        expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    })

    it('does not read object bytes when item authorization fails', async () => {
        mocks.getAnyItem.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })
        const req: any = {
            params: { itemId: 'item-1' },
            headers: { authorization: 'Bearer token-1' },
            query: {},
            user: { userId: 'user-1' },
        }
        const res = createResponse()

        await route.stack[1].handle(req, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(mocks.getObject).not.toHaveBeenCalled()
    })
})
