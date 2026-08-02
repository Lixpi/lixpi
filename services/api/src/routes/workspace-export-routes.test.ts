'use strict'

import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'

import {
    ACTION_TIMELINE_ARTIFACT_TYPE_ID,
    ACTION_TIMELINE_SCHEMA_VERSION,
    buildActionTimelineDocument,
} from '@lixpi/capability-system'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    getWorkspace: vi.fn(),
    replaceWorkspaceContent: vi.fn(),
    assetGet: vi.fn(),
    assetCreate: vi.fn(),
    assetListReferences: vi.fn(),
    assetAttachWorkspaceReference: vi.fn(),
    assetRemoveWorkspaceReferenceForImport: vi.fn(),
    assetRemoveWorkspaceCatalogForImport: vi.fn(),
    assetDetachCatalogReference: vi.fn(),
    blobGet: vi.fn(),
    blobStore: vi.fn(),
    getUserOrganizations: vi.fn(),
    getAssetRequesterContext: vi.fn(),
    loadCurrentSnapshot: vi.fn(),
    assertAssetBackedMediaNodes: vi.fn(),
    enqueueBlobDeletion: vi.fn(),
    enqueueRenditionRetry: vi.fn(),
    enqueueWorkspaceReferenceCleanup: vi.fn(),
    getObject: vi.fn(),
    getNatsInstance: vi.fn(),
    archiveAppend: vi.fn(),
    archivePipe: vi.fn(),
    archiveOn: vi.fn().mockReturnThis(),
    archiveAbort: vi.fn(),
    archiveFinalize: vi.fn().mockResolvedValue(undefined),
    queryItems: vi.fn(),
    scanItems: vi.fn(),
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
    },
}))
vi.mock('../models/asset.ts', () => ({
    default: {
        get: mocks.assetGet,
        create: mocks.assetCreate,
        listReferences: mocks.assetListReferences,
        attachWorkspaceReference: mocks.assetAttachWorkspaceReference,
        removeWorkspaceReferenceForImport: mocks.assetRemoveWorkspaceReferenceForImport,
        removeWorkspaceCatalogForImport: mocks.assetRemoveWorkspaceCatalogForImport,
        detachCatalogReference: mocks.assetDetachCatalogReference,
    },
    buildAssetScopeAndOwnerKey: (scope: string, ownerId: string) => `${scope}#${ownerId}`,
}))
vi.mock('../models/blob.ts', () => ({
    default: { get: mocks.blobGet, store: mocks.blobStore },
}))
vi.mock('../models/organization.ts', () => ({
    default: { getUserOrganizations: mocks.getUserOrganizations },
}))
vi.mock('../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: mocks.getAssetRequesterContext,
}))
vi.mock('../services/asset-document-service.ts', () => ({
    default: {
        loadCurrentSnapshot: mocks.loadCurrentSnapshot,
        assertAssetBackedMediaNodes: mocks.assertAssetBackedMediaNodes,
    },
}))
vi.mock('../services/asset-maintenance-queue.ts', () => ({
    enqueueBlobDeletion: mocks.enqueueBlobDeletion,
    enqueueRenditionRetry: mocks.enqueueRenditionRetry,
    enqueueWorkspaceReferenceCleanup: mocks.enqueueWorkspaceReferenceCleanup,
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

const createManifestZip = (manifest: object) => {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
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

const emptyManifest = () => ({
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    workspace: {
        name: 'Test workspace',
        canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
        createdAt: 100,
        updatedAt: 200,
    },
    assets: [],
    references: [],
    blobs: [],
})

describe('Workspace export route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).dynamoDBService = {
            queryItems: mocks.queryItems,
            scanItems: mocks.scanItems,
        }
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.queryItems.mockResolvedValue({ items: [] })
        mocks.scanItems.mockResolvedValue({ items: [] })
        mocks.getAssetRequesterContext.mockResolvedValue({
            userId: 'user-1',
            workspaceIds: ['workspace-1'],
            editableWorkspaceIds: ['workspace-1'],
            organizationIds: ['org-1'],
        })
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            name: 'Test workspace',
            canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
            createdAt: 100,
            updatedAt: 200,
        })
        mocks.getNatsInstance.mockReturnValue({ getObject: mocks.getObject })
    })

    it('exports an empty workspace as a manifest-only archive', async () => {
        const route = findRoute('/:workspaceId/export', 'get')
        const handler = route.stack.at(-1).handle
        const req: any = makeWorkspaceRouteEnv()
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip')
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="workspace-assets-v2.zip"')

        const manifestCall = mocks.archiveAppend.mock.calls.find((entry: any[]) => entry[1]?.name === 'manifest.json')
        expect(manifestCall).toBeDefined()
        const manifestOutput = JSON.parse(manifestCall?.[0] as string)
        expect(manifestOutput.exportVersion).toBe(2)
        expect(manifestOutput.assets).toEqual([])
        expect(manifestOutput.blobs).toEqual([])
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
    })
})

describe('Workspace import route', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).dynamoDBService = {
            queryItems: mocks.queryItems,
            scanItems: mocks.scanItems,
        }
        mocks.verify.mockResolvedValue({ decoded: { sub: 'user-1' } })
        mocks.queryItems.mockResolvedValue({ items: [] })
        mocks.scanItems.mockResolvedValue({ items: [] })
        mocks.getUserOrganizations.mockResolvedValue([{ organizationId: 'org-1' }])
        mocks.getAssetRequesterContext.mockResolvedValue({
            userId: 'user-1',
            workspaceIds: ['workspace-1'],
            editableWorkspaceIds: ['workspace-1'],
            organizationIds: ['org-1'],
        })
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
            canvasStateUpdatedAt: 200,
        })
        mocks.replaceWorkspaceContent.mockResolvedValue(undefined)
        mocks.enqueueBlobDeletion.mockResolvedValue(undefined)
        mocks.enqueueRenditionRetry.mockResolvedValue(undefined)
        mocks.enqueueWorkspaceReferenceCleanup.mockResolvedValue(undefined)
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
        expect(res.json).toHaveBeenCalledWith({ error: 'MISSING_MANIFEST' })
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

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json.mock.calls[0][0]).toHaveProperty('error')
    })

    it('rejects unsupported export versions', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: createManifestZip({ ...emptyManifest(), exportVersion: 1 }) },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: 'REVISION_2_ARCHIVE_REQUIRED' })
    })

    it('imports a valid empty-workspace archive and replaces workspace canvas state', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: createManifestZip(emptyManifest()) },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(mocks.getUserOrganizations).toHaveBeenCalledWith({ userId: 'user-1' })
        expect(mocks.replaceWorkspaceContent).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            canvasState: expect.objectContaining({ nodes: [], edges: [] }),
            expectedCanvasStateUpdatedAt: 200,
        }))
        expect(res.json).toHaveBeenCalledWith({ success: true, importedAssets: 0 })
    })

    it('imports an Action Timeline Artifact document with its module-owned schema', async () => {
        const sourceAssetId = '7e7d5caa-58b1-44dd-b9bd-38ab99f28b4a'
        const sourceWorkspaceId = 'source-workspace-1'
        const nodeId = 'capability-artifact-node-1'
        const document = buildActionTimelineDocument(
            { durationMs: 2000, precisionMs: 2000 },
            [{ slotIndex: 0, runs: [{ text: 'The subject crosses the frame.' }] }],
        )
        const documentBytes = Buffer.from(JSON.stringify(document))
        const blobHash = createHash('sha256').update(documentBytes).digest('hex')
        const manifest = {
            ...emptyManifest(),
            workspace: {
                ...emptyManifest().workspace,
                canvasState: {
                    viewport: { x: 0, y: 0, zoom: 1 },
                    nodes: [{
                        nodeId,
                        type: 'capabilityArtifact',
                        assetId: sourceAssetId,
                        artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
                        position: { x: 0, y: 0 },
                        dimensions: { width: 520, height: 360 },
                    }],
                    edges: [],
                },
            },
            assets: [{
                assetId: sourceAssetId,
                organizationId: 'source-organization-1',
                title: 'Action Timeline',
                scope: 'workspace',
                scopeOwnerId: sourceWorkspaceId,
                originWorkspaceId: sourceWorkspaceId,
                ownerUserId: 'source-user-1',
                documents: {
                    capabilityArtifact: {
                        role: 'capabilityArtifact',
                        blobHash,
                        version: 0,
                        schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
                        byteSize: documentBytes.byteLength,
                        updatedAt: 100,
                    },
                },
                artifact: {
                    artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
                    schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
                },
                states: {
                    lifecycle: 'active',
                    media: 'none',
                    conversation: 'none',
                    provenance: 'none',
                },
                referenceCount: 1,
                revision: 1,
                createdAt: 100,
                updatedAt: 100,
            }],
            references: [{
                assetId: sourceAssetId,
                referenceKey: `workspace#${sourceWorkspaceId}`,
                type: 'workspace',
                workspaceId: sourceWorkspaceId,
                nodeIds: [nodeId],
                surfaceIds: [],
                createdAt: 100,
                updatedAt: 100,
            }],
            blobs: [{
                blobHash,
                mimeType: 'application/json',
                byteSize: documentBytes.byteLength,
            }],
        }
        const zip = new AdmZip()
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
        zip.addFile(`blobs/${blobHash}`, documentBytes)
        mocks.blobStore.mockImplementation(async ({ bytes }: { bytes: Uint8Array }) => ({
            blobHash: createHash('sha256').update(bytes).digest('hex'),
        }))
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: zip.toBuffer() },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(mocks.assetCreate).toHaveBeenCalledWith(expect.objectContaining({
            artifact: {
                artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
                schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
            },
            documents: {
                capabilityArtifact: expect.objectContaining({
                    role: 'capabilityArtifact',
                    schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
                }),
            },
        }))
        expect(res.json).toHaveBeenCalledWith({ success: true, importedAssets: 1 })
    })

    it('denies import when the workspace organization is not accessible to the user', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        mocks.getUserOrganizations.mockResolvedValue([{ organizationId: 'other-org' }])
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: createManifestZip(emptyManifest()) },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith({ error: 'ORGANIZATION_ACCESS_DENIED' })
        expect(mocks.replaceWorkspaceContent).not.toHaveBeenCalled()
    })

    it('denies import when the requester cannot edit the target workspace', async () => {
        const route = findRoute('/:workspaceId/import', 'post')
        const handler = route.stack.at(-1).handle
        mocks.getAssetRequesterContext.mockResolvedValue({
            userId: 'user-1',
            workspaceIds: ['workspace-1'],
            editableWorkspaceIds: [],
            organizationIds: ['org-1'],
        })
        const req: any = {
            ...makeWorkspaceRouteEnv(),
            file: { buffer: createManifestZip(emptyManifest()) },
        }
        const res = createResponse()

        await runRouteAuthAndAccess(route, req, res)
        await handler(req, res)

        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith({ error: 'PERMISSION_DENIED' })
        expect(mocks.replaceWorkspaceContent).not.toHaveBeenCalled()
    })
})
