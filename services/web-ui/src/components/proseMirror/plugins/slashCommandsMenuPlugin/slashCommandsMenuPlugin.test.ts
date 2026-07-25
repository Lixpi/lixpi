'use strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import {
    doc,
    p,
    codeBlock,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import { createMockEditorView } from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'
import {
    slashCommandsMenuPlugin,
    slashCommandsMenuPluginKey,
    SlashCommandsMenuView,
} from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/slashCommandsMenuPlugin.ts'

const slashMenuStyles = readFileSync(resolve(__dirname, 'slashCommandsMenu.scss'), 'utf-8')

const mockCommands = vi.hoisted(() => ({
        firstCommand: vi.fn(),
        secondCommand: vi.fn(),
        lastRenderedQuery: '',
    }))

vi.mock('$src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts', () => {
    const baseCommands = [
        {
            name: 'Code Block',
            aliases: ['code', 'code-block'],
            icon: '<span>code</span>',
            description: 'Insert code block',
            execute: mockCommands.firstCommand,
        },
        {
            name: 'Image',
            aliases: ['image', 'img'],
            icon: '<span>image</span>',
            description: 'Insert image',
            execute: mockCommands.secondCommand,
        },
    ]

    const filterCommands = (query: string) => {
        mockCommands.lastRenderedQuery = query
        if (!query) return baseCommands
        return baseCommands.filter((command) => command.name.toLowerCase().includes(query.toLowerCase())
            || command.aliases.some((alias) => alias.includes(query.toLowerCase())))
    }

    return {
        SLASH_COMMANDS: baseCommands,
        filterCommands,
    }
})

function createPositionAfterWhitespace(state: EditorState): number {
    const max = state.doc.content.size
    for (let position = 1; position < max; position += 1) {
        const previous = state.doc.textBetween(position - 1, position, '')
        if (previous === ' ') return position
    }
    return state.selection.from
}

function createPositionAfterNonWhitespace(state: EditorState): number {
    const max = state.doc.content.size
    for (let position = 1; position < max; position += 1) {
        const previous = state.doc.textBetween(position - 1, position, '')
        if (previous.trim() !== '' && previous.length > 0) return position
    }
    return state.selection.from
}

function createPluginState() {
    const plugin = slashCommandsMenuPlugin()
    return plugin
}

describe('slashCommandsMenuPlugin — input and key handling', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('uses the same light sidebar surface and selection palette', () => {
        expect(slashMenuStyles.includes('background: rgba(255, 255, 255, 0.94)')).toBe(true)
        expect(slashMenuStyles.includes('color: #1a2744')).toBe(true)
        expect(slashMenuStyles.includes('background-color: rgba(95, 143, 207, 0.11)')).toBe(true)
    })

    it('opens slash menu at the start of paragraph when / typed', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello')),
            plugins: [plugin],
        })
        const view = createMockEditorView({ state })

        const opened = plugin.spec.props.handleTextInput?.(view, state.selection.from, state.selection.to, '/')
        expect(opened).toBe(true)
        expect(view.dispatch).toHaveBeenCalled()

        const pluginState = slashCommandsMenuPluginKey.getState(view.state)
        expect(pluginState?.active).toBe(true)
        expect(pluginState?.query).toBe('')
    })

    it('opens slash menu after whitespace when query starts with a space-delimited path', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello world')),
            plugins: [plugin],
        })
        const view = createMockEditorView({
            state,
        })

        const whitespacePos = createPositionAfterWhitespace(state)
        const opened = plugin.spec.props.handleTextInput?.(view, whitespacePos, whitespacePos, '/')

        expect(opened).toBe(true)
        expect(view.dispatch).toHaveBeenCalled()
        expect(slashCommandsMenuPluginKey.getState(view.state).active).toBe(true)
    })

    it('does not open slash menu in the middle of a word', () => {
        const plugin = createPluginState()
        const baseState = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello world')),
            plugins: [plugin],
        })
        const wordMiddlePos = createPositionAfterNonWhitespace(baseState)
        const state = EditorState.create({
            schema: testSchema,
            doc: baseState.doc,
            plugins: [plugin],
            selection: TextSelection.create(baseState.doc, wordMiddlePos, wordMiddlePos),
        })
        const view = createMockEditorView({ state })

        const opened = plugin.spec.props.handleTextInput?.(view, wordMiddlePos, wordMiddlePos, '/')
        expect(opened).toBe(false)
        expect(slashCommandsMenuPluginKey.getState(view.state).active).toBe(false)
        expect(mockCommands.firstCommand).not.toHaveBeenCalled()
    })

    it('moves selected command with ArrowDown/ArrowUp and runs selected command on Enter', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello')),
            plugins: [plugin],
        })
        const view = createMockEditorView({ state })
        const menu = new SlashCommandsMenuView({ view })

        const tr = view.state.tr.setMeta(slashCommandsMenuPluginKey, { type: 'open', triggerPos: view.state.selection.from })
        view.dispatch(tr)

        menu.update()
        menu.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
        expect(slashCommandsMenuPluginKey.getState(view.state).selectedIndex).toBe(1)

        menu.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))
        expect(mockCommands.secondCommand).toHaveBeenCalled()
        expect(slashCommandsMenuPluginKey.getState(view.state).active).toBe(false)
    })

    it('executes command on Enter after Escape filter', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello')),
            plugins: [plugin],
        })
        const view = createMockEditorView({ state })
        const menu = new SlashCommandsMenuView({ view })

        const tr = view.state.tr.setMeta(slashCommandsMenuPluginKey, { type: 'open', triggerPos: view.state.selection.from })
        view.dispatch(tr)

        menu.update()
        const itemEl = (menu as any).menuList.querySelector('.slash-commands-menu-item')
        expect(itemEl).toBeTruthy()

        itemEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        expect(mockCommands.firstCommand).toHaveBeenCalled()
        expect(slashCommandsMenuPluginKey.getState(view.state).active).toBe(false)
    })

    it('blocks slash menu inside code blocks', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(codeBlock('hello')),
            plugins: [plugin],
        })
        const view = createMockEditorView({
            state,
        })

        const opened = plugin.spec.props.handleTextInput?.(view, state.selection.from, state.selection.to, '/')
        expect(opened).toBe(false)
        expect(view.dispatch).not.toHaveBeenCalled()
    })

    it('closes on Escape', () => {
        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello')),
            plugins: [plugin],
        })
        const view = createMockEditorView({ state })
        const menu = new SlashCommandsMenuView({ view })

        const tr = view.state.tr.setMeta(slashCommandsMenuPluginKey, { type: 'open', triggerPos: view.state.selection.from })
        view.dispatch(tr)

        const closed = menu.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(closed).toBe(true)
        expect(slashCommandsMenuPluginKey.getState(view.state).active).toBe(false)
    })

    it('keeps filter query updates available from registry', () => {
        expect(mockCommands.lastRenderedQuery).toBe('')

        const plugin = createPluginState()
        const state = EditorState.create({
            schema: testSchema,
            doc: doc(p('')),
            plugins: [plugin],
        })
        const view = createMockEditorView({ state })

        plugin.spec.props.handleTextInput?.(view, 1, 1, '/')
        expect(mockCommands.lastRenderedQuery).toBe('')

        const tr = view.state.tr.setMeta(slashCommandsMenuPluginKey, { type: 'updateSelectedIndex', selectedIndex: 0 })
        view.dispatch(tr)
        expect(mockCommands.lastRenderedQuery).toBe('')
    })
})
