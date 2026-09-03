import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { redo } from 'prosemirror-history'
import { schema as baseSchema } from '$src/components/proseMirror/components/schema.ts'
import { insertAiChatThread } from '$src/components/proseMirror/components/commands.ts'
import { buildKeymap } from '$src/components/proseMirror/components/keyMap.ts'

let consoleWarnSpy: { mockRestore: () => void } | null = null
let consoleErrorSpy: { mockRestore: () => void } | null = null

describe('buildKeymap', () => {
    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarnSpy?.mockRestore()
        consoleErrorSpy?.mockRestore()
        consoleWarnSpy = null
        consoleErrorSpy = null
    })

    it('supports mapKeys overriding and disabling key bindings', () => {
        const disabledDefaultUndo = buildKeymap(baseSchema, 'assetContent', {
            'Mod-z': false,
        })
        expect(disabledDefaultUndo['Mod-z']).toBeUndefined()

        const remappedUndo = buildKeymap(baseSchema, 'assetContent', {
            'Shift-Mod-z': 'Mod-z',
        })
        expect(remappedUndo['Mod-z']).toBe(redo)
        expect(remappedUndo['Shift-Mod-z']).toBeUndefined()
    })

    it('adds AI thread-specific binding only for assetConversation documents', () => {
        const aiChatBindings = buildKeymap(baseSchema, 'assetConversation')
        const documentBindings = buildKeymap(baseSchema, 'assetContent')

        expect(aiChatBindings['Mod-Shift-i']).toBe(insertAiChatThread)
        expect(aiChatBindings['Mod-Shift-I']).toBe(insertAiChatThread)
        expect(documentBindings['Mod-Shift-i']).toBeUndefined()
        expect(documentBindings['Mod-Shift-I']).toBeUndefined()
    })

    it('binds Mod-i/Mod-I to italic for both assetConversation and regular documents', () => {
        const aiChatBindings = buildKeymap(baseSchema, 'assetConversation')
        const documentBindings = buildKeymap(baseSchema, 'assetContent')

        expect(typeof aiChatBindings['Mod-i']).toBe('function')
        expect(typeof aiChatBindings['Mod-I']).toBe('function')
        expect(typeof documentBindings['Mod-i']).toBe('function')
        expect(typeof documentBindings['Mod-I']).toBe('function')
    })
})
