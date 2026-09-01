import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    createProseMirrorSchema,
    DOCUMENT_TYPE,
} from './schema-builder.ts'
import {
    aiGeneratedImageNodeSpec,
    aiGeneratedVideoNodeSpec,
    aiLineageEventNodeSpec,
    aiMediaGenerationProgressNodeSpec,
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    aiResponseMessageNodeSpec,
    aiUserMessageNodeSpec,
    normalizeReferenceNodeIds,
} from './node-specs.ts'

function fakeDom(attrs: Record<string, string | null>, querySelector?: (selector: string) => Record<string, any> | null): HTMLElement {
    return {
        getAttribute: (name: string): string | null => attrs[name] ?? null,
        querySelector: querySelector ?? (() => null),
    } as unknown as HTMLElement
}

describe('normalizeReferenceNodeIds', () => {
    it('deduplicates, trims and drops empty reference ids', () => {
        expect(normalizeReferenceNodeIds(['a', '  ', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c'])
    })

    it('falls back to comma-splitting for malformed JSON', () => {
        expect(normalizeReferenceNodeIds('a, b, a, c')).toEqual(['a', 'b', 'c'])
    })
})

describe('aiPromptInputNodeSpec', () => {
    it('normalizes list attrs and config groups on serialization regardless of multi-model flags', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const promptNode = schema.nodes.aiPromptInput.create({
            aiReasoningModels: '["gpt-4","gpt-4","",""]',
            aiImageModels: '["img","img",""]',
            aiVideoModels: '["video"]',
            useMultipleImageModels: false,
            useMultipleVideoModels: true,
            reasoningGenerationConfigGroups: '[{"groupId":"effort","modelIds":["gpt-4"],"values":{"reasoningEffort":"high"}}]',
            imageGenerationConfigGroups: '[{"groupId":"size","modelIds":["model"],"values":{"size":"large"}}]',
            videoGenerationConfigGroups: '[{"groupId":"fps","modelIds":["v"],"values":{"fps":"60"}}]',
            imageGenerationSize: '1024x1024',
            videoAspectRatio: '16:9',
            videoDuration: '30',
            videoResolution: '1080p',
        }, schema.nodes.paragraph.create(null, schema.text('prompt')))
        const dom = aiPromptInputNodeSpec.toDOM(promptNode as any)[1] as Record<string, string>

        expect(dom['data-ai-reasoning-models']).toBe('["gpt-4"]')
        expect(dom['data-ai-image-models']).toBe('["img"]')
        expect(dom['data-ai-video-models']).toBe('["video"]')
        expect(dom['data-reasoning-generation-config-groups']).toBe('[{"groupId":"effort","modelIds":["gpt-4"],"values":{"reasoningEffort":"high"}}]')
        expect(dom['data-image-generation-config-groups']).toBe('[{"groupId":"size","modelIds":["model"],"values":{"size":"large"}}]')
        expect(dom['data-video-generation-config-groups']).toBe('[{"groupId":"fps","modelIds":["v"],"values":{"fps":"60"}}]')
    })

    it('normalizes parseDOM booleans independently of config groups', () => {
        const parseRule = aiPromptInputNodeSpec.parseDOM![0]
        const node = parseRule.getAttrs!(fakeDom({
            'data-ai-reasoning-models': '["r1", "r1", ""]',
            'data-use-multiple-reasoning-models': 'true',
            'data-use-multiple-image-models': 'false',
            'data-use-multiple-video-models': 'true',
            'data-ai-image-models': '["img", "", "img"]',
            'data-ai-video-models': '["video"]',
            'data-reasoning-generation-config-groups': '[{"groupId":"effort","modelIds":["r1"]}]',
            'data-video-resolution': '720p',
            'data-image-generation-size': 'auto',
            'data-image-generation-config-groups': '[{"groupId":"size","modelIds":["x","y"]}]',
            'data-video-generation-config-groups': '[{"groupId":"fps","modelIds":["v1"]}]',
        }))

        expect(node).toMatchObject({
            aiReasoningModels: '["r1"]',
            useMultipleReasoningModels: true,
            useMultipleImageModels: false,
            useMultipleVideoModels: true,
            aiImageModels: '["img"]',
            aiVideoModels: '["video"]',
            reasoningGenerationConfigGroups: '[{"groupId":"effort","modelIds":["r1"],"values":{}}]',
            imageGenerationConfigGroups: '[{"groupId":"size","modelIds":["x","y"],"values":{}}]',
            videoGenerationConfigGroups: '[{"groupId":"fps","modelIds":["v1"],"values":{}}]',
        })
    })

    it('drops config groups that have no model ids or an empty group id', () => {
        const parseRule = aiPromptInputNodeSpec.parseDOM![0]
        const node = parseRule.getAttrs!(fakeDom({
            'data-image-generation-config-groups': '[{"groupId":"size","modelIds":[]},{"groupId":"","modelIds":["x"]},{"groupId":"quality","modelIds":["a","a"," "]}]',
        })) as Record<string, any>

        expect(node.imageGenerationConfigGroups).toBe('[{"groupId":"quality","modelIds":["a"],"values":{}}]')
    })
})

describe('aiUserMessageNodeSpec', () => {
    it('serializes deduplicated reference ids and defaults in parse', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const userNode = schema.nodes.aiUserMessage.create({
            id: 'msg-1',
            createdAt: 1690000000,
            referenceNodeIds: ['a', 'a', 'b', '  ', ''],
        })
        const dom = aiUserMessageNodeSpec.toDOM(userNode as any)[1] as Record<string, string>

        expect(dom['data-reference-node-ids']).toBe('["a","b"]')

        const parseRule = aiUserMessageNodeSpec.parseDOM![0]
        const parsed = parseRule.getAttrs!(fakeDom({
            'data-id': 'msg-1',
            'data-created-at': '42',
            'data-reference-node-ids': '["a","a","","b"," "]',
        })) as Record<string, any>

        expect(parsed).toEqual({
            id: 'msg-1',
            createdAt: 42,
            referenceNodeIds: ['a', 'b'],
        })
    })
})

describe('aiGeneratedImageNodeSpec', () => {
    it('round-trips image nodes while handling null and number variant indexes', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const source = schema.nodes.aiGeneratedImage.create({
            imageData: 'data:image/png;base64,abc',
            variantIndex: 3,
            branchLineNodeId: '',
            isPartial: true,
        })
        const dom = aiGeneratedImageNodeSpec.toDOM(source as any)[1] as Record<string, string>

        expect(dom['data-variant-index']).toBe('3')
        expect(dom['data-is-partial']).toBe('true')
        expect(dom['data-image-data']).toBe('data:image/png;base64,abc')

        const parseRule = aiGeneratedImageNodeSpec.parseDOM![0]
        const parsed = parseRule.getAttrs!(fakeDom({
            'data-variant-index': 'not-a-number',
            'data-image-data': 'legacy',
            'data-is-partial': 'true',
            'data-width': '123px',
        }))

        expect(parsed).toMatchObject({
            variantIndex: null,
            imageData: 'legacy',
            isPartial: true,
            width: '123px',
        })
    })
})

describe('aiGeneratedVideoNodeSpec', () => {
    it('round-trips video media fields and boolean flags', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const videoNode = schema.nodes.aiGeneratedVideo.create({
            videoUrl: 'https://example.com/video.mp4',
            isPending: false,
            hasAudio: false,
            variantIndex: 0,
            durationSeconds: 42,
            aspectRatio: 1.333,
            mediaType: 'video/mp4',
            generationRequestId: 'run-1',
            reasoningRunId: 'reasoning',
        })
        const dom = aiGeneratedVideoNodeSpec.toDOM(videoNode as any)[1] as Record<string, string>

        expect(dom['data-is-pending']).toBe('false')
        expect(dom['data-has-audio']).toBe('false')
        expect(dom['data-duration-seconds']).toBe('42')
        expect(dom['data-variant-index']).toBe('0')

        const parseRule = aiGeneratedVideoNodeSpec.parseDOM![0]
        const parsed = parseRule.getAttrs!(fakeDom({
            'data-video-url': 'https://example.com/video.mp4',
            'data-is-pending': 'false',
            'data-has-audio': 'false',
            'data-duration-seconds': '99',
            'data-variant-index': 'bad',
        }))

        expect(parsed).toMatchObject({
            videoUrl: 'https://example.com/video.mp4',
            isPending: false,
            hasAudio: false,
            durationSeconds: 99,
            variantIndex: null,
        })
    })
})

describe('aiLineageEventNodeSpec', () => {
    it('normalizes kind in parse and toDOM', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const parseRule = aiLineageEventNodeSpec.parseDOM![0]
        const parsed = parseRule.getAttrs!(fakeDom({
            'data-lineage-event-kind': 'branch-line',
            'data-branch-origin-node-id': 'origin',
            'data-branch-fork-node-id': 'fork',
            'data-branch-line-node-id': 'line',
            'data-reasoning-model-id': 'gpt',
        }))

        expect(parsed).toEqual({
            kind: 'branch-line',
            branchOriginNodeId: 'origin',
            branchForkNodeId: 'fork',
            branchLineNodeId: 'line',
            reasoningModelId: 'gpt',
        })

        const node = schema.nodes.aiLineageEvent.create({
            kind: 'unknown' as never,
            branchOriginNodeId: 'o',
            branchForkNodeId: 'f',
        })
        const dom = aiLineageEventNodeSpec.toDOM(node as any)[1] as Record<string, string>

        expect(dom.class).toBe('ai-lineage-event ai-lineage-event-branch-fork')
        expect(dom['aria-label']).toBe('Branch fork created')
        expect(dom['data-help-tooltip']).toBe('aria-label')
        expect(dom['data-lineage-event-kind']).toBe('branch-fork')
    })
})

describe('aiMediaGenerationProgressNodeSpec', () => {
    it('keeps the structured progress state in provenance projections', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_PROVENANCE)
        const state = {
            generationRequestId: 'request-1',
            status: 'completed',
            message: 'Done.',
            progress: {
                phase: 'composing',
                completedSteps: 1,
                totalSteps: 1,
                message: 'Done.',
            },
            updatedAt: 1,
        }
        const node = schema.nodes.aiMediaGenerationProgress.create({ id: 'request-1', state })
        const dom = aiMediaGenerationProgressNodeSpec.toDOM(node as any)[1] as Record<string, string>

        expect(node.attrs.state).toEqual(state)
        expect(dom.class).toBe('ai-media-generation-progress')
        expect(dom['data-media-generation-progress-id']).toBe('request-1')
    })
})

describe('aiResponseMessageNodeSpec', () => {
    it('serialize/deserialize generation fields consistently', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const response = schema.nodes.aiResponseMessage.create({
            id: 'resp-1',
            aiProvider: 'provider-1',
            generationRequestId: 'gen-1',
            reasoningModelId: 'reason-1',
        })
        const dom = aiResponseMessageNodeSpec.toDOM(response as any) as any[]
        const attrs = dom[1] as Record<string, string>

        expect(attrs.id).toBe('resp-1')
        expect(attrs['data-generation-request-id']).toBe('gen-1')
        expect(attrs['data-reasoning-model-id']).toBe('reason-1')

        const parseRule = aiResponseMessageNodeSpec.parseDOM![0]
        const parsed = parseRule.getAttrs!(fakeDom({
            id: 'resp-1',
            'data-generation-request-id': 'gen-1',
            'data-reasoning-model-id': 'reason-1',
        }))
        expect(parsed).toMatchObject({
            id: 'resp-1',
            generationRequestId: 'gen-1',
            reasoningModelId: 'reason-1',
        })
    })
})
