import {
    parseAiModelSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

export type AiPromptSubmitModelData = {
    aiReasoningModels?: readonly string[] | string
    useMultipleReasoningModels?: boolean | string
    useMultipleImageModels?: boolean | string
    useMultipleVideoModels?: boolean | string
    imageOptions?: {
        aiImageModels?: readonly string[] | string
        imageGenerationSize?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
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

// Multi disabled → collapse the section's selection to its first model.
function serializePromptModelSelection(value: unknown, useMultiple: boolean): string {
    const models = parseAiModelSelectionAttr(value)
    return serializeAiModelSelectionAttr(useMultiple ? models : models.slice(0, 1))
}

export function buildAiPromptDraftAttrsFromSubmitData(data: AiPromptSubmitModelData): Record<string, any> {
    const useMultipleReasoningModels = parseBooleanModelMode(data.useMultipleReasoningModels)
    const useMultipleImageModels = parseBooleanModelMode(data.useMultipleImageModels)
    const useMultipleVideoModels = parseBooleanModelMode(data.useMultipleVideoModels)
    return {
        aiReasoningModels: serializePromptModelSelection(data.aiReasoningModels, useMultipleReasoningModels),
        useMultipleReasoningModels,
        useMultipleImageModels,
        useMultipleVideoModels,
        aiImageModels: serializePromptModelSelection(data.imageOptions?.aiImageModels, useMultipleImageModels),
        imageGenerationSize: data.imageOptions?.imageGenerationSize || 'auto',
        imageGenerationConfigGroups: useMultipleImageModels
            ? serializeMediaGenerationConfigSelectionAttr(data.imageOptions?.configGroups ?? [])
            : '',
        aiVideoModels: serializePromptModelSelection(data.videoOptions?.aiVideoModels, useMultipleVideoModels),
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
    const useMultipleReasoningModels = parseBooleanModelMode(attrs.useMultipleReasoningModels)
    const useMultipleImageModels = parseBooleanModelMode(attrs.useMultipleImageModels)
    const useMultipleVideoModels = parseBooleanModelMode(attrs.useMultipleVideoModels)
    return {
        type: 'doc',
        content: [
            {
                type: 'aiPromptInput',
                attrs: {
                    aiReasoningModels: serializePromptModelSelection(attrs.aiReasoningModels, useMultipleReasoningModels),
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    aiImageModels: serializePromptModelSelection(attrs.aiImageModels, useMultipleImageModels),
                    imageGenerationSize: attrs.imageGenerationSize || 'auto',
                    imageGenerationConfigGroups: useMultipleImageModels ? attrs.imageGenerationConfigGroups || '' : '',
                    aiVideoModels: serializePromptModelSelection(attrs.aiVideoModels, useMultipleVideoModels),
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
