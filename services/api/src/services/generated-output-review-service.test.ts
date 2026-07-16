'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasState } from '@lixpi/constants'

const assetModelMocks = vi.hoisted(() => ({
    get: vi.fn(),
    updateGeneratedOutputReview: vi.fn(),
    detachWorkspaceReference: vi.fn(),
}))
const workspaceMocks = vi.hoisted(() => ({
    getWorkspace: vi.fn(),
    mutateCanvasState: vi.fn(),
}))
const projectionMocks = vi.hoisted(() => ({
    detachReviewedGeneratedOutputsFromCanvas: vi.fn(),
    removeGeneratedOutputCandidateFromCanvas: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({ default: assetModelMocks }))
vi.mock('../models/workspace.ts', () => ({ default: workspaceMocks }))
vi.mock('./asset-canvas-projection.ts', () => projectionMocks)

import { GeneratedOutputReviewService } from './generated-output-review-service.ts'

const requester = {
    userId: 'user-1',
    editableWorkspaceIds: ['workspace-1'],
} as any

const marker = {
    nodeId: 'branch-line-1',
    type: 'branchLine',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 120, height: 60 },
    provenance: {},
}

const mediaNode = {
    nodeId: 'media-1',
    type: 'image',
    assetId: 'asset-1',
    position: { x: 200, y: 0 },
    dimensions: { width: 320, height: 320 },
    generatedBy: {
        branchId: 'branch-1',
        branchLineNodeId: 'branch-line-1',
        lineageParentNodeId: 'branch-line-1',
        generationRequestId: 'request-1',
    },
}

const canvasState = (): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [marker, mediaNode] as any,
    edges: [{
        edgeId: 'edge-branch-line-1-media-1',
        sourceNodeId: 'branch-line-1',
        targetNodeId: 'media-1',
        sourceHandle: 'right',
        targetHandle: 'left',
    }],
})

const workspace = (state = canvasState()) => ({
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    updatedAt: 100,
    canvasStateUpdatedAt: 100,
    canvasState: state,
})

const readyAsset = () => ({
    assetId: 'asset-1',
    organizationId: 'organization-1',
    media: { renditions: { original: { status: 'ready' } } },
    documents: { provenance: { version: 1 } },
    states: { provenance: 'sealed' },
})

describe('GeneratedOutputReviewService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        assetModelMocks.get.mockResolvedValue(readyAsset())
        assetModelMocks.updateGeneratedOutputReview.mockResolvedValue(readyAsset())
        assetModelMocks.detachWorkspaceReference.mockResolvedValue({ success: true })
    })

    it('rejects media-node prompt regeneration before any canvas or Asset mutation', async () => {
        const result = await new GeneratedOutputReviewService().review({
            request: {
                workspaceId: 'workspace-1',
                scope: 'media-node',
                action: 'supersede',
                nodeId: 'media-1',
                preserveLineage: false,
            } as any,
            requester,
        })

        expect(result).toEqual({ error: 'MEDIA_NODE_PROMPT_REGENERATION_NOT_SUPPORTED' })
        expect(workspaceMocks.getWorkspace).not.toHaveBeenCalled()
        expect(assetModelMocks.updateGeneratedOutputReview).not.toHaveBeenCalled()
        expect(assetModelMocks.detachWorkspaceReference).not.toHaveBeenCalled()
    })

    it('supersedes one media candidate while preserving its API lineage marker for replay', async () => {
        const initialState = canvasState()
        const removedState: CanvasState = { ...initialState, nodes: [marker] as any, edges: [] }
        workspaceMocks.getWorkspace
            .mockResolvedValueOnce(workspace(initialState))
            .mockResolvedValueOnce(workspace(initialState))
            .mockResolvedValueOnce({ ...workspace(removedState), canvasStateUpdatedAt: 101 })
        projectionMocks.detachReviewedGeneratedOutputsFromCanvas.mockReturnValue({
            canvasState: initialState,
            affectedNodes: [mediaNode],
            geometryNodes: [],
            removedNodeIds: [],
            removedEdgeIds: [],
        })
        projectionMocks.removeGeneratedOutputCandidateFromCanvas.mockReturnValue({
            canvasState: removedState,
            geometryNodes: [],
            removedNodeIds: ['media-1'],
            removedEdgeIds: ['edge-branch-line-1-media-1'],
        })

        const result = await new GeneratedOutputReviewService().review({
            request: {
                workspaceId: 'workspace-1',
                scope: 'media-node',
                action: 'supersede',
                nodeId: 'media-1',
                preserveLineage: true,
            },
            requester,
        })

        expect(assetModelMocks.updateGeneratedOutputReview).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            status: 'superseded',
            regenerationMode: 'existing-prompt',
        }))
        const removalRequest = projectionMocks.removeGeneratedOutputCandidateFromCanvas.mock.calls[0]?.[0]
        expect(removalRequest).toMatchObject({ nodeId: 'media-1' })
        expect(removalRequest.preserveLineageNodeIds).toEqual(new Set(['branch-line-1']))
        expect(assetModelMocks.detachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            nodeId: 'media-1',
            workspaceMutation: expect.objectContaining({ canvasState: removedState }),
        }))
        expect(result).toMatchObject({
            success: true,
            supersededAssetIds: ['asset-1'],
            canvasGeometry: {
                layoutRevision: 101,
                nodeSnapshots: [marker],
                removedNodeIds: ['media-1'],
                removedEdgeIds: ['edge-branch-line-1-media-1'],
            },
        })
    })

    it('accepts a reviewed output through a server canvas mutation and returns its geometry', async () => {
        const initialState = canvasState()
        const acceptedState: CanvasState = {
            ...initialState,
            nodes: [{ ...mediaNode, generatedBy: { generationRequestId: 'request-1' } }] as any,
            edges: [],
        }
        workspaceMocks.getWorkspace.mockResolvedValue(workspace(initialState))
        projectionMocks.detachReviewedGeneratedOutputsFromCanvas.mockReturnValue({
            canvasState: acceptedState,
            affectedNodes: [mediaNode],
            geometryNodes: [{
                nodeId: 'media-1',
                position: mediaNode.position,
                dimensions: mediaNode.dimensions,
            }],
            removedNodeIds: ['branch-line-1'],
            removedEdgeIds: ['edge-branch-line-1-media-1'],
        })
        workspaceMocks.mutateCanvasState.mockImplementation(async ({ mutate }) => {
            const mutation = mutate(initialState)
            return {
                changed: mutation.changed,
                canvasState: mutation.canvasState,
                canvasStateUpdatedAt: 102,
            }
        })

        const result = await new GeneratedOutputReviewService().review({
            request: {
                workspaceId: 'workspace-1',
                scope: 'media-node',
                action: 'accept',
                nodeId: 'media-1',
            },
            requester,
        })

        expect(assetModelMocks.updateGeneratedOutputReview).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            status: 'accepted',
        }))
        expect(workspaceMocks.mutateCanvasState).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            origin: 'acceptGeneratedOutput',
        }))
        expect(result).toMatchObject({
            success: true,
            acceptedAssetIds: ['asset-1'],
            canvasGeometry: {
                layoutRevision: 102,
                nodes: [{ nodeId: 'media-1' }],
                nodeSnapshots: [{ nodeId: 'media-1' }],
                removedNodeIds: ['branch-line-1'],
            },
        })
    })
})
