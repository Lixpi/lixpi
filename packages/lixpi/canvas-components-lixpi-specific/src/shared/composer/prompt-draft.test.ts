import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    buildAiPromptDraftAttrsFromSubmitData,
    buildAiPromptDraftFromText,
} from './prompt-draft.ts'

function getPromptInputAttrs(draft: any): Record<string, any> {
    return draft.content[0].attrs
}

describe('AI prompt draft model settings', () => {
    it('copies submitted reasoning multi-model settings into an empty thread composer draft', () => {
        const selectedModels = ['Google:gemini-flash-latest', 'Anthropic:sonnet-4-6']
        const attrs = buildAiPromptDraftAttrsFromSubmitData({
            aiReasoningModels: selectedModels,
            useMultipleReasoningModels: true,
            reasoningOptions: {
                configGroups: [{
                    groupId: 'effort',
                    modelIds: selectedModels,
                    values: { reasoningEffort: 'high' },
                }],
            },
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            imageOptions: {
                aiImageModels: ['Google:gemini-3.1-flash-image'],
                imageGenerationSize: 'auto',
            },
            videoOptions: {
                aiVideoModels: ['Video:default'],
                videoAspectRatio: '16:9',
                videoResolution: '720p',
                videoDuration: '8s',
            },
        })
        const draftAttrs = getPromptInputAttrs(buildAiPromptDraftFromText('', attrs))

        expect(JSON.parse(draftAttrs.aiReasoningModels)).toEqual(selectedModels)
        expect(draftAttrs.useMultipleReasoningModels).toBe(true)
        expect(draftAttrs.useMultipleImageModels).toBe(false)
        expect(draftAttrs.useMultipleVideoModels).toBe(false)
        expect(JSON.parse(draftAttrs.aiImageModels)).toEqual(['Google:gemini-3.1-flash-image'])
        expect(JSON.parse(draftAttrs.reasoningGenerationConfigGroups)).toEqual([{
            groupId: 'effort',
            modelIds: selectedModels,
            values: { reasoningEffort: 'high' },
        }])
        expect(draftAttrs.imageGenerationSize).toBe('auto')
        expect(JSON.parse(draftAttrs.aiVideoModels)).toEqual(['Video:default'])
        expect(draftAttrs.videoAspectRatio).toBe('16:9')
        expect(draftAttrs.videoResolution).toBe('720p')
        expect(draftAttrs.videoDuration).toBe('8s')
    })

    it('treats each section multi-model flag independently', () => {
        const selectedModels = ['Anthropic:sonnet-4-6', 'Google:gemini-pro-latest']
        const draftAttrs = getPromptInputAttrs(buildAiPromptDraftFromText(
            '',
            buildAiPromptDraftAttrsFromSubmitData({
                aiReasoningModels: selectedModels,
                useMultipleReasoningModels: 'true',
            }),
        ))

        expect(JSON.parse(draftAttrs.aiReasoningModels)).toEqual(selectedModels)
        expect(draftAttrs.useMultipleReasoningModels).toBe(true)
        expect(draftAttrs.useMultipleImageModels).toBe(false)
        expect(draftAttrs.useMultipleVideoModels).toBe(false)
    })

    it('filters non-string reasoning models before serializing and collapses to the first when multi is disabled', () => {
        const attrs = buildAiPromptDraftAttrsFromSubmitData({
            aiReasoningModels: ['Google:gemini-flash-latest', null, 'Anthropic:sonnet-4-6', undefined] as any,
        })

        expect(JSON.parse(attrs.aiReasoningModels)).toEqual(['Google:gemini-flash-latest'])
    })

    it('interprets "false" string section flags as disabled', () => {
        const attrs = buildAiPromptDraftAttrsFromSubmitData({
            aiReasoningModels: ['Google:gemini-flash-latest'],
            useMultipleReasoningModels: 'false',
        })

        expect(attrs.useMultipleReasoningModels).toBe(false)
        expect(attrs.useMultipleImageModels).toBe(false)
        expect(attrs.useMultipleVideoModels).toBe(false)
    })

    it('does not emit a text paragraph when prompt is only whitespace', () => {
        const draft = buildAiPromptDraftFromText('   \t\n   ')
        const promptInput = draft.content[0] as Record<string, any>

        expect(promptInput.content).toHaveLength(1)
        expect(promptInput.content[0].type).toBe('paragraph')
        expect(promptInput.content[0].content).toBeUndefined()
    })
})
