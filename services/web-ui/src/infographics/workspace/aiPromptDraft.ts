import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

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
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aiVideoModel?: string
        aiVideoModels?: readonly string[] | string
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
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
    const combinedMultiModelFlag = parseBooleanModelMode(data.useMultipleModels)
    const rawUseMultipleReasoningModels = parseBooleanModelMode(data.useMultipleReasoningModels)
    const rawUseMultipleImageModels = parseBooleanModelMode(data.useMultipleImageModels)
    const rawUseMultipleVideoModels = parseBooleanModelMode(data.useMultipleVideoModels)
    const hasSectionModelMode = rawUseMultipleReasoningModels || rawUseMultipleImageModels || rawUseMultipleVideoModels
    const shouldExpandCombinedModelFlag = combinedMultiModelFlag && !hasSectionModelMode
    const useMultipleReasoningModels = rawUseMultipleReasoningModels || shouldExpandCombinedModelFlag
    const useMultipleImageModels = rawUseMultipleImageModels || shouldExpandCombinedModelFlag
    const useMultipleVideoModels = rawUseMultipleVideoModels || shouldExpandCombinedModelFlag
    const reasoningModelSelection = useMultipleReasoningModels
        ? data.aiModels
        : data.aiModel ? [data.aiModel] : []
    const imageModelSelection = useMultipleImageModels
        ? data.imageOptions?.aiImageModels
        : data.imageOptions?.aiImageModel ? [data.imageOptions.aiImageModel] : []
    const videoModelSelection = useMultipleVideoModels
        ? data.videoOptions?.aiVideoModels
        : data.videoOptions?.aiVideoModel ? [data.videoOptions.aiVideoModel] : []
    return {
        aiModel: data.aiModel || '',
        aiModels: serializePromptModelSelection(reasoningModelSelection),
        useMultipleModels: useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels,
        useMultipleReasoningModels,
        useMultipleImageModels,
        useMultipleVideoModels,
        aiImageModel: data.imageOptions?.aiImageModel || '',
        aiImageModels: serializePromptModelSelection(imageModelSelection),
        imageGenerationSize: data.imageOptions?.imageGenerationSize || 'auto',
        imageGenerationConfigGroups: useMultipleImageModels
            ? serializeMediaGenerationConfigSelectionAttr(data.imageOptions?.configGroups ?? [])
            : '',
        aiVideoModel: data.videoOptions?.aiVideoModel || '',
        aiVideoModels: serializePromptModelSelection(videoModelSelection),
        videoAspectRatio: data.videoOptions?.videoAspectRatio || '',
        videoResolution: data.videoOptions?.videoResolution || '',
        videoDuration: data.videoOptions?.videoDuration || '',
        videoGenerationConfigGroups: useMultipleVideoModels
            ? serializeMediaGenerationConfigSelectionAttr(data.videoOptions?.configGroups ?? [])
            : '',
    }
}

export function buildAiPromptDraftFromText(promptText: string, attrs: Record<string, any> = {}): object {
    const text = promptText.trim()
    const paragraph = text
        ? { type: 'paragraph', content: [{ type: 'text', text }] }
        : { type: 'paragraph' }
    const combinedMultiModelFlag = parseBooleanModelMode(attrs.useMultipleModels)
    const rawUseMultipleReasoningModels = parseBooleanModelMode(attrs.useMultipleReasoningModels)
    const rawUseMultipleImageModels = parseBooleanModelMode(attrs.useMultipleImageModels)
    const rawUseMultipleVideoModels = parseBooleanModelMode(attrs.useMultipleVideoModels)
    const hasSectionModelMode = rawUseMultipleReasoningModels || rawUseMultipleImageModels || rawUseMultipleVideoModels
    const shouldExpandCombinedModelFlag = combinedMultiModelFlag && !hasSectionModelMode
    const useMultipleReasoningModels = rawUseMultipleReasoningModels || shouldExpandCombinedModelFlag
    const useMultipleImageModels = rawUseMultipleImageModels || shouldExpandCombinedModelFlag
    const useMultipleVideoModels = rawUseMultipleVideoModels || shouldExpandCombinedModelFlag
    return {
        type: 'doc',
        content: [
            {
                type: 'aiPromptInput',
                attrs: {
                    aiModel: attrs.aiModel || '',
                    aiModels: useMultipleReasoningModels
                        ? attrs.aiModels || ''
                        : serializeAiModelSelectionAttr(attrs.aiModel ? [attrs.aiModel] : []),
                    useMultipleModels: combinedMultiModelFlag || hasSectionModelMode,
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    aiImageModel: attrs.aiImageModel || '',
                    aiImageModels: useMultipleImageModels
                        ? attrs.aiImageModels || ''
                        : serializeAiModelSelectionAttr(attrs.aiImageModel ? [attrs.aiImageModel] : []),
                    imageGenerationSize: attrs.imageGenerationSize || 'auto',
                    imageGenerationConfigGroups: useMultipleImageModels ? attrs.imageGenerationConfigGroups || '' : '',
                    aiVideoModel: attrs.aiVideoModel || '',
                    aiVideoModels: useMultipleVideoModels
                        ? attrs.aiVideoModels || ''
                        : serializeAiModelSelectionAttr(attrs.aiVideoModel ? [attrs.aiVideoModel] : []),
                    videoAspectRatio: attrs.videoAspectRatio || '',
                    videoResolution: attrs.videoResolution || '',
                    videoDuration: attrs.videoDuration || '',
                    videoGenerationConfigGroups: useMultipleVideoModels ? attrs.videoGenerationConfigGroups || '' : '',
                },
                content: [paragraph],
            },
        ],
    }
}
