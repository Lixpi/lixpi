'use strict'

import type { CanvasNode } from '@lixpi/constants'

export type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>

export function isGeneratedMediaCanvasNode(node: CanvasNode): node is GeneratedMediaCanvasNode {
    return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy)
}

export function isPendingGeneratedMediaCanvasNode(_node: CanvasNode): boolean {
    // Asset lifecycle is authoritative and is intentionally not duplicated on
    // canvas nodes. Callers that need pending/ready state must resolve node.assetId
    // through the Asset store.
    return false
}

export function isCompletedGeneratedMediaCanvasNode(node: CanvasNode): boolean {
    return isGeneratedMediaCanvasNode(node) && !isPendingGeneratedMediaCanvasNode(node)
}

export function getGeneratedMediaRunIdentity(node: CanvasNode): string {
    if (!isGeneratedMediaCanvasNode(node)) return ''
    const generatedBy = node.generatedBy
    if (!generatedBy) return ''
    if (generatedBy.mediaRunId) return `${node.type}:media-run:${generatedBy.mediaRunId}`
    const requestId = generatedBy.generationRequestId
    if (!requestId) return ''
    return [
        node.type,
        requestId,
        generatedBy.reasoningRunId ?? '',
        generatedBy.mediaModelId ?? '',
        generatedBy.mediaIndex ?? '',
        generatedBy.variantIndex ?? '',
        generatedBy.branchForkNodeId ?? '',
        generatedBy.branchLineNodeId ?? '',
    ].join(':')
}
