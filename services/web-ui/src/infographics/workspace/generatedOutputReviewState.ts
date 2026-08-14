'use strict'

import type { Asset, CanvasNode, WorkspaceEdge } from '@lixpi/constants'
import {
    hasActiveGeneratedOutputLineage,
    type GeneratedOutputCanvasNode,
} from '@lixpi/canvas-engine'

type GeneratedOutputReviewStateInput = {
    node: GeneratedOutputCanvasNode
    asset: Asset | undefined
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
}

export function isGeneratedOutputAcceptedForCanvas({
    node,
    asset,
    nodes,
    edges,
}: GeneratedOutputReviewStateInput): boolean {
    if (asset?.generatedOutputReview?.status !== 'accepted') return false
    return !hasActiveGeneratedOutputLineage(node, nodes, edges)
}

export function isGeneratedOutputReadyForReview(
    node: GeneratedOutputCanvasNode,
    asset: Asset | undefined,
): boolean {
    const assetIsReady = Boolean(asset && asset.states.provenance === 'sealed' && (node.type === 'capabilityArtifact'
        ? Boolean(asset.documents.capabilityArtifact)
        : asset.media?.renditions.original?.status === 'ready'))
    if (assetIsReady) return true
    if (node.type === 'capabilityArtifact') return false
    return node.mediaGenerationPhase === 'ready'
}

export function isGeneratedOutputRejectableForCanvas(input: GeneratedOutputReviewStateInput): boolean {
    const { node, asset, nodes, edges } = input
    if (!node.generatedBy || isGeneratedOutputAcceptedForCanvas(input)) return false
    const reviewStatus = asset?.generatedOutputReview?.status
    return hasActiveGeneratedOutputLineage(node, nodes, edges)
        || reviewStatus === 'candidate'
        || reviewStatus === 'superseded'
}
