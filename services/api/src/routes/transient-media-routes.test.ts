import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => {
    const handlers: Array<{ path: string; middleware: Array<(req: any, res: any, next: any) => unknown> }> = []
    const getObject = vi.fn(async () => Buffer.from('partial-media'))
    const getWorkspace = vi.fn(async () => ({ organizationId: 'org-1' }))
    const verify = vi.fn(async () => ({ decoded: { sub: 'user-1' } }))

    return { handlers, getObject, getWorkspace, verify }
})

vi.mock('express', () => ({
    Router: () => ({
        get: (path: string, ...middleware: Array<(req: any, res: any, next: any) => unknown>) => {
            mocks.handlers.push({ path, middleware })
        },
    }),
}))
vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => ({ getObject: mocks.getObject }) },
}))
vi.mock('../helpers/auth.ts', () => ({ jwtVerifier: { verify: mocks.verify } }))
vi.mock('../models/workspace.ts', () => ({ default: { getWorkspace: mocks.getWorkspace } }))

import './transient-media-routes.ts'

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
    if (!handler) throw new Error('Transient media route handler was not registered')
    return handler as (req: any, res: any) => Promise<unknown>
}

function authMiddleware(): (req: any, res: any, next: any) => Promise<unknown> {
    const middleware = mocks.handlers[0]?.middleware[0]
    if (!middleware) throw new Error('Transient media authentication middleware was not registered')
    return middleware as (req: any, res: any, next: any) => Promise<unknown>
}

describe('transient media route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getObject.mockResolvedValue(Buffer.from('partial-media'))
        mocks.getWorkspace.mockResolvedValue({ organizationId: 'org-1' })
    })

    it('requires a bearer token before serving transient media', async () => {
        const res = response()
        const next = vi.fn()

        await authMiddleware()({ headers: {}, query: {} }, res, next)

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'No authorization token provided' })
        expect(next).not.toHaveBeenCalled()
    })

    it('reads authorized immutable media from the workspace organization bucket', async () => {
        const res = response()
        const objectKey = `partial-${'a'.repeat(64)}.png`

        await routeHandler()({
            user: { userId: 'user-1' },
            params: { workspaceId: 'workspace-1', objectKey },
            headers: {},
        }, res)

        expect(mocks.getWorkspace).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' })
        expect(mocks.getObject).toHaveBeenCalledWith('transient-media-org-1-files', objectKey)
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png')
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
        expect(res.end).toHaveBeenCalledWith(Buffer.from('partial-media'))
    })

    it('rejects unsafe object keys before accessing workspace storage', async () => {
        const res = response()

        await routeHandler()({
            user: { userId: 'user-1' },
            params: { workspaceId: 'workspace-1', objectKey: '../image.png' },
            headers: {},
        }, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_TRANSIENT_MEDIA_KEY' })
        expect(mocks.getWorkspace).not.toHaveBeenCalled()
    })

    it('serves byte ranges for transient video objects', async () => {
        const res = response()
        const objectKey = `partial-${'b'.repeat(64)}.webm`
        mocks.getObject.mockResolvedValueOnce(Buffer.from('0123456789'))

        await routeHandler()({
            user: { userId: 'user-1' },
            params: { workspaceId: 'workspace-1', objectKey },
            headers: { range: 'bytes=2-5' },
        }, res)

        expect(res.status).toHaveBeenCalledWith(206)
        expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 2-5/10')
        expect(res.end).toHaveBeenCalledWith(Buffer.from('2345'))
    })
})
