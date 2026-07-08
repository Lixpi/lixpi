'use strict'

import type { CanvasNode } from '@lixpi/constants'

export type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>

export function isGeneratedMediaCanvasNode(node: CanvasNode): node is GeneratedMediaCanvasNode {
    return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy)
}

export function isPendingGeneratedMediaCanvasNode(node: CanvasNode): boolean {
    if (!isGeneratedMediaCanvasNode(node)) return false
    if (node.type === 'image') return !node.fileId && !node.src
    return !node.fileId && !node.posterFileId && !node.frameFileId && !node.src && !node.posterSrc
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
