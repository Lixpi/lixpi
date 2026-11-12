// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { redo } from 'prosemirror-history'
import { schema as baseSchema } from '@lixpi/prosemirror'

import { buildKeymap } from './keymap.ts'

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
        const disabledDefaultUndo = buildKeymap(baseSchema, {
            'Mod-z': false,
        })
        expect(disabledDefaultUndo['Mod-z']).toBeUndefined()

        const remappedUndo = buildKeymap(baseSchema, {
            'Shift-Mod-z': 'Mod-z',
        })
        expect(remappedUndo['Mod-z']).toBe(redo)
        expect(remappedUndo['Shift-Mod-z']).toBeUndefined()
    })

    it('binds Mod-i and Mod-I to italic and leaves Mod-Shift-i to other features', () => {
        const bindings = buildKeymap(baseSchema)

        expect(typeof bindings['Mod-i']).toBe('function')
        expect(typeof bindings['Mod-I']).toBe('function')
        expect(bindings['Mod-Shift-i']).toBeUndefined()
    })
})
