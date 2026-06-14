import { describe, it, expect } from 'vitest'
import * as aiChatThreadPlugin from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'

describe('aiChatThreadPlugin exports', () => {
    it('re-exports generated video node API', () => {
        expect(aiChatThreadPlugin.aiGeneratedVideoNodeType).toBe('aiGeneratedVideo')
        expect(typeof aiChatThreadPlugin.aiGeneratedVideoNodeSpec).toBe('object')
        expect(typeof aiChatThreadPlugin.aiGeneratedVideoNodeView).toBe('function')
    })

    it('re-exports plugin creator and core node constructors', () => {
        expect(typeof aiChatThreadPlugin.createAiChatThreadPlugin).toBe('function')
        expect(aiChatThreadPlugin.aiReasoningSectionNodeType).toBe('aiReasoningSection')
    })
})
