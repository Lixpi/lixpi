import {
    type CanvasNode,
} from '@lixpi/constants'

import {
    type CanvasEnginePoint,
    type CanvasEngineRect,
} from '@lixpi/canvas-engine/shared'

export type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>
export type GeneratedOutputCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' | 'capabilityArtifact' }>

export const getGeneratedMediaPreFrameSize = (
    dimensions: {
        width: number
        height: number
    },
    configuredScale: number,
): number => {
    const scale = Number.isFinite(configuredScale)
        && configuredScale > 0
        ? Math.min(1, configuredScale)
        : 1 / 3

    return Math.max(1, Math.min(dimensions.width, dimensions.height) * scale)
}

export const getGeneratedMediaPreFrameRect = (
    position: CanvasEnginePoint,
    dimensions: {
        width: number
        height: number
    },
    configuredScale: number,
): CanvasEngineRect => {
    const size = getGeneratedMediaPreFrameSize(dimensions, configuredScale)

    return {
        x: position.x + (dimensions.width - size) / 2,
        y: position.y + (dimensions.height - size) / 2,
        width: size,
        height: size,
    }
}

export const getGeneratedMediaPreFrameLayoutRect = (
    position: CanvasEnginePoint,
    dimensions: {
        width: number
        height: number
    },
    configuredScale: number,
): CanvasEngineRect => {
    const visualRect = getGeneratedMediaPreFrameRect(
        position,
        dimensions,
        configuredScale,
    )

    return {
        x: position.x,
        y: visualRect.y,
        width: dimensions.width,
        height: visualRect.height,
    }
}

export const isGeneratedOutputCanvasNode = (node: CanvasNode): node is GeneratedOutputCanvasNode => {
    return (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
        && Boolean(node.generatedBy)
}

export const isGeneratedMediaCanvasNode = (node: CanvasNode): node is GeneratedMediaCanvasNode =>
    (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy)

export const isPendingGeneratedMediaCanvasNode = (node: CanvasNode): boolean => {
    if (!isGeneratedMediaCanvasNode(node))
        return false

    if (
        node.generationProgress
        && ['completed', 'failed', 'cancelled'].includes(node.generationProgress.status)
    )
        return false

    if (node.mediaGenerationPhase)
        return node.mediaGenerationPhase === 'pending-before-first-frame'

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

    if (!hasLegacyReadinessFields)
        return false

    return !legacyNode.fileId?.trim()
        && !legacyNode.src?.trim()
        && !legacyNode.posterFileId?.trim()
        && !legacyNode.posterSrc?.trim()
}

export const isCompletedGeneratedMediaCanvasNode = (node: CanvasNode): boolean =>
    isGeneratedMediaCanvasNode(node) && !isPendingGeneratedMediaCanvasNode(node)

export const getGeneratedMediaRunIdentity = (node: CanvasNode): string => {
    if (!isGeneratedMediaCanvasNode(node))
        return ''

    const generatedBy = node.generatedBy

    if (!generatedBy)
        return ''

    if (generatedBy.mediaRunId)
        return `${node.type}:media-run:${generatedBy.mediaRunId}`

    const requestId = generatedBy.generationRequestId

    if (!requestId)
        return ''

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

export const getGeneratedOutputRunIdentity = (node: CanvasNode): string => {
    if (!isGeneratedOutputCanvasNode(node))
        return ''

    if (node.type !== 'capabilityArtifact')
        return getGeneratedMediaRunIdentity(node)

    const generatedBy = node.generatedBy

    if (!generatedBy)
        return ''

    return [
        node.type,
        generatedBy.generationRequestId,
        generatedBy.reasoningRunId,
        generatedBy.reasoningModelId,
        generatedBy.variantIndex,
        generatedBy.capabilityRunId,
    ].join(':')
}
