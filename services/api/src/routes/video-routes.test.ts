'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const debugTools = vi.hoisted(() => ({
    err: vi.fn(),
}))

const mocks = vi.hoisted(() => {
    class MockFileRejectedError extends Error {
        reason: string

        constructor(reason: string) {
            super(reason)
            this.reason = reason
        }
    }

    return {
        verify: vi.fn(),
        getWorkspace: vi.fn(),
        getObject: vi.fn(),
        getNatsInstance: vi.fn(),
        ingestWorkspaceFile: vi.fn(),
        importRemoteFileToWorkspace: vi.fn(),
        FileRejectedError: MockFileRejectedError,
    }
})

vi.mock('@lixpi/debug-tools', () => debugTools)
vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: mocks.getNatsInstance },
}))
vi.mock('../helpers/auth.ts', () => ({
    jwtVerifier: { verify: mocks.verify },
}))
vi.mock('../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))
vi.mock('../services/file-ingest.ts', () => ({
    ingestWorkspaceFile: mocks.ingestWorkspaceFile,
    FileRejectedError: mocks.FileRejectedError,
}))
vi.mock('../services/remote-file-import.ts', () => ({
    importRemoteFileToWorkspace: mocks.importRemoteFileToWorkspace,
}))

import fileRoutes from './file-routes.ts'

const findRoute = (path: string, method: string) => {
    return (fileRoutes as any).stack
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

const createUploadRequest = (workspaceId = 'workspace-1') => ({
    params: { workspaceId },
    body: {},
    headers: { authorization: 'Bearer token-1' },
    query: {},
})

const createGetRequest = (workspaceId: string, fileId: string) => ({
    params: { workspaceId, fileId },
    headers: { authorization: 'Bearer token-1' },
    query: {},
    workspace: { files: [] },
})

const runAuthAndAccess = async (route: any, req: any, res: any) => {
    await route.stack[0].handle(req, res, vi.fn())
    await route.stack[1].handle(req, res, vi.fn())
}

// =============================================================================
// FILE ROUTES — UPLOAD + IMPORT-URL
// =============================================================================

describe('File upload route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1', files: [] })
        mocks.ingestWorkspaceFile.mockResolvedValue({
            fileId: 'uploaded-file',
            url: '/api/files/workspace-1/uploaded-file',
            isDuplicate: false,
            size: 7,
            mimeType: 'video/mp4',
            kind: 'video',
        })
    })

    it('stores uploaded file bytes through ingestWorkspaceFile', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(mocks.ingestWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: req.file.buffer,
            originalName: 'clip.mp4',
            useContentHash: false,
        })
        expect(res.json).toHaveBeenCalledWith({
            fileId: 'uploaded-file',
            url: '/api/files/workspace-1/uploaded-file',
            isDuplicate: false,
            size: 7,
            mimeType: 'video/mp4',
            kind: 'video',
        })
    })

    it('passes useContentHash through when request body requests it', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        const req: any = {
            ...createUploadRequest(),
            body: { useContentHash: 'true' },
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(mocks.ingestWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: req.file.buffer,
            originalName: 'clip.mp4',
            useContentHash: true,
        })
    })

    it('supports Bearer token from query string', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        const req: any = {
            params: { workspaceId: 'workspace-1' },
            body: {},
            headers: {},
            query: { token: 'query-token' },
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(mocks.verify).toHaveBeenCalledWith('query-token')
        expect(res.json).toHaveBeenCalledWith({
            fileId: 'uploaded-file',
            url: '/api/files/workspace-1/uploaded-file',
            isDuplicate: false,
            size: 7,
            mimeType: 'video/mp4',
            kind: 'video',
        })
    })

    it('returns 400 when upload payload contains no file', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        const req: any = {
            ...createUploadRequest(),
            body: {},
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'No file provided' })
    })

    it('returns 422 for FileRejectedError during ingest', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        mocks.ingestWorkspaceFile.mockRejectedValueOnce(new mocks.FileRejectedError('Too large'))
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(422)
        expect(res.json).toHaveBeenCalledWith({ error: 'Too large' })
    })

    it('returns 404 for workspace-not-found ingest errors', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        mocks.ingestWorkspaceFile.mockRejectedValueOnce(new Error('Workspace not found in DB'))
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: 'Workspace not found' })
    })

    it('returns 503 when nats service is unavailable during ingest', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle

        mocks.ingestWorkspaceFile.mockRejectedValueOnce(new Error('NATS service unavailable right now'))
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({ error: 'Storage service unavailable' })
    })

    it('returns 401 and logs when token verification throws', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()
        const authFailure = new Error('Identity provider unavailable')
        mocks.verify.mockRejectedValueOnce(authFailure)

        await route.stack[0].handle(req, res, vi.fn())

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' })
        expect(debugTools.err).toHaveBeenCalledWith('Token verification failed:', authFailure)
    })

    it('returns 500 for workspace access failures and logs them', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle
        const accessError = new Error('workspace db is down')
        mocks.getWorkspace.mockRejectedValueOnce(accessError)
        const req: any = {
            ...createUploadRequest(),
            user: { userId: 'user-1' },
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await route.stack[1].handle(req, res, vi.fn())
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed to validate workspace access' })
        expect(debugTools.err).toHaveBeenCalledWith('Workspace access validation failed:', accessError)
    })

    it('returns 401 when verifier reports an invalid token payload', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        mocks.verify.mockResolvedValueOnce({ error: 'invalid' })

        await route.stack[0].handle(req, res, vi.fn())

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' })
        expect(res.status).not.toHaveBeenCalledWith(500)
    })

    it('returns 500 for generic upload failures', async () => {
        const route = findRoute('/:workspaceId', 'post')
        const uploadHandler = route.stack.at(-1).handle
        mocks.ingestWorkspaceFile.mockRejectedValueOnce(new Error('disk quota exceeded'))
        const req: any = {
            ...createUploadRequest(),
            file: {
                buffer: Buffer.from('video-bytes'),
                originalname: 'clip.mp4',
                mimetype: 'video/mp4',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await uploadHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed to upload file' })
    })
})

describe('Remote URL import route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1', files: [] })
        mocks.importRemoteFileToWorkspace.mockResolvedValue({
            fileId: 'remote-file',
            url: '/api/files/workspace-1/remote-file',
            isDuplicate: false,
            size: 4,
            mimeType: 'image/png',
            kind: 'image',
        })
    })

    it('imports a valid remote URL', async () => {
        const route = findRoute('/:workspaceId/import-url', 'post')
        const importHandler = route.stack.at(-1).handle

        const req: any = {
            ...createUploadRequest(),
            body: { url: 'https://example.com/photo.png' },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await importHandler(req, res)

        expect(mocks.importRemoteFileToWorkspace).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            url: 'https://example.com/photo.png',
        })
        expect(res.json).toHaveBeenCalledWith({
            fileId: 'remote-file',
            url: '/api/files/workspace-1/remote-file',
            isDuplicate: false,
            size: 4,
            mimeType: 'image/png',
            kind: 'image',
        })
    })

    it('returns 400 when URL is missing', async () => {
        const route = findRoute('/:workspaceId/import-url', 'post')
        const importHandler = route.stack.at(-1).handle

        const req: any = createUploadRequest()
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await importHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'File URL is required' })
    })

    it('returns 422 when remote file is rejected', async () => {
        const route = findRoute('/:workspaceId/import-url', 'post')
        const importHandler = route.stack.at(-1).handle

        mocks.importRemoteFileToWorkspace.mockRejectedValueOnce(new mocks.FileRejectedError('Image is unsupported'))
        const req: any = {
            ...createUploadRequest(),
            body: { url: 'https://example.com/photo.png' },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await importHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(422)
        expect(res.json).toHaveBeenCalledWith({ error: 'Image is unsupported' })
    })

    it('returns 400 for unsafe private or too-large URL errors', async () => {
        const route = findRoute('/:workspaceId/import-url', 'post')
        const importHandler = route.stack.at(-1).handle

        mocks.importRemoteFileToWorkspace.mockRejectedValueOnce(new Error('Invalid URL: credentials are not allowed'))
        const req: any = {
            ...createUploadRequest(),
            body: { url: 'https://example.com/photo.png' },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await importHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid URL: credentials are not allowed' })
    })

    it('returns 502 for unexpected remote import failures', async () => {
        const route = findRoute('/:workspaceId/import-url', 'post')
        const importHandler = route.stack.at(-1).handle

        mocks.importRemoteFileToWorkspace.mockRejectedValueOnce(new Error('service temporarily unreachable'))
        const req: any = {
            ...createUploadRequest(),
            body: { url: 'https://example.com/photo.png' },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await importHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(502)
        expect(res.json).toHaveBeenCalledWith({ error: 'service temporarily unreachable' })
    })
})

// =============================================================================
// FILE ROUTES — DOWNLOAD / RANGE
// =============================================================================

describe('File download route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [],
            name: 'workspace-1',
        })
        mocks.getNatsInstance.mockReturnValue({ getObject: mocks.getObject })
    })

    it('serves direct image bytes and supports download headers', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [
                {
                    id: 'file-1',
                    name: 'clip.mp4',
                    mimeType: 'video/mp4',
                    kind: 'video',
                    uploadedAt: 0,
                    size: 4,
                    modelSafe: true,
                },
            ],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        const data = Uint8Array.from([7, 8, 9, 10])
        mocks.getObject.mockResolvedValue(data)

        const req: any = {
            ...createGetRequest('workspace-1', 'file-1'),
            query: { download: 'true' },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)

        await getHandler(req, res)

        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-1')
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="clip.mp4"')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 4)
        expect(res.end).toHaveBeenCalledWith(Buffer.from([7, 8, 9, 10]))
        expect(res.status).not.toHaveBeenCalled()
    })

    it('serves rangeable video bytes with Content-Range and 206', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [
                {
                    id: 'file-2',
                    name: 'clip.mp4',
                    mimeType: 'video/mp4',
                    kind: 'video',
                    uploadedAt: 0,
                    size: 5,
                    modelSafe: true,
                },
            ],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        mocks.getObject.mockResolvedValue(Uint8Array.from([10, 11, 12, 13, 14]))

        const req: any = {
            ...createGetRequest('workspace-1', 'file-2'),
            headers: {
                range: 'bytes=1-3',
                authorization: 'Bearer token-1',
            },
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 1-3/5')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 3)
        expect(res.status).toHaveBeenCalledWith(206)
        expect(res.end).toHaveBeenCalledWith(Buffer.from([11, 12, 13]))
    })

    it('resolves canonical references to the original file record', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [
                {
                    id: 'original-video',
                    canonicalFileId: 'video-workspace-1-canonical',
                    canonicalMimeType: 'video/mp4',
                    kind: 'video',
                    name: 'canonical.mp4',
                    uploadedAt: 0,
                    size: 4,
                    modelSafe: true,
                },
            ],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        const req: any = {
            ...createGetRequest('workspace-1', 'video-workspace-1-canonical'),
            headers: { authorization: 'Bearer token-1' },
            query: {},
        }
        const res = createResponse()
        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3, 4]))

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'video-workspace-1-canonical')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4')
        expect(res.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3, 4]))
    })

    it('returns 416 for malformed range on rangeable media', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [
                {
                    id: 'file-range-bad',
                    name: 'video.mp4',
                    mimeType: 'video/mp4',
                    kind: 'video',
                    uploadedAt: 0,
                    size: 3,
                    modelSafe: true,
                },
            ],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3]))

        const req: any = {
            ...createGetRequest('workspace-1', 'file-range-bad'),
            headers: {
                range: 'bytes=10-20',
                authorization: 'Bearer token-1',
            },
            query: {},
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(416)
        expect(res.end).toHaveBeenCalled()
        expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */3')
    })

    it('returns 416 for malformed range header syntax', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [
                {
                    id: 'file-range-bad-syntax',
                    name: 'video.mp4',
                    mimeType: 'video/mp4',
                    kind: 'video',
                    uploadedAt: 0,
                    size: 5,
                    modelSafe: true,
                },
            ],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle
        const req: any = {
            ...createGetRequest('workspace-1', 'file-range-bad-syntax'),
            headers: {
                range: 'bytes=abc-def',
                authorization: 'Bearer token-1',
            },
            query: {},
        }
        const res = createResponse()

        mocks.getObject.mockResolvedValue(Uint8Array.from([1, 2, 3, 4, 5]))

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(416)
        expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */5')
        expect(res.end).toHaveBeenCalled()
        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-range-bad-syntax')
    })

    it('returns 404 for object-store missing streams and logs the storage lookup failure', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [{
                id: 'missing-bucket-file',
                name: 'missing.mp4',
                mimeType: 'video/mp4',
                kind: 'video',
                uploadedAt: 0,
                size: 3,
                modelSafe: true,
            }],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        const req: any = {
            ...createGetRequest('workspace-1', 'missing-bucket-file'),
            headers: { authorization: 'Bearer token-1' },
            query: {},
        }
        const res = createResponse()
        mocks.getObject.mockRejectedValueOnce(new Error('no stream available: bucket missing'))

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: 'File storage not found — data may have been lost' })
        expect(debugTools.err).toHaveBeenCalledWith(
            'Object Store bucket missing for workspace-1: no stream available: bucket missing',
        )
    })

    it('returns 500 for unexpected object-store retrieval failures', async () => {
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            files: [{
                id: 'flaky-file',
                name: 'flaky.mp4',
                mimeType: 'video/mp4',
                kind: 'video',
                uploadedAt: 0,
                size: 3,
                modelSafe: true,
            }],
            name: 'workspace-1',
        })

        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        const req: any = {
            ...createGetRequest('workspace-1', 'flaky-file'),
            headers: { authorization: 'Bearer token-1' },
            query: {},
        }
        const res = createResponse()
        mocks.getObject.mockRejectedValueOnce(new Error('disk read failed'))

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed to retrieve file' })
    })

    it('returns 503 when storage service is unavailable', async () => {
        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        mocks.getNatsInstance.mockReturnValue(undefined)
        const req: any = {
            ...createGetRequest('workspace-1', 'file-1'),
            workspace: {
                files: [
                    {
                        id: 'file-1',
                        name: 'file-1.png',
                        mimeType: 'image/png',
                        kind: 'image',
                        uploadedAt: 0,
                        size: 3,
                        modelSafe: true,
                    },
                ],
            },
            headers: { authorization: 'Bearer token-1' },
            query: {},
        }
        const res = createResponse()

        await runAuthAndAccess(route, req, res)
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({ error: 'Storage service unavailable' })
    })

    it('returns 400 for bad token', async () => {
        const route = findRoute('/:workspaceId/:fileId', 'get')
        const getHandler = route.stack.at(-1).handle

        const req: any = {
            ...createGetRequest('workspace-1', 'file-1'),
            headers: {},
            query: {},
            workspace: { files: [] },
        }
        const res = createResponse()

        await route.stack[0].handle(req, res, vi.fn())
        await getHandler(req, res)

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'No authorization token provided' })
    })
})
