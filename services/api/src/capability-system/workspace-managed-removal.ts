import {
    type Asset,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    isGeneratedOutputCanvasNode,
    isGeneratedOutputRejectableForCanvas,
} from '@lixpi/canvas-components/workspace/shared'
import {
    detachReviewedGeneratedOutputsFromCanvas,
    removeGeneratedOutputCandidateFromCanvas,
    removeOrphanBranchLineageMarkerFromCanvas,
} from '../services/asset-canvas-projection.ts'
import { changedCanvasTargets } from '../services/canvas-collaboration-input.ts'

export type ManagedCanvasRemoval =
    | {
        targets: string[]
        scope: 'output-node' | 'branch-lineage'
    }
    | {
        targets: string[]
        generationRequestId: string
        requestRevision?: number
    }

const requestIdOf = (node: CanvasNode): string | undefined => {
    if ('generationRequestId' in node)
        return node.generationRequestId

    if (
        node.type === 'image'
        || node.type === 'video'
    )
        return node.generationProgress?.generationRequestId ?? node.generatedBy?.generationRequestId

    if (node.type === 'capabilityArtifact')
        return node.generatedBy?.generationRequestId

    return undefined
}

const generationTargets = (
    state: CanvasState,
    requestId: string,
): string[] => {
    const nodes = state.nodes.filter(node => requestIdOf(node) === requestId)
    const ids = new Set(
        nodes.map(node => node.nodeId),
    )

    return [
        ...nodes.flatMap(
            node => [
                `node:${node.nodeId}`,
                ...('assetId' in node
                    && node.assetId
                    ? [`asset:${node.assetId}`]
                    : []),
            ],
        ),
        ...state.edges.filter(edge => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId)).map(edge => `edge:${edge.edgeId}`),
    ]
}

const reviewPlan = (
    state: CanvasState,
    nodeId: string,
    scope: 'output-node' | 'branch-lineage',
): ManagedCanvasRemoval => {
    const prepared = detachReviewedGeneratedOutputsFromCanvas({
        canvasState: state,
        nodeId,
        scope,
    })
    const changed = prepared.affectedNodes.length
        ? prepared.affectedNodes.reduce(
            (canvasState, node) => removeGeneratedOutputCandidateFromCanvas({
                canvasState,
                nodeId: node.nodeId,
            }).canvasState,
            state,
        )
        : removeOrphanBranchLineageMarkerFromCanvas({
            canvasState: state,
            nodeId,
        }).canvasState
    const requestIds = new Set(
        prepared.affectedNodes.flatMap(node => {
            const requestId = requestIdOf(node)

            return requestId ? [requestId] : []
        }),
    )

    return {
        scope,
        targets: [
            ...changedCanvasTargets(state, changed),
            ...prepared.affectedNodes.map(node => `asset:${node.assetId}`),
            ...[...requestIds].flatMap(requestId => generationTargets(state, requestId)),
        ],
    }
}

export const planManagedCanvasRemoval = (
    state: CanvasState,
    node: CanvasNode,
    asset: Asset | undefined,
): ManagedCanvasRemoval | undefined => {
    if (
        node.type === 'branchOrigin'
        || node.type === 'branchFork'
        || node.type === 'branchLine'
    )
        return reviewPlan(
            state,
            node.nodeId,
            'branch-lineage',
        )

    if (
        isGeneratedOutputCanvasNode(node)
        && isGeneratedOutputRejectableForCanvas({
            ...state,
            node,
            asset,
        })
    )
        return reviewPlan(
            state,
            node.nodeId,
            'output-node',
        )

    if (
        node.type === 'operationStatus'
        && node.operation === 'media-generation'
        && node.generationRequestId
        && node.requestRevision !== undefined
    )
        return {
            targets: generationTargets(state, node.generationRequestId),
            generationRequestId: node.generationRequestId,
            requestRevision: node.requestRevision,
        }

    if (
        node.type !== 'image'
        && node.type !== 'video'
    )
        return undefined

    const generationRequestId = requestIdOf(node)

    if (
        !generationRequestId
        || generationRequestId.startsWith('canvas-')
    )
        return undefined

    return {
        targets: generationTargets(state, generationRequestId),
        generationRequestId,
    }
}
