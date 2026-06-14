import { describe, it, expect } from 'vitest'
import * as aiPromptInputPlugin from '$src/components/proseMirror/plugins/aiPromptInputPlugin/index.ts'

describe('aiPromptInputPlugin exports', () => {
    it('re-exports plugin constants and node spec', () => {
        expect(aiPromptInputPlugin.AI_PROMPT_INPUT_PLUGIN_KEY).toBeDefined()
        expect(aiPromptInputPlugin.aiPromptInputNodeType).toBe('aiPromptInput')
        expect(typeof aiPromptInputPlugin.aiPromptInputNodeSpec).toBe('object')
    })

    it('re-exports plugin factory', () => {
        expect(typeof aiPromptInputPlugin.createAiPromptInputPlugin).toBe('function')
        expect(typeof aiPromptInputPlugin.parseAiModelSelectionAttr).toBe('function')
    })
})
