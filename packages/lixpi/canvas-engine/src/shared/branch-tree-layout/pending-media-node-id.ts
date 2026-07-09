'use strict'

import type { MediaRunLineageAssignment } from '@lixpi/constants'

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
