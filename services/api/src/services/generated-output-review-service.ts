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
    removeOrphanBranchLineageMarkerFromCanvas,
} from './asset-canvas-projection.ts'
import { MediaGenerationRequestService } from './media-generation-request-service.ts'

export class GeneratedOutputReviewService {
    private async removeRejectedOutputReferences({
        asset,
        workspaceId,
        requester,
    }: {
        asset: Asset
        workspaceId: string
        requester: AssetRequesterContext
    }): Promise<{ error: string } | null> {
        const conversationAssetId = asset.lineage?.sourceConversationAssetId
        const mediaRunId = asset.lineage?.mediaRunId ?? asset.lineage?.reasoningRunId
        if (conversationAssetId && mediaRunId) {
            const surfaceResult = await AssetModel.detachWorkspaceReference({
                assetId: asset.assetId,
                workspaceId,
                requester,
                surfaceId: `conversation#${conversationAssetId}#media#${mediaRunId}`,
            })
            if ('error' in surfaceResult) return surfaceResult
        }

        const catalogResult = await AssetModel.detachCatalogReference({
            assetId: asset.assetId,
            requester,
        })
        return 'error' in catalogResult ? catalogResult : null
    }

    async review({
        request,
        requester,
    }: {
        request: GeneratedOutputReviewRequest
        requester: AssetRequesterContext
    }): Promise<GeneratedOutputReviewResponse | { error: string }> {
        if (!requester.editableWorkspaceIds.includes(request.workspaceId)) return { error: 'PERMISSION_DENIED' }
        if (
            request.action === 'supersede'
            && request.scope === 'output-node'
            && request.preserveLineage !== true
        ) {
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
        if (prepared.affectedNodes.length === 0) {
            if (request.action !== 'reject' || request.scope !== 'branch-lineage') {
                return { error: 'GENERATED_OUTPUT_NOT_FOUND' }
            }

            let orphanRemoval = removeOrphanBranchLineageMarkerFromCanvas({
                canvasState: workspace.canvasState,
                nodeId: request.nodeId,
            })
            let markerGainedGeneratedOutputs = false
            const persisted = await Workspace.mutateCanvasState({
                workspaceId: request.workspaceId,
                origin: 'rejectOrphanBranchLineageMarker',
                mutate: (canvasState) => {
                    const currentPrepared = detachReviewedGeneratedOutputsFromCanvas({
                        canvasState,
                        scope: request.scope,
                        nodeId: request.nodeId,
                    })
                    if (currentPrepared.affectedNodes.length > 0) {
                        markerGainedGeneratedOutputs = true
                        return { canvasState, changed: false }
                    }
                    orphanRemoval = removeOrphanBranchLineageMarkerFromCanvas({
                        canvasState,
                        nodeId: request.nodeId,
                    })
                    return {
                        canvasState: orphanRemoval.canvasState,
                        changed: orphanRemoval.removedNodeIds.length > 0,
                    }
                },
            })
            if (markerGainedGeneratedOutputs) return await this.review({ request, requester })
            if (!persisted.canvasState || persisted.canvasStateUpdatedAt === null) return { error: 'WORKSPACE_NOT_FOUND' }
            if (orphanRemoval.removedNodeIds.length === 0) return { error: 'GENERATED_OUTPUT_NOT_FOUND' }

            const canvasGeometry: CanvasGeometryUpdate = {
                generationRequestId: workspace.canvasState.nodes.find((node) =>
                    node.nodeId === request.nodeId
                    && (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
                )?.generationRequestId,
                layoutRevision: persisted.canvasStateUpdatedAt,
                nodes: orphanRemoval.geometryNodes,
                nodeSnapshots: persisted.canvasState.nodes,
                edgeSnapshots: persisted.canvasState.edges,
                removedNodeIds: orphanRemoval.removedNodeIds,
                removedEdgeIds: orphanRemoval.removedEdgeIds,
            }
            return {
                success: true,
                workspaceId: request.workspaceId,
                affectedAssetIds: [],
                acceptedAssetIds: [],
                supersededAssetIds: [],
                rejectedAssetIds: [],
                canvasGeometry,
            }
        }

        const assets: Asset[] = []
        const unfinishedGenerationRequestIds = new Set<string>()
        for (const node of prepared.affectedNodes) {
            const asset = await AssetModel.get({ assetId: node.assetId, requester })
            if ('error' in asset) return asset
            if (asset.organizationId !== workspace.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
            if (request.action === 'accept' && asset.generatedOutputReview?.status === 'accepted') {
                assets.push(asset)
                continue
            }
            const outputReady = asset.artifact
                ? Boolean(asset.documents.capabilityArtifact)
                : asset.media?.renditions.original?.status === 'ready'
            const provenanceReady = Boolean(asset.documents.provenance)
                && asset.states.provenance === 'sealed'
            if (request.action === 'reject') {
                if (!outputReady || !provenanceReady) {
                    const generationRequestId = node.generatedBy?.generationRequestId
                        ?? node.generationProgress?.generationRequestId
                    if (generationRequestId) unfinishedGenerationRequestIds.add(generationRequestId)
                }
            } else {
                if (!outputReady) return { error: 'GENERATED_OUTPUT_NOT_READY' }
                if (!provenanceReady) return { error: 'GENERATED_OUTPUT_PROVENANCE_NOT_READY' }
            }
            assets.push(asset)
        }

        for (const generationRequestId of unfinishedGenerationRequestIds) {
            try {
                await new MediaGenerationRequestService().cancelCurrent({
                    generationRequestId,
                    workspaceId: request.workspaceId,
                    userId: requester.userId,
                })
            } catch (error) {
                const errorCode = error instanceof Error ? error.message : String(error)
                if (errorCode !== 'NOT_FOUND') return { error: errorCode }
            }
        }

        const reviewedAssets: Asset[] = []
        for (const asset of assets) {
            const reviewed = await AssetModel.updateGeneratedOutputReview({
                assetId: asset.assetId,
                requester,
                status: request.action === 'accept' ? 'accepted' : 'superseded',
                ...(request.action === 'supersede'
                    ? {
                        regenerationMode: request.preserveLineage ? 'existing-prompt' : 'regenerate-prompt',
                    }
                    : {}),
            })
            if ('error' in reviewed) return reviewed
            reviewedAssets.push(reviewed)
        }

        if (request.action === 'supersede' || request.action === 'reject') {
            if (request.action === 'reject') {
                for (const asset of reviewedAssets) {
                    const referenceError = await this.removeRejectedOutputReferences({
                        asset,
                        workspaceId: request.workspaceId,
                        requester,
                    })
                    if (referenceError) return referenceError
                }
            }
            const preservedLineageNodeIds = request.action === 'supersede' && request.preserveLineage
                ? new Set(
                    request.scope === 'branch-lineage'
                        ? [request.nodeId]
                        : prepared.affectedNodes.flatMap(node => node.generatedBy?.lineageParentNodeId ?? []),
                )
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
                supersededAssetIds: request.action === 'supersede'
                    ? reviewedAssets.map(asset => asset.assetId)
                    : [],
                rejectedAssetIds: request.action === 'reject'
                    ? reviewedAssets.map(asset => asset.assetId)
                    : [],
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
        const nodeSnapshots = persisted.canvasState.nodes.filter((node) => geometryNodeIds.has(node.nodeId) || affectedNodeIds.has(node.nodeId))
        const snapshotNodeIds = new Set(nodeSnapshots.map(node => node.nodeId))
        const canvasGeometry: CanvasGeometryUpdate = {
            generationRequestId: mutation.affectedNodes[0]?.generatedBy?.generationRequestId,
            layoutRevision: persisted.canvasStateUpdatedAt,
            nodes: mutation.geometryNodes,
            nodeSnapshots,
            edgeSnapshots: persisted.canvasState.edges.filter((edge) => snapshotNodeIds.has(edge.sourceNodeId) || snapshotNodeIds.has(edge.targetNodeId)),
            removedNodeIds: mutation.removedNodeIds,
            removedEdgeIds: mutation.removedEdgeIds,
        }
        return {
            success: true,
            workspaceId: request.workspaceId,
            affectedAssetIds: reviewedAssets.map(asset => asset.assetId),
            acceptedAssetIds: reviewedAssets.map(asset => asset.assetId),
            supersededAssetIds: [],
            rejectedAssetIds: [],
            canvasGeometry,
        }
    }
}

export default GeneratedOutputReviewService
