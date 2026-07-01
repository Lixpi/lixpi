'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    getWorkspace: vi.fn(),
    getWorkspaceDocuments: vi.fn(),
    getWorkspaceAiChatThreads: vi.fn(),
    deleteWorkspaceDocuments: vi.fn(),
    deleteWorkspaceAiChatThreads: vi.fn(),
    importDocument: vi.fn(),
    createAiChatThread: vi.fn(),
    replaceWorkspaceContent: vi.fn(),
    getCanvasStateReferencedFileIds: vi.fn(),
    getObject: vi.fn(),
    getObjectStore: vi.fn(),
    createObjectStore: vi.fn(),
    putObject: vi.fn(),
    getNatsInstance: vi.fn(),
    archiveAppend: vi.fn(),
    archivePipe: vi.fn(),
    archiveOn: vi.fn().mockReturnThis(),
    archiveAbort: vi.fn(),
    archiveFinalize: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('archiver', () => ({
    ZipArchive: vi.fn(function () {
        return {
        append: mocks.archiveAppend,
        pipe: mocks.archivePipe,
        on: mocks.archiveOn,
        abort: mocks.archiveAbort,
        finalize: mocks.archiveFinalize,
        }
    }),
}))

vi.mock('@lixpi/debug-tools', () => ({ err: vi.fn(), info: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: mocks.getNatsInstance },
}))
vi.mock('../helpers/auth.ts', () => ({
    jwtVerifier: { verify: mocks.verify },
}))
vi.mock('../models/workspace.ts', () => ({
    default: {
        getWorkspace: mocks.getWorkspace,
        replaceWorkspaceContent: mocks.replaceWorkspaceContent,
        getCanvasStateReferencedFileIds: mocks.getCanvasStateReferencedFileIds,
    },
}))
vi.mock('../models/document.ts', () => ({
    default: { getWorkspaceDocuments: mocks.getWorkspaceDocuments, importDocument: mocks.importDocument, deleteWorkspaceDocuments: mocks.deleteWorkspaceDocuments },
}))
vi.mock('../models/ai-chat-thread.ts', () => ({
    default: { getWorkspaceAiChatThreads: mocks.getWorkspaceAiChatThreads, createAiChatThread: mocks.createAiChatThread, deleteWorkspaceAiChatThreads: mocks.deleteWorkspaceAiChatThreads },
}))

import workspaceExportRoutes from './workspace-export-routes.ts'

const findRoute = (path: string, method: string) => {
    return (workspaceExportRoutes as any).stack
        .find((layer: any) => layer.route?.path === path && layer.route?.methods?.[method])
        .route
}

const createResponse = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    set: vi.fn(),
    on: vi.fn(),
    end: vi.fn().mockReturnThis(),
    send: vi.fn(),
})

const createWorkspaceZip = (manifest: object, imageEntries: Record<string, { ext: string; data: Uint8Array }> = {}) => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    for (const [fileId, image] of Object.entries(imageEntries)) {
        zip.addFile(`images/${fileId}${image.ext}`, image.data)
    }
    return zip.toBuffer()
}

const makeWorkspaceRouteEnv = () => ({
    params: { workspaceId: 'workspace-1' },
    headers: { authorization: 'Bearer token-1' },
    query: {},
})

const runRouteAuthAndAccess = async (route: any, req: any, res: any) => {
    await route.stack[0].handle(req, res, vi.fn())
    await route.stack[1].handle(req, res, vi.fn())
}

describe('Workspace export route', () => {
    const manifest = {
        exportVersion: 1,
        exportedAt: '2025-12-31T00:00:00.000Z',
        workspace: {
            workspaceId: 'workspace-1',
            name: 'test workspace',
            canvasState: {
                nodes: [
                    { type: 'image', fileId: 'file-1', src: '/api/files/workspace-1/file-1' },
                    { type: 'image', fileId: 'file-3', src: '/api/files/workspace-1/file-3' },
                ],
            },
            files: [
                { id: 'file-1', name: 'file-1.png', mimeType: 'image/png', kind: 'image' },
                { id: 'file-2', name: 'file-2.png', mimeType: 'image/png', kind: 'image' },
            ],
            createdAt: 100,
            updatedAt: 200,
        },
        documents: [{ documentId: 'doc-1', title: 'Doc One', content: '{}' }],
        aiChatThreads: [{ threadId: 'thread-1', content: '{}', aiModel: 'x' }],
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            name: 'test workspace',
            files: manifest.workspace.files,
            canvasState: manifest.workspace.canvasState,
            createdAt: 100,
            updatedAt: 200,
        })
        mocks.getWorkspaceDocuments.mockResolvedValue([{ documentId: 'doc-1' }])
        mocks.getWorkspaceAiChatThreads.mockResolvedValue([{ threadId: 'thread-1' }])
        mocks.getObject.mockImplementation((bucketName: string, fileId: string) => {
            if (fileId === 'file-1') return Promise.resolve(Uint8Array.from([1]))
            if (fileId === 'file-3') return Promise.resolve(Uint8Array.from([2, 3]))
            if (fileId === 'file-2') return Promise.resolve(undefined)
            return Promise.resolve(undefined)
        })
        mocks.getNatsInstance.mockReturnValue({
            getObject: mocks.getObject,
            getObjectStore: mocks.getObjectStore,
            createObjectStore: mocks.createObjectStore,
            putObject: mocks.putObject,
        })
    })

    it('exports manifest, canonical image bytes, and canvas-only files to a zip stream', async () => {
        const route = findRoute('/:workspaceId/export', 'get')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            workspace: { files: manifest.workspace.files, canvasState: manifest.workspace.canvasState },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="test_workspace-export.zip"')

        const entries = mocks.archiveAppend.mock.calls
        const manifestCall = entries.find((entry: any[]) => entry[1]?.name === 'manifest.json')
        const images = entries.filter((entry: any[]) => (entry[1]?.name ?? '').startsWith('images/')).map((entry: any[]) => entry[1].name)
        const missingImagesCall = entries.find((entry: any[]) => entry[1]?.name === 'missing-images.json')

        expect(manifestCall).toBeDefined()
        const manifestOutput = JSON.parse(manifestCall?.[0] as string)
        expect(manifestOutput.workspace.files).toHaveLength(2)
        expect(images).toEqual(['images/file-1.png', 'images/file-3.png'])
        expect(missingImagesCall).toBeDefined()
        const missingPayload = JSON.parse(missingImagesCall?.[0] as string)
        expect(missingPayload.missingFileIds).toEqual(['file-2'])
        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-1')
        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-2')
        expect(mocks.getObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-3')
        expect(mocks.archiveFinalize).toHaveBeenCalledOnce()
    })

    it('exports manifest-only payload when object store is unavailable', async () => {
        const route = findRoute('/:workspaceId/export', 'get')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            workspace: { files: [], canvasState: { nodes: [] } },
        }
        const res = createResponse()
        mocks.getNatsInstance.mockReturnValue(undefined)

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).not.toHaveBeenCalled()
        expect(mocks.archiveAppend).toHaveBeenCalledTimes(1)
        expect(mocks.archiveAppend).toHaveBeenCalledWith(expect.any(String), { name: 'manifest.json' })
        expect(mocks.archiveFinalize).toHaveBeenCalledOnce()
    })

    it('returns 404 when workspace is missing', async () => {
        const route = findRoute('/:workspaceId/export', 'get')
        const req = makeWorkspaceRouteEnv()
        const res = createResponse()
        mocks.getWorkspace.mockResolvedValue({ error: 'NOT_FOUND' })

        await route.stack[0].handle(req, res, vi.fn())
        await route.stack[1].handle(req, res, vi.fn())

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: 'Workspace not found' })
    })
})

describe('Workspace import route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1', files: [], canvasState: { nodes: [] } })
        mocks.deleteWorkspaceDocuments.mockResolvedValue(undefined)
        mocks.deleteWorkspaceAiChatThreads.mockResolvedValue(undefined)
        mocks.importDocument.mockResolvedValue(undefined)
        mocks.createAiChatThread.mockResolvedValue(undefined)
        mocks.replaceWorkspaceContent.mockResolvedValue(undefined)
        mocks.getCanvasStateReferencedFileIds.mockReturnValue(new Set())
        mocks.getObjectStore.mockResolvedValue({ name: 'bucket' })
        mocks.createObjectStore.mockResolvedValue(undefined)
        mocks.getNatsInstance.mockReturnValue({
            getObjectStore: mocks.getObjectStore,
            createObjectStore: mocks.createObjectStore,
            putObject: mocks.putObject,
        })
    })

    it('rejects import archives missing manifest.json', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const zip = new AdmZip()
        zip.addFile('note.txt', Buffer.from('not a manifest'))
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: zip.toBuffer() },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'ZIP archive is missing manifest.json' })
    })

    it('rejects archives with invalid manifest JSON', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const zip = new AdmZip()
        zip.addFile('manifest.json', Buffer.from('{ this is invalid json'))
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: zip.toBuffer() },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'manifest.json contains invalid JSON' })
    })

    it('rejects unsupported export versions', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: {
                buffer: createWorkspaceZip({
                    exportVersion: 2,
                    exportedAt: '2025-12-31T00:00:00.000Z',
                    workspace: { workspaceId: 'workspace-1', canvasState: { nodes: [] }, files: [], createdAt: 100, updatedAt: 200 },
                    documents: [],
                    aiChatThreads: [],
                }),
            },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported export version: 2' })
    })

    it('imports a valid export archive and writes workspace state', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const manifest = {
            exportVersion: 1,
            exportedAt: '2025-12-31T00:00:00.000Z',
            workspace: {
                workspaceId: 'workspace-1',
                name: 'test workspace',
                canvasState: {
                    nodes: [
                        { type: 'image', fileId: 'file-1', src: '/api/files/workspace-1/file-1' },
                    ],
                },
                files: [{ id: 'file-1', name: 'file-1.png', mimeType: 'image/png', kind: 'image' }],
                createdAt: 100,
                updatedAt: 200,
            },
            documents: [{ documentId: 'doc-1', title: 'Doc', content: '{}' }],
            aiChatThreads: [{ threadId: 'thread-1', content: '{}', aiModel: 'x' }],
        }
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: {
                buffer: createWorkspaceZip(
                    manifest,
                    {
                        'file-1': { ext: '.png', data: Uint8Array.from([9, 8, 7]) },
                    }
                ),
            },
        }
        mocks.getCanvasStateReferencedFileIds.mockReturnValue(new Set(['file-1']))
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(mocks.getWorkspace).toHaveBeenCalledWith({ workspaceId: 'workspace-1', userId: 'user-1' })
        expect(mocks.deleteWorkspaceDocuments).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
        expect(mocks.deleteWorkspaceAiChatThreads).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
        expect(mocks.importDocument).toHaveBeenCalledWith({
            documentId: 'doc-1',
            workspaceId: 'workspace-1',
            title: 'Doc',
            content: '{}',
            createdAt: undefined,
            updatedAt: undefined,
        })
        expect(mocks.createAiChatThread).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: '{}',
            aiModel: 'x',
        })
        expect(mocks.putObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'file-1', Buffer.from([9, 8, 7]), {
            name: 'file-1',
            description: 'file-1.png',
        })
        expect(mocks.replaceWorkspaceContent).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'workspace-1',
                canvasState: expect.objectContaining({
                    nodes: [
                        expect.objectContaining({
                            type: 'image',
                            fileId: 'file-1',
                            src: '/api/files/workspace-1/file-1',
                            workspaceId: 'workspace-1',
                        }),
                    ],
                }),
            })
        )
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            workspaceId: 'workspace-1',
            imported: { documents: 1, aiChatThreads: 1, images: 1 },
        })
    })

    it('rejects archives missing required manifest-referenced images', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const manifest = {
            exportVersion: 1,
            exportedAt: '2025-12-31T00:00:00.000Z',
            workspace: {
                workspaceId: 'workspace-1',
                name: 'test workspace',
                canvasState: {
                    nodes: [{ type: 'image', fileId: 'missing-1' }],
                },
                files: [{ id: 'missing-1', name: 'missing-1.png', mimeType: 'image/png', kind: 'image' }],
                createdAt: 100,
                updatedAt: 200,
            },
            documents: [{ documentId: 'doc-1', title: 'Doc', content: '{}' }],
            aiChatThreads: [{ threadId: 'thread-1', content: '{}', aiModel: 'x' }],
        }
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: createWorkspaceZip(manifest) },
        }
        const res = createResponse()
        mocks.getCanvasStateReferencedFileIds.mockReturnValue(new Set(['missing-1']))

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Archive is missing Object Store entries referenced by the workspace manifest',
            missingFileIds: ['missing-1'],
        })
    })

    it('surfaces dangling image refs when canvas references are not in archive', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const manifest = {
            exportVersion: 1,
            exportedAt: '2025-12-31T00:00:00.000Z',
            workspace: {
                workspaceId: 'workspace-1',
                name: 'test workspace',
                canvasState: {
                    nodes: [
                        { type: 'image', fileId: 'file-1', src: '/api/files/workspace-1/file-1' },
                        { type: 'image', fileId: 'dangling-file', src: '/api/files/workspace-1/dangling-file' },
                    ],
                },
                files: [{ id: 'file-1', name: 'file-1.png', mimeType: 'image/png', kind: 'image' }],
                createdAt: 100,
                updatedAt: 200,
            },
            documents: [{ documentId: 'doc-1', title: 'Doc', content: '{}' }],
            aiChatThreads: [{ threadId: 'thread-1', content: '{}', aiModel: 'x' }],
        }
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: {
                buffer: createWorkspaceZip(
                    manifest,
                    {
                        'file-1': { ext: '.png', data: Uint8Array.from([1, 2, 3]) },
                    }
                ),
            },
        }
        mocks.getCanvasStateReferencedFileIds.mockReturnValue(new Set(['file-1']))
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                warnings: expect.arrayContaining([
                    {
                        type: 'missing_images',
                        message: 'Some canvas image nodes reference images that were not in the archive and will render broken.',
                        fileIds: ['dangling-file'],
                    },
                ]),
            })
        )
        expect(mocks.replaceWorkspaceContent).toHaveBeenCalledWith(
            expect.objectContaining({
                canvasState: expect.objectContaining({
                    nodes: expect.arrayContaining([
                        expect.objectContaining({
                            type: 'image',
                            fileId: 'dangling-file',
                            src: '/api/files/workspace-1/dangling-file',
                            workspaceId: 'workspace-1',
                        }),
                    ]),
                }),
            })
        )
    })

    it('returns SERVICE_UNAVAILABLE when archive has images but storage is unavailable', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const manifest = {
            exportVersion: 1,
            exportedAt: '2025-12-31T00:00:00.000Z',
            workspace: {
                workspaceId: 'workspace-1',
                name: 'test workspace',
                canvasState: {
                    nodes: [{ type: 'image', fileId: 'file-1', src: '/api/files/workspace-1/file-1' }],
                },
                files: [{ id: 'file-1', name: 'file-1.png', mimeType: 'image/png', kind: 'image' }],
                createdAt: 100,
                updatedAt: 200,
            },
            documents: [],
            aiChatThreads: [],
        }
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: {
                buffer: createWorkspaceZip(manifest, {
                    'file-1': { ext: '.png', data: Uint8Array.from([1]) },
                }),
            },
        }
        mocks.getNatsInstance.mockReturnValue(undefined)
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({ error: 'Storage service unavailable' })
    })
})
