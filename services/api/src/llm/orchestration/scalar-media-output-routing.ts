'use strict'

// Compatibility export for older imports. Prompt text is intentionally never
// interpreted as media-mode state.
export const hasExplicitVideoOutputRequest = (_prompt: string): boolean => false

// Kept as a compatibility export for older callers. Media selection is now
// authoritative request state from the UI and prompt text does not alter it.
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
    void prompt
    void hasVideoSource
    return request
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

    void prompt
    void hasVideoSource
    return { imageModelId }
}
