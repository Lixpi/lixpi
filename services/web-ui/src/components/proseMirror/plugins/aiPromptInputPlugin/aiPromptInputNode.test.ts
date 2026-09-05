import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    it,
    expect,
} from 'vitest'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import {
    parseAiModelSelectionAttr,
    serializeAiModelSelectionAttr,
    aiPromptInputNodeSpec,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

// These assertions pin down what the source does, not how the formatter lays it out.
// Line breaks and trailing commas are the formatter's choice and change nothing about
// the behavior, so both sides are compared on tokens alone.
const withoutLayout = (value: string): string => value
    .replace(/\s+/g, '')
    .replace(/,(?=[)\]}])/g, '')
    .replace(/,$/, '')

function expectSourceToContain(source: string, snippet: string): void {
    expect(withoutLayout(source).includes(withoutLayout(snippet)), `source should contain: ${snippet}`).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(withoutLayout(source).includes(withoutLayout(snippet)), `source should not contain: ${snippet}`).toBe(false)
}

const aiPromptInputNodeSource = readFileSync(resolve(import.meta.dirname, 'aiPromptInputNode.ts'), 'utf-8')

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
    it('normalizes each section model-id array for toDOM serialization', () => {
        const promptNode = testSchema.nodes.aiPromptInput.create({
            aiReasoningModels: '["gpt-4o", "gpt-4o", "", "claude-3"]',
            aiImageModels: '["image-model", "image-model", ""]',
            aiVideoModels: '["video-model", "video-model", ""]',
            imageGenerationSize: 'auto',
            useMultipleReasoningModels: true,
            useMultipleImageModels: true,
            useMultipleVideoModels: true,
        }, [testSchema.nodes.paragraph.create(null, [testSchema.text('hello')])])

        const domSpec = aiPromptInputNodeSpec.toDOM(promptNode as any) as any[]
        const attrs = domSpec[1]

        expect(attrs['data-ai-reasoning-models']).toBe('["gpt-4o","claude-3"]')
        expect(attrs['data-ai-image-models']).toBe('["image-model"]')
        expect(attrs['data-ai-video-models']).toBe('["video-model"]')
    })

    it('serializes the stored selection array verbatim in toDOM regardless of the multi flag', () => {
        // toDOM is the single source of truth: it serializes whatever array is
        // stored; the useMultiple flag only gates submission, not storage.
        const promptNode = testSchema.nodes.aiPromptInput.create({
            aiReasoningModels: '["gpt-4o", "claude-3"]',
            aiImageModels: '["image-model", "image-model"]',
            aiVideoModels: '["video-model", "video-model"]',
        }, [testSchema.nodes.paragraph.create(null, [testSchema.text('hello')])])

        const domSpec = aiPromptInputNodeSpec.toDOM(promptNode as any) as any[]
        const attrs = domSpec[1]

        expect(attrs['data-ai-reasoning-models']).toBe('["gpt-4o","claude-3"]')
        expect(attrs['data-ai-image-models']).toBe('["image-model"]')
        expect(attrs['data-ai-video-models']).toBe('["video-model"]')
    })

    it('normalizes model list attrs during parseDom', () => {
        const el = document.createElement('div')
        el.className = 'ai-prompt-input-wrapper'
        el.setAttribute('data-ai-reasoning-models', '["gpt-4o", "", "claude-3", "claude-3"]')
        el.setAttribute('data-ai-image-models', '["image-model", "", "image-model"]')
        el.setAttribute('data-ai-video-models', '[]')
        el.setAttribute('data-image-generation-size', '1024x1024')
        el.setAttribute('data-use-multiple-reasoning-models', 'true')
        el.setAttribute('data-use-multiple-image-models', 'true')
        el.setAttribute('data-use-multiple-video-models', 'true')

        const parseRule = aiPromptInputNodeSpec.parseDOM![0]
        const attrs = parseRule.getAttrs!(el as any) as Record<string, any>

        expect(attrs.aiReasoningModels).toBe('["gpt-4o","claude-3"]')
        expect(attrs.aiImageModels).toBe('["image-model"]')
        expect(attrs.aiVideoModels).toBe('')
        expect(attrs.useMultipleReasoningModels).toBe(true)
        expect(attrs.useMultipleImageModels).toBe(true)
        expect(attrs.useMultipleVideoModels).toBe(true)
    })
})

describe('media generation mode switch', () => {
    it('reshuffles the selected mode to the right using the shared default duration', () => {
        const switchStart = aiPromptInputNodeSource.indexOf("id: 'ai-prompt-media-generation-mode'")
        const switchEnd = aiPromptInputNodeSource.indexOf('onChange: value => setNodeAttrs', switchStart)
        const mediaModeSwitchSource = aiPromptInputNodeSource.slice(switchStart, switchEnd)

        expect(switchStart, 'media mode switch should be configured').toBeGreaterThan(-1)
        expect(switchEnd, 'media mode switch should notify its node view').toBeGreaterThan(switchStart)
        expectSourceToContain(mediaModeSwitchSource, "reshuffleItemsOnValueChange: {\n                enable: true,\n                selectedElementPosition: 'right',\n            },")
        expectSourceNotToContain(mediaModeSwitchSource, 'transition:')
    })
})

describe('simple tooltip wiring', () => {
    it('uses ARIA-backed delegated tooltips for model and submit controls', () => {
        expectSourceToContain(aiPromptInputNodeSource, 'aria-label="Generation settings"')
        expectSourceToContain(aiPromptInputNodeSource, 'data-help-tooltip="aria-label"')
        expectSourceToContain(aiPromptInputNodeSource, "submitButton.dataset.helpTooltip = 'aria-description'")
        expectSourceToContain(aiPromptInputNodeSource, 'submitButton.ariaDescription = invalid?.message ?? null')
        expectSourceNotToContain(aiPromptInputNodeSource, "submitButton.setAttribute('title'")
    })
})
