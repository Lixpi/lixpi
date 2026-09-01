import {
    type MediaRunLineageAssignment,
} from '@lixpi/constants'

type PendingMediaNodeIdAssignment = Pick<
    MediaRunLineageAssignment,
    'generationRequestId' | 'reasoningRunId' | 'mediaRunId' | 'mediaType' | 'mediaIndex' | 'reasoningIndex' | 'mediaModelId'
>

function normalizePendingMediaNodeIdPart(value: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    return normalized || 'unknown'
}

export function getPendingGeneratedMediaNodeId(assignment: PendingMediaNodeIdAssignment): string {
    const mediaType = assignment.mediaType === 'video' ? 'video' : 'image'
    const runIdentity = assignment.mediaRunId
        || [
            assignment.generationRequestId,
            assignment.reasoningRunId,
            assignment.mediaModelId,
            assignment.reasoningIndex ?? 0,
            mediaType,
            assignment.mediaIndex ?? 0,
        ].filter((part): part is string | number => part !== undefined && part !== null && part !== '')
            .join(':')
    return `pending-${mediaType}-${normalizePendingMediaNodeIdPart(String(runIdentity))}`
}

// The operation-status card and the pending media placeholder are two distinct
// nodes for the same run. They must never share a nodeId: a collision makes the
// two projections overwrite each other's node type, which strands the node on
// the canvas forever because neither settlement path recognizes it any more.
export function getMediaGenerationOperationNodeId(assignment: PendingMediaNodeIdAssignment): string {
    return `operation-${getPendingGeneratedMediaNodeId(assignment)}`
}
