'use strict'

import type { Asset, CanvasState, MediaGenerationRunMeta } from '@lixpi/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    attachWorkspaceReference: vi.fn(),
    buildAssetCanvasGeometryUpdate: vi.fn(),
    getAssetRecord: vi.fn(),
    getWorkspace: vi.fn(),
    projectGeneratedAssetNode: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({
    default: { attachWorkspaceReference: mocks.attachWorkspaceReference },
    buildAssetProjectionOperations: vi.fn(async () => []),
    getAssetRecord: mocks.getAssetRecord,
    publishAssetEvent: vi.fn(),
}))
vi.mock('../models/blob.ts', () => ({
    default: {},
    buildBlobReferenceOperations: vi.fn(() => []),
}))
vi.mock('../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))
vi.mock('./asset-canvas-projection.ts', () => ({
    buildAssetCanvasGeometryUpdate: mocks.buildAssetCanvasGeometryUpdate,
    projectGeneratedAssetNode: mocks.projectGeneratedAssetNode,
}))
vi.mock('./asset-rendition-service.ts', () => ({ default: {} }))
vi.mock('./asset-maintenance-queue.ts', () => ({ enqueueRenditionRetry: vi.fn() }))

import {
    attachGeneratedAssetNode,
    collectGeneratedAssetSourceIds,
} from './generated-asset-storage.ts'

const generationRun: MediaGenerationRunMeta = {
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request-1',
    mediaRunId: 'media-1',
    mediaType: 'image',
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: {
        assetId: 'asset-1',
        generationRequestId: 'request-1',
        mediaRunId: 'media-1',
        mediaType: 'image',
        mediaIndex: 0,
        branchId: 'branch-1',
        lineageParentNodeId: 'fork-1',
        referenceAssetIds: [],
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        promptText: 'draw a stone',
        createdAt: 1,
    },
}

const asset = (originalReady: boolean): Asset => ({
    assetId: 'asset-1',
    organizationId: 'organization-1',
    title: 'Generated image',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    documents: {},
    ...(originalReady ? {
        media: {
            kind: 'image',
            originalName: 'image.png',
            sourceMimeType: 'image/png',
            modelSafe: true,
            renditions: {
                original: {
                    name: 'original',
                    status: 'ready',
                    blobHash: 'hash-1',
                    mimeType: 'image/png',
                    byteSize: 100,
                    updatedAt: 1,
                },
            },
        },
    } : {}),
    states: {
        lifecycle: 'creating',
        media: 'processing',
        conversation: 'none',
        provenance: 'building',
    },
    referenceCount: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
})

const canvasState: CanvasState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
}

describe('collectGeneratedAssetSourceIds', () => {
    it('preserves Asset-only references while translating only node-backed context IDs', () => {
        expect(collectGeneratedAssetSourceIds(
            {
                ...generationRun.lineageAssignment!,
                referenceAssetIds: ['library-portrait', 'context-node'],
                sourceContextNodeIds: ['context-node'],
            },
            {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'thread-1',
                regionNodeId: 'standalone:thread-1',
                promptText: 'Use both references',
                promptFingerprint: 'fingerprint',
                transcriptContext: '',
                candidates: [{
                    candidateId: 'node:context-node',
                    nodeId: 'context-node',
                    assetId: 'context-asset',
                    imageUrl: 'nats-obj://assets/context',
                    roleHints: ['base-context'],
                    ancestorNodeIds: ['context-node'],
                    sourceContextNodeIds: ['context-node'],
                }],
            },
        )).toEqual(['library-portrait', 'context-node', 'context-asset'])
    })
})

beforeEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
    mocks.getWorkspace.mockResolvedValue({
        workspaceId: 'workspace-1',
        updatedAt: 100,
        canvasStateUpdatedAt: 100,
        canvasState,
    })
    mocks.projectGeneratedAssetNode.mockReturnValue({
        canvasState,
        nodeId: 'pending-image-media-1',
        geometryNodes: [],
    })
    mocks.attachWorkspaceReference.mockResolvedValue({
        assetId: 'asset-1',
        referenceKey: 'workspace#workspace-1',
        type: 'workspace',
        nodeIds: ['pending-image-media-1'],
        createdAt: 1,
        updatedAt: 101,
    })
    mocks.buildAssetCanvasGeometryUpdate.mockImplementation((params) => ({
        generationRequestId: params.generationRequestId,
        layoutRevision: params.layoutRevision,
        nodes: params.geometryNodes,
    }))
})

describe('attachGeneratedAssetNode', () => {
    it.each([
        { originalReady: false, expectedPending: true },
        { originalReady: true, expectedPending: false },
    ])('projects the API phase from Asset readiness before attaching', async ({ originalReady, expectedPending }) => {
        vi.useFakeTimers()
        vi.setSystemTime(100)
        mocks.getAssetRecord.mockResolvedValue(asset(originalReady))

        const geometry = await attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 16 / 9,
            generationRun,
            conversationAssetId: 'thread-1',
        })

        expect(mocks.projectGeneratedAssetNode).toHaveBeenCalledWith(expect.objectContaining({
            pendingBeforeFirstFrame: expectedPending,
        }))
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            workspaceMutation: expect.objectContaining({
                expectedCanvasStateUpdatedAt: 100,
                canvasStateUpdatedAt: 101,
            }),
        }))
        expect(geometry.layoutRevision).toBe(101)
    })

    it('re-reads and reprojects after a concurrent attachment wins the workspace condition', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100)
        const conditionalFailure = Object.assign(new Error('stale'), {
            name: 'TransactionCanceledException',
            CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
        })
        mocks.getAssetRecord.mockResolvedValue(asset(false))
        mocks.getWorkspace
            .mockResolvedValueOnce({
                workspaceId: 'workspace-1',
                updatedAt: 100,
                canvasStateUpdatedAt: 100,
                canvasState,
            })
            .mockResolvedValueOnce({
                workspaceId: 'workspace-1',
                updatedAt: 101,
                canvasStateUpdatedAt: 101,
                canvasState,
            })
        mocks.attachWorkspaceReference
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce({
                assetId: 'asset-1',
                referenceKey: 'workspace#workspace-1',
                type: 'workspace',
                nodeIds: ['pending-image-media-1'],
                createdAt: 1,
                updatedAt: 102,
            })

        const geometry = await attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })

        expect(mocks.getWorkspace).toHaveBeenCalledTimes(2)
        expect(mocks.projectGeneratedAssetNode).toHaveBeenCalledTimes(2)
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledTimes(2)
        expect(geometry.layoutRevision).toBe(102)
    })

    it('re-reads and reprojects when the workspace mutation rejects a stale pre-transaction snapshot', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100)
        mocks.getAssetRecord.mockResolvedValue(asset(false))
        mocks.getWorkspace
            .mockResolvedValueOnce({
                workspaceId: 'workspace-1',
                updatedAt: 100,
                canvasStateUpdatedAt: 100,
                canvasState,
            })
            .mockResolvedValueOnce({
                workspaceId: 'workspace-1',
                updatedAt: 101,
                canvasStateUpdatedAt: 101,
                canvasState,
            })
        mocks.attachWorkspaceReference
            .mockRejectedValueOnce(new Error('STALE_CANVAS_STATE'))
            .mockResolvedValueOnce({
                assetId: 'asset-1',
                referenceKey: 'workspace#workspace-1',
                type: 'workspace',
                nodeIds: ['pending-image-media-1'],
                createdAt: 1,
                updatedAt: 102,
            })

        const geometry = await attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })

        expect(mocks.getWorkspace).toHaveBeenCalledTimes(2)
        expect(mocks.projectGeneratedAssetNode).toHaveBeenCalledTimes(2)
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledTimes(2)
        expect(geometry.layoutRevision).toBe(102)
    })

    it('bounds repeated stale pre-transaction snapshots to five attachment attempts', async () => {
        mocks.getAssetRecord.mockResolvedValue(asset(false))
        mocks.attachWorkspaceReference.mockRejectedValue(new Error('STALE_CANVAS_STATE'))

        await expect(attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })).rejects.toThrow('STALE_CANVAS_STATE')

        expect(mocks.getWorkspace).toHaveBeenCalledTimes(5)
        expect(mocks.projectGeneratedAssetNode).toHaveBeenCalledTimes(5)
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledTimes(5)
    })

    it('does not retry an unrelated workspace attachment error', async () => {
        mocks.getAssetRecord.mockResolvedValue(asset(false))
        mocks.attachWorkspaceReference.mockRejectedValueOnce(new Error('WORKSPACE_ACCESS_DENIED'))

        await expect(attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')

        expect(mocks.getWorkspace).toHaveBeenCalledTimes(1)
        expect(mocks.projectGeneratedAssetNode).toHaveBeenCalledTimes(1)
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledTimes(1)
    })

    it('uses the wall clock for a legacy workspace with no persisted canvas revision', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(100)
        mocks.getAssetRecord.mockResolvedValue(asset(false))
        mocks.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            canvasState,
        })

        const geometry = await attachGeneratedAssetNode({
            assetId: 'asset-1',
            workspaceId: 'workspace-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun,
            conversationAssetId: 'thread-1',
        })

        expect(mocks.attachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            workspaceMutation: expect.objectContaining({ canvasStateUpdatedAt: 100 }),
        }))
        expect(geometry.layoutRevision).toBe(100)
    })
})
