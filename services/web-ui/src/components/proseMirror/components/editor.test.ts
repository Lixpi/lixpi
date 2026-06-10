'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Source-shape regression: the AI prompt draft restoration runs inside the editor
// constructor against the live app schema and a mounted ProseMirror view, which is
// not exercisable in a small unit test. These assertions guard the validate-then-
// fallback structure so a refactor can't silently drop persisted-draft recovery.
const editorSource = readFileSync(resolve(__dirname, 'editor.ts'), 'utf-8')

function expectSourceToContain(snippet: string): void {
    expect(editorSource.includes(snippet), `editor.ts should contain:\n${snippet}`).toBe(true)
}

describe('ProseMirrorEditor — AI prompt draft restoration', () => {
    it('validates a persisted draft against the schema before reusing it', () => {
        expectSourceToContain('const doc = this.editorSchema.nodeFromJSON(initialVal)')
        expectSourceToContain('doc.check()')
    })

    it('falls back to a fresh prompt input when the persisted draft is invalid', () => {
        expectSourceToContain("console.warn('[EDITOR] Invalid AI prompt draft, creating fresh input:', e)")
        expectSourceToContain('this.editorSchema.nodes[aiPromptInputNodeType].createAndFill()')
    })

    it('forwards context tray control factory into the AI prompt input plugin', () => {
        expectSourceToContain('createContextTray: this.promptControlFactories?.createContextTray,')
        expectSourceToContain('createAiPromptInputPlugin({')
        expectSourceToContain('onStop: () => this.onPromptStop?.()')
        expectSourceToContain('promptControlFactories?.createModelDropdown,')
    })
})
