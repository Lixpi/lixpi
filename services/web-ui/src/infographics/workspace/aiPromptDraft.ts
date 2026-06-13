import { serializeAiModelSelectionAttr } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

export type AiPromptSubmitModelData = {
    aiModel?: string
    aiModels?: readonly string[] | string
    useMultipleModels?: boolean | string
    useMultipleReasoningModels?: boolean | string
    useMultipleImageModels?: boolean | string
    useMultipleVideoModels?: boolean | string
    imageOptions?: {
        aiImageModel?: string
        aiImageModels?: readonly string[] | string
        imageGenerationSize?: string
    }
    videoOptions?: {
        aiVideoModel?: string
        aiVideoModels?: readonly string[] | string
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
    }
}

function parseBooleanModelMode(value: unknown): boolean {
    return value === true || value === 'true'
}

function serializePromptModelSelection(value: unknown): string {
    if (Array.isArray(value)) {
        return serializeAiModelSelectionAttr(value.filter((entry): entry is string => typeof entry === 'string'))
    }
    return typeof value === 'string' ? value : ''
}

export function buildAiPromptDraftAttrsFromSubmitData(data: AiPromptSubmitModelData): Record<string, any> {
    const legacyUseMultipleModels = parseBooleanModelMode(data.useMultipleModels)
    const rawUseMultipleReasoningModels = parseBooleanModelMode(data.useMultipleReasoningModels)
    const rawUseMultipleImageModels = parseBooleanModelMode(data.useMultipleImageModels)
    const rawUseMultipleVideoModels = parseBooleanModelMode(data.useMultipleVideoModels)
    const hasSectionModelMode = rawUseMultipleReasoningModels || rawUseMultipleImageModels || rawUseMultipleVideoModels
    const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModelMode
    const useMultipleReasoningModels = rawUseMultipleReasoningModels || useLegacyModeFallback
    const useMultipleImageModels = rawUseMultipleImageModels || useLegacyModeFallback
    const useMultipleVideoModels = rawUseMultipleVideoModels || useLegacyModeFallback
    return {
        aiModel: data.aiModel || '',
        aiModels: serializePromptModelSelection(data.aiModels),
        useMultipleModels: useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels,
        useMultipleReasoningModels,
        useMultipleImageModels,
        useMultipleVideoModels,
        aiImageModel: data.imageOptions?.aiImageModel || '',
        aiImageModels: serializePromptModelSelection(data.imageOptions?.aiImageModels),
        imageGenerationSize: data.imageOptions?.imageGenerationSize || 'auto',
        aiVideoModel: data.videoOptions?.aiVideoModel || '',
        aiVideoModels: serializePromptModelSelection(data.videoOptions?.aiVideoModels),
        videoAspectRatio: data.videoOptions?.videoAspectRatio || '',
        videoResolution: data.videoOptions?.videoResolution || '',
        videoDuration: data.videoOptions?.videoDuration || '',
    }
}

export function buildAiPromptDraftFromText(promptText: string, attrs: Record<string, any> = {}): object {
    const text = promptText.trim()
    const paragraph = text
        ? { type: 'paragraph', content: [{ type: 'text', text }] }
        : { type: 'paragraph' }
    const legacyUseMultipleModels = parseBooleanModelMode(attrs.useMultipleModels)
    const rawUseMultipleReasoningModels = parseBooleanModelMode(attrs.useMultipleReasoningModels)
    const rawUseMultipleImageModels = parseBooleanModelMode(attrs.useMultipleImageModels)
    const rawUseMultipleVideoModels = parseBooleanModelMode(attrs.useMultipleVideoModels)
    const hasSectionModelMode = rawUseMultipleReasoningModels || rawUseMultipleImageModels || rawUseMultipleVideoModels
    const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModelMode
    return {
        type: 'doc',
        content: [
            {
                type: 'aiPromptInput',
                attrs: {
                    aiModel: attrs.aiModel || '',
                    aiModels: attrs.aiModels || '',
                    useMultipleModels: legacyUseMultipleModels || hasSectionModelMode,
                    useMultipleReasoningModels: rawUseMultipleReasoningModels || useLegacyModeFallback,
                    useMultipleImageModels: rawUseMultipleImageModels || useLegacyModeFallback,
                    useMultipleVideoModels: rawUseMultipleVideoModels || useLegacyModeFallback,
                    aiImageModel: attrs.aiImageModel || '',
                    aiImageModels: attrs.aiImageModels || '',
                    imageGenerationSize: attrs.imageGenerationSize || 'auto',
                    aiVideoModel: attrs.aiVideoModel || '',
                    aiVideoModels: attrs.aiVideoModels || '',
                    videoAspectRatio: attrs.videoAspectRatio || '',
                    videoResolution: attrs.videoResolution || '',
                    videoDuration: attrs.videoDuration || '',
                },
                content: [paragraph],
            },
        ],
    }
}
