'use strict'

const EXPLICIT_VIDEO_CREATION_PATTERN =
    /\b(?:generate|create|make|produce|render)\s+(?:an?\s+|the\s+)?(?:(?:short|cinematic|animated)\s+)*(?:video|clip|animation)\b/iu
const EXPLICIT_VIDEO_TRANSFORM_PATTERN =
    /\b(?:turn|convert|transform)\b[^.!?\n]{0,120}\binto\s+(?:an?\s+)?(?:(?:short|cinematic|animated)\s+)*(?:video|clip|animation)\b/iu
const EXPLICIT_VIDEO_CONTINUATION_PATTERN =
    /\b(?:extend|continue)\b[^.!?\n]{0,80}\b(?:video|clip)\b/iu
const EXPLICIT_ANIMATION_VERB_PATTERN = /\banimate\b/iu
const EXPLICIT_FILM_VERB_PATTERN = /\bfilm\s+(?:this|that|the|an?|my|our|these|those)\b/iu

export const hasExplicitVideoOutputRequest = (prompt: string): boolean => (
    EXPLICIT_VIDEO_CREATION_PATTERN.test(prompt)
    || EXPLICIT_VIDEO_TRANSFORM_PATTERN.test(prompt)
    || EXPLICIT_VIDEO_CONTINUATION_PATTERN.test(prompt)
    || EXPLICIT_ANIMATION_VERB_PATTERN.test(prompt)
    || EXPLICIT_FILM_VERB_PATTERN.test(prompt)
)

export type ScalarMediaModelSelection = {
    imageModelId?: string
    videoModelId?: string
}

export const resolveScalarMediaModelSelection = ({
    prompt,
    imageModelId,
    videoModelId,
    hasVideoSource,
}: {
    prompt: string
    imageModelId?: string
    videoModelId?: string
    hasVideoSource: boolean
}): ScalarMediaModelSelection => {
    if (!imageModelId || !videoModelId) {
        return {
            ...(imageModelId ? { imageModelId } : {}),
            ...(videoModelId ? { videoModelId } : {}),
        }
    }

    if (hasVideoSource || hasExplicitVideoOutputRequest(prompt)) {
        return { videoModelId }
    }

    return { imageModelId }
}
