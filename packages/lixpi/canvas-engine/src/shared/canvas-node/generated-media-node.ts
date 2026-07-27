'use strict'

import type { CanvasNode } from '@lixpi/constants'

export type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>
export type GeneratedOutputCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' | 'capabilityArtifact' }>

export function isGeneratedOutputCanvasNode(node: CanvasNode): node is GeneratedOutputCanvasNode {
    return (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
        && Boolean(node.generatedBy)
}

export function isGeneratedMediaCanvasNode(node: CanvasNode): node is GeneratedMediaCanvasNode {
    return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy)
}

export function isPendingGeneratedMediaCanvasNode(node: CanvasNode): boolean {
    if (!isGeneratedMediaCanvasNode(node)) return false
    if (node.mediaGenerationPhase) return node.mediaGenerationPhase === 'pending-before-first-frame'

    // Compatibility for transient pre-Asset client snapshots. Revision-2 API
    // snapshots use mediaGenerationPhase; old client snapshots carried media
    // readiness in file/src fields that must still be protected from stale
    // geometry updates while they are in flight.
    const legacyNode = node as CanvasNode & {
        fileId?: string
        src?: string
        posterFileId?: string
        posterSrc?: string
    }
    const hasLegacyReadinessFields = 'fileId' in legacyNode
        || 'src' in legacyNode
        || 'posterFileId' in legacyNode
        || 'posterSrc' in legacyNode
    if (!hasLegacyReadinessFields) return false
    return !legacyNode.fileId?.trim()
        && !legacyNode.src?.trim()
        && !legacyNode.posterFileId?.trim()
        && !legacyNode.posterSrc?.trim()
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

export function getGeneratedOutputRunIdentity(node: CanvasNode): string {
    if (!isGeneratedOutputCanvasNode(node)) return ''
    if (node.type !== 'capabilityArtifact') return getGeneratedMediaRunIdentity(node)
    const generatedBy = node.generatedBy
    if (!generatedBy) return ''
    return [
        node.type,
        generatedBy.generationRequestId,
        generatedBy.reasoningRunId,
        generatedBy.reasoningModelId,
        generatedBy.variantIndex,
        generatedBy.capabilityRunId,
    ].join(':')
}
