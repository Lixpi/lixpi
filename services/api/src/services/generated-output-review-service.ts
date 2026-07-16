'use strict'

import type {
    Asset,
    AssetRequesterContext,
    CanvasGeometryUpdate,
    GeneratedOutputReviewRequest,
    GeneratedOutputReviewResponse,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import Workspace from '../models/workspace.ts'
import {
    detachReviewedGeneratedOutputsFromCanvas,
    removeGeneratedOutputCandidateFromCanvas,
} from './asset-canvas-projection.ts'

export class GeneratedOutputReviewService {
    async review({
        request,
        requester,
    }: {
        request: GeneratedOutputReviewRequest
        requester: AssetRequesterContext
    }): Promise<GeneratedOutputReviewResponse | { error: string }> {
        if (!requester.editableWorkspaceIds.includes(request.workspaceId)) return { error: 'PERMISSION_DENIED' }
        if (request.action === 'supersede'
            && request.scope === 'media-node'
            && request.preserveLineage !== true) {
            return { error: 'MEDIA_NODE_PROMPT_REGENERATION_NOT_SUPPORTED' }
        }

        const workspace = await Workspace.getWorkspace({
            workspaceId: request.workspaceId,
            userId: requester.userId,
        })
        if ('error' in workspace) return workspace
        if (workspace.deletingAt) return { error: 'WORKSPACE_DELETING' }

        const prepared = detachReviewedGeneratedOutputsFromCanvas({
            canvasState: workspace.canvasState,
            scope: request.scope,
            nodeId: request.nodeId,
        })
        if (prepared.affectedNodes.length === 0) return { error: 'GENERATED_OUTPUT_NOT_FOUND' }

        const assets: Asset[] = []
        for (const node of prepared.affectedNodes) {
            const asset = await AssetModel.get({ assetId: node.assetId, requester })
            if ('error' in asset) return asset
            if (asset.organizationId !== workspace.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
            if (request.action === 'accept' && asset.generatedOutputReview?.status === 'accepted') {
                assets.push(asset)
                continue
            }
            if (asset.media?.renditions.original?.status !== 'ready') return { error: 'GENERATED_OUTPUT_NOT_READY' }
            if (!asset.documents.provenance || asset.states.provenance !== 'sealed') {
                return { error: 'GENERATED_OUTPUT_PROVENANCE_NOT_READY' }
            }
            assets.push(asset)
        }

        const reviewedAssets: Asset[] = []
        for (const asset of assets) {
            const reviewed = await AssetModel.updateGeneratedOutputReview({
                assetId: asset.assetId,
                requester,
                status: request.action === 'accept' ? 'accepted' : 'superseded',
                ...(request.action === 'supersede' ? {
                    regenerationMode: request.preserveLineage ? 'existing-prompt' : 'regenerate-prompt',
                } : {}),
            })
            if ('error' in reviewed) return reviewed
            reviewedAssets.push(reviewed)
        }

        if (request.action === 'supersede') {
            const preservedLineageNodeIds = request.preserveLineage
                ? new Set(request.scope === 'branch-lineage'
                    ? [request.nodeId]
                    : prepared.affectedNodes.flatMap(node => node.generatedBy?.lineageParentNodeId ?? []))
                : new Set<string>()
            const removedNodeIds = new Set<string>()
            const removedEdgeIds = new Set<string>()
            for (const node of prepared.affectedNodes) {
                let detached = false
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    const currentWorkspace = await Workspace.getWorkspace({
                        workspaceId: request.workspaceId,
                        userId: requester.userId,
                    })
                    if ('error' in currentWorkspace) return currentWorkspace
                    const removal = removeGeneratedOutputCandidateFromCanvas({
                        canvasState: currentWorkspace.canvasState,
                        nodeId: node.nodeId,
                        preserveLineageNodeIds: preservedLineageNodeIds,
                    })
                    const expectedCanvasStateUpdatedAt = currentWorkspace.canvasStateUpdatedAt ?? currentWorkspace.updatedAt
                    const result = await AssetModel.detachWorkspaceReference({
                        assetId: node.assetId,
                        workspaceId: request.workspaceId,
                        requester,
                        nodeId: node.nodeId,
                        workspaceMutation: {
                            expectedCanvasStateUpdatedAt,
                            canvasStateUpdatedAt: Math.max(Date.now(), expectedCanvasStateUpdatedAt + 1),
                            canvasState: removal.canvasState,
                        },
                    })
                    if ('error' in result) {
                        if (result.error === 'STALE_CANVAS_STATE') continue
                        return result
                    }
                    removal.removedNodeIds.forEach(id => removedNodeIds.add(id))
                    removal.removedEdgeIds.forEach(id => removedEdgeIds.add(id))
                    detached = true
                    break
                }
                if (!detached) return { error: 'STALE_CANVAS_STATE' }
            }
            const finalWorkspace = await Workspace.getWorkspace({
                workspaceId: request.workspaceId,
                userId: requester.userId,
            })
            if ('error' in finalWorkspace) return finalWorkspace
            const canvasGeometry: CanvasGeometryUpdate = {
                generationRequestId: prepared.affectedNodes[0]?.generatedBy?.generationRequestId,
                layoutRevision: finalWorkspace.canvasStateUpdatedAt ?? finalWorkspace.updatedAt,
                nodes: finalWorkspace.canvasState.nodes.map(node => ({
                    nodeId: node.nodeId,
                    position: node.position,
                    dimensions: node.dimensions,
                    ...(node.parentId ? { parentNodeId: node.parentId } : {}),
                })),
                nodeSnapshots: finalWorkspace.canvasState.nodes,
                edgeSnapshots: finalWorkspace.canvasState.edges,
                removedNodeIds: [...removedNodeIds],
                removedEdgeIds: [...removedEdgeIds],
            }
            return {
                success: true,
                workspaceId: request.workspaceId,
                affectedAssetIds: reviewedAssets.map(asset => asset.assetId),
                acceptedAssetIds: [],
                supersededAssetIds: reviewedAssets.map(asset => asset.assetId),
                canvasGeometry,
            }
        }

        let mutation = prepared
        const persisted = await Workspace.mutateCanvasState({
            workspaceId: request.workspaceId,
            origin: 'acceptGeneratedOutput',
            mutate: (canvasState) => {
                mutation = detachReviewedGeneratedOutputsFromCanvas({
                    canvasState,
                    scope: request.scope,
                    nodeId: request.nodeId,
                })
                return {
                    canvasState: mutation.canvasState,
                    changed: mutation.affectedNodes.length > 0,
                }
            },
        })
        if (!persisted.canvasState || persisted.canvasStateUpdatedAt === null) return { error: 'WORKSPACE_NOT_FOUND' }

        const geometryNodeIds = new Set(mutation.geometryNodes.map(node => node.nodeId))
        const affectedNodeIds = new Set(mutation.affectedNodes.map(node => node.nodeId))
        const nodeSnapshots = persisted.canvasState.nodes.filter((node) =>
            geometryNodeIds.has(node.nodeId) || affectedNodeIds.has(node.nodeId)
        )
        const snapshotNodeIds = new Set(nodeSnapshots.map(node => node.nodeId))
        const canvasGeometry: CanvasGeometryUpdate = {
            generationRequestId: mutation.affectedNodes[0]?.generatedBy?.generationRequestId,
            layoutRevision: persisted.canvasStateUpdatedAt,
            nodes: mutation.geometryNodes,
            nodeSnapshots,
            edgeSnapshots: persisted.canvasState.edges.filter((edge) =>
                snapshotNodeIds.has(edge.sourceNodeId) || snapshotNodeIds.has(edge.targetNodeId)
            ),
            removedNodeIds: mutation.removedNodeIds,
            removedEdgeIds: mutation.removedEdgeIds,
        }
        return {
            success: true,
            workspaceId: request.workspaceId,
            affectedAssetIds: reviewedAssets.map(asset => asset.assetId),
            acceptedAssetIds: reviewedAssets.map(asset => asset.assetId),
            supersededAssetIds: [],
            canvasGeometry,
        }
    }
}

export default GeneratedOutputReviewService
