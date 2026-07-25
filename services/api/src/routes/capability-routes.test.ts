'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
    const handlers: Array<{ path: string, middleware: Array<(req: any, res: any, next: any) => unknown> }> = []
    const readResource = vi.fn(async () => ({
        mediaType: 'image/png',
        blobHash: 'hash-1',
        bytes: new Uint8Array([1, 2, 3]),
    }))
    const getAssetRequesterContext = vi.fn(async () => ({ organizationIds: ['org-1'] }))
    const verify = vi.fn(async () => ({ decoded: { sub: 'user-1' } }))

    return { handlers, readResource, getAssetRequesterContext, verify }
})

vi.mock('express', () => ({
    Router: () => ({
        get: (path: string, ...middleware: Array<(req: any, res: any, next: any) => unknown>) => {
            mocks.handlers.push({ path, middleware })
        },
    }),
}))
vi.mock('../helpers/auth.ts', () => ({ jwtVerifier: { verify: mocks.verify } }))
vi.mock('../models/capability.ts', () => ({ default: { readResource: mocks.readResource } }))
vi.mock('../services/asset-requester-context.ts', () => ({ getAssetRequesterContext: mocks.getAssetRequesterContext }))

import './capability-routes.ts'

function response() {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader: vi.fn(),
        end: vi.fn(),
    }
    return res
}

function routeHandler(): (req: any, res: any) => Promise<unknown> {
    const handler = mocks.handlers[0]?.middleware.at(-1)
    if (!handler) throw new Error('Capability resource route handler was not registered')
    return handler as (req: any, res: any) => Promise<unknown>
}

function authMiddleware(): (req: any, res: any, next: any) => Promise<unknown> {
    const middleware = mocks.handlers[0]?.middleware[0]
    if (!middleware) throw new Error('Capability resource authentication middleware was not registered')
    return middleware as (req: any, res: any, next: any) => Promise<unknown>
}

describe('capability resource route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.readResource.mockResolvedValue({
            mediaType: 'image/png',
            blobHash: 'hash-1',
            bytes: new Uint8Array([1, 2, 3]),
        })
        mocks.getAssetRequesterContext.mockResolvedValue({ organizationIds: ['org-1'] })
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
    })

    describe('authenticateRequest', () => {
        it('rejects a request with no bearer token or query token', async () => {
            const res = response()
            const next = vi.fn()

            await authMiddleware()({ headers: {}, query: {} }, res, next)

            expect(res.status).toHaveBeenCalledWith(401)
            expect(res.json).toHaveBeenCalledWith({ error: 'No authorization token provided' })
            expect(next).not.toHaveBeenCalled()
        })

        it('accepts a token passed as a query param when no header is present', async () => {
            const res = response()
            const next = vi.fn()
            const req: any = { headers: {}, query: { token: 'query-token' } }

            await authMiddleware()(req, res, next)

            expect(mocks.verify).toHaveBeenCalledWith('query-token')
            expect(req.user).toEqual({ userId: 'user-1' })
            expect(next).toHaveBeenCalledTimes(1)
            expect(res.status).not.toHaveBeenCalled()
        })

        it('prefers the Authorization header over a query token when both are present', async () => {
            const res = response()
            const next = vi.fn()
            const req: any = {
                headers: { authorization: 'Bearer header-token' },
                query: { token: 'query-token' },
            }

            await authMiddleware()(req, res, next)

            expect(mocks.verify).toHaveBeenCalledWith('header-token')
        })

        it('rejects when token verification fails', async () => {
            const res = response()
            const next = vi.fn()
            mocks.verify.mockResolvedValueOnce({ decoded: null, error: 'expired' })

            await authMiddleware()({ headers: { authorization: 'Bearer bad-token' }, query: {} }, res, next)

            expect(res.status).toHaveBeenCalledWith(401)
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' })
            expect(next).not.toHaveBeenCalled()
        })
    })

    describe('GET /:capabilityId/resources/:resourceId', () => {
        it('streams the resolved resource bytes with content headers derived from the resource', async () => {
            const res = response()

            await routeHandler()({
                user: { userId: 'user-1' },
                params: { capabilityId: 'cap-1', resourceId: 'resource-1' },
                query: {},
            }, res)

            expect(mocks.getAssetRequesterContext).toHaveBeenCalledWith('user-1')
            expect(mocks.readResource).toHaveBeenCalledWith({
                capabilityId: 'cap-1',
                resourceId: 'resource-1',
                manifestBlobHash: undefined,
                requester: { userId: 'user-1', organizationIds: ['org-1'] },
            })
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache')
            expect(res.setHeader).toHaveBeenCalledWith('ETag', '"hash-1"')
            expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
            expect(res.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
        })

        it('forwards a string manifestBlobHash query param but ignores a non-string one', async () => {
            const res = response()

            await routeHandler()({
                user: { userId: 'user-1' },
                params: { capabilityId: 'cap-1', resourceId: 'resource-1' },
                query: { manifestBlobHash: 'expected-hash' },
            }, res)

            expect(mocks.readResource).toHaveBeenCalledWith(expect.objectContaining({ manifestBlobHash: 'expected-hash' }))

            await routeHandler()({
                user: { userId: 'user-1' },
                params: { capabilityId: 'cap-1', resourceId: 'resource-1' },
                query: { manifestBlobHash: ['not-a-string'] },
            }, res)

            expect(mocks.readResource).toHaveBeenLastCalledWith(expect.objectContaining({ manifestBlobHash: undefined }))
        })

        it.each([
            ['NOT_FOUND', 404],
            ['CAPABILITY_RESOURCE_NOT_FOUND', 404],
            ['BLOB_NOT_FOUND', 404],
            ['PERMISSION_DENIED', 403],
            ['CAPABILITY_RESOURCE_INVALID', 422],
        ])('maps model error %s to HTTP status %i', async (message, status) => {
            const res = response()
            mocks.readResource.mockRejectedValueOnce(new Error(message))

            await routeHandler()({
                user: { userId: 'user-1' },
                params: { capabilityId: 'cap-1', resourceId: 'resource-1' },
                query: {},
            }, res)

            expect(res.status).toHaveBeenCalledWith(status)
            expect(res.json).toHaveBeenCalledWith({ error: message })
            expect(res.end).not.toHaveBeenCalled()
        })
    })
})
