import { describe, expect, it } from 'vitest'
import {
    buildAiPromptDraftAttrsFromSubmitData,
    buildAiPromptDraftFromText,
} from '$src/infographics/workspace/aiPromptDraft.ts'

function getPromptInputAttrs(draft: any): Record<string, any> {
    return draft.content[0].attrs
}

describe('AI prompt draft model settings', () => {
    it('copies submitted reasoning multi-model settings into an empty thread composer draft', () => {
        const selectedModels = ['Google:gemini-flash-latest', 'Anthropic:sonnet-4-6']
        const attrs = buildAiPromptDraftAttrsFromSubmitData({
            aiModel: selectedModels[0],
            aiModels: selectedModels,
            useMultipleModels: true,
            useMultipleReasoningModels: true,
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            imageOptions: {
                aiImageModel: 'Google:gemini-2.5-flash-image',
                imageGenerationSize: 'auto',
            },
            videoOptions: {
                aiVideoModel: 'Video:default',
                videoAspectRatio: '16:9',
                videoResolution: '720p',
                videoDuration: '8s',
            },
        })
        const draftAttrs = getPromptInputAttrs(buildAiPromptDraftFromText('', attrs))

        expect(draftAttrs.aiModel).toBe(selectedModels[0])
        expect(JSON.parse(draftAttrs.aiModels)).toEqual(selectedModels)
        expect(draftAttrs.useMultipleModels).toBe(true)
        expect(draftAttrs.useMultipleReasoningModels).toBe(true)
        expect(draftAttrs.useMultipleImageModels).toBe(false)
        expect(draftAttrs.useMultipleVideoModels).toBe(false)
        expect(draftAttrs.aiImageModel).toBe('Google:gemini-2.5-flash-image')
        expect(draftAttrs.imageGenerationSize).toBe('auto')
        expect(draftAttrs.aiVideoModel).toBe('Video:default')
        expect(draftAttrs.videoAspectRatio).toBe('16:9')
        expect(draftAttrs.videoResolution).toBe('720p')
        expect(draftAttrs.videoDuration).toBe('8s')
    })

    it('keeps legacy multi-model submissions compatible when section flags are absent', () => {
        const selectedModels = ['Anthropic:sonnet-4-6', 'Google:gemini-pro-latest']
        const draftAttrs = getPromptInputAttrs(buildAiPromptDraftFromText('', buildAiPromptDraftAttrsFromSubmitData({
            aiModel: selectedModels[0],
            aiModels: selectedModels,
            useMultipleModels: 'true',
        })))

        expect(JSON.parse(draftAttrs.aiModels)).toEqual(selectedModels)
        expect(draftAttrs.useMultipleModels).toBe(true)
        expect(draftAttrs.useMultipleReasoningModels).toBe(true)
        expect(draftAttrs.useMultipleImageModels).toBe(true)
        expect(draftAttrs.useMultipleVideoModels).toBe(true)
    })
}
