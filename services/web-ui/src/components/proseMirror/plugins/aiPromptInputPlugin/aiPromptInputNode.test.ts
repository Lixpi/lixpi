'use strict'

import { describe, it, expect } from 'vitest'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import {
    parseAiModelSelectionAttr,
    serializeAiModelSelectionAttr,
    aiPromptInputNodeSpec,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

describe('ai model selection parsing and serialization', () => {
    it('parses string JSON arrays and filters empty entries', () => {
        const parsed = parseAiModelSelectionAttr('["gpt-4o", "claude-3", "gpt-4o", "  ", ""]')

        expect(parsed).toEqual(['gpt-4o', 'claude-3', 'gpt-4o'])
    })

    it('handles invalid JSON model payloads as empty selection', () => {
        expect(parseAiModelSelectionAttr('[]')).toEqual([])
        expect(parseAiModelSelectionAttr('[not-json')).toEqual([])
        expect(parseAiModelSelectionAttr({})).toEqual([])
        expect(parseAiModelSelectionAttr(null)).toEqual([])
    })

    it('serializes unique non-empty model ids and preserves canonical order', () => {
        expect(serializeAiModelSelectionAttr(['gpt-4o', 'claude-3', 'gpt-4o', ''])).toBe('["gpt-4o","claude-3"]')
        expect(serializeAiModelSelectionAttr([])).toBe('')
        expect(serializeAiModelSelectionAttr(['   '])).toBe('')
    })
})

describe('aiPromptInputNodeSpec', () => {
    it('normalizes aiModels and model list attrs through toDOM', () => {
        const promptNode = testSchema.nodes.aiPromptInput.create({
            aiModels: '["gpt-4o", "gpt-4o", "", "claude-3"]',
            aiImageModels: '["image-model", "image-model", ""]',
            aiVideoModels: '["video-model", "video-model", ""]',
            imageGenerationSize: 'auto',
        }, [testSchema.nodes.paragraph.create(null, [testSchema.text('hello')])])

        const domSpec = aiPromptInputNodeSpec.toDOM(promptNode as any) as any[]
        const attrs = domSpec[1]

        expect(attrs['data-ai-models']).toBe('["gpt-4o","claude-3"]')
        expect(attrs['data-ai-image-models']).toBe('["image-model"]')
        expect(attrs['data-ai-video-models']).toBe('["video-model"]')
    })

    it('normalizes model list attrs during parseDom', () => {
        const el = document.createElement('div')
        el.className = 'ai-prompt-input-wrapper'
        el.setAttribute('data-ai-models', '["gpt-4o", "", "claude-3", "claude-3"]')
        el.setAttribute('data-ai-image-models', '["image-model", "", "image-model"]')
        el.setAttribute('data-ai-video-models', '[]')
        el.setAttribute('data-image-generation-size', '1024x1024')
        el.setAttribute('data-use-multiple-models', 'true')

        const parseRule = aiPromptInputNodeSpec.parseDOM![0]
        const attrs = parseRule.getAttrs!(el as any) as Record<string, any>

        expect(attrs.aiModels).toBe('["gpt-4o","claude-3"]')
        expect(attrs.aiImageModels).toBe('["image-model"]')
        expect(attrs.aiVideoModels).toBe('')
        expect(attrs.useMultipleReasoningModels).toBe(true)
        expect(attrs.useMultipleImageModels).toBe(true)
        expect(attrs.useMultipleVideoModels).toBe(true)
    })
})
