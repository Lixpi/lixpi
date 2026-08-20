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

// Matrix counterpart of the scalar rule below: a prompt that explicitly asks for
// moving media gets moving media only. The model picker keeps an image model
// selected across turns, so without this a "generate a video" turn fans out an
// extra image run the user never asked for and pays for.
export const restrictMediaRequestToExplicitVideoOutput = <T extends {
    imageModelIds?: string[]
    useMultipleImageModels?: boolean
    videoModelIds?: string[]
    outputMediaTypes?: Array<'image' | 'video'>
}>({
    request,
    prompt,
    hasVideoSource,
}: {
    request: T
    prompt: string
    hasVideoSource: boolean
}): T => {
    if (!(request.imageModelIds?.length && request.videoModelIds?.length)) return request
    if (!hasVideoSource && !hasExplicitVideoOutputRequest(prompt)) return request
    return {
        ...request,
        imageModelIds: [],
        useMultipleImageModels: false,
        ...(request.outputMediaTypes ? {
            outputMediaTypes: request.outputMediaTypes.filter(mediaType => mediaType !== 'image'),
        } : {}),
    }
}

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
