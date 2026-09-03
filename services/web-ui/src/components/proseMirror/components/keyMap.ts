import {
    chainCommands,
    exitCode,
    joinDown,
    joinUp,
    lift,
    selectParentNode,
    setBlockType,
    toggleMark,
    wrapIn,
} from 'prosemirror-commands'
import {
    redo,
    undo,
} from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import {
    liftListItem,
    sinkListItem,
    splitListItem,
    wrapInList,
} from 'prosemirror-schema-list'
import {
    type Schema,
} from 'prosemirror-model'
import {
    type Command,
} from 'prosemirror-state'

import { insertAiChatThread } from '$src/components/proseMirror/components/commands.ts'

type Keymap = Record<string, Command>
type KeyOverrides = Record<string, string | false>

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

export const buildKeymap = (
    schema: Schema,
    documentType: string,
    mapKeys?: KeyOverrides,
): Keymap => {
    const keys: Keymap = {}
    const bind = (key: string, command: Command): void => {
        const mappedKey = mapKeys?.[key]
        if (mappedKey === false) {
            return
        }
        keys[mappedKey ?? key] = command
    }

    bind('Mod-z', undo)
    bind('Shift-Mod-z', redo)
    bind('Backspace', undoInputRule)
    if (!isMac) {
        bind('Mod-y', redo)
    }

    bind('Alt-ArrowUp', joinUp)
    bind('Alt-ArrowDown', joinDown)
    bind('Mod-BracketLeft', lift)
    bind('Escape', selectParentNode)

    const strong = schema.marks.strong
    if (strong) {
        bind('Mod-b', toggleMark(strong))
        bind('Mod-B', toggleMark(strong))
    }

    if (documentType === 'assetConversation') {
        bind('Mod-Shift-i', insertAiChatThread)
        bind('Mod-Shift-I', insertAiChatThread)
    }

    const emphasis = schema.marks.em
    if (emphasis) {
        bind('Mod-i', toggleMark(emphasis))
        bind('Mod-I', toggleMark(emphasis))
    }

    const code = schema.marks.code
    if (code) {
        bind('Mod-`', toggleMark(code))
    }

    const bulletList = schema.nodes.bullet_list
    if (bulletList) {
        bind('Shift-Ctrl-8', wrapInList(bulletList))
    }

    const orderedList = schema.nodes.ordered_list
    if (orderedList) {
        bind('Shift-Ctrl-9', wrapInList(orderedList))
    }

    const blockquote = schema.nodes.blockquote
    if (blockquote) {
        bind('Ctrl->', wrapIn(blockquote))
    }

    const hardBreak = schema.nodes.hard_break
    if (hardBreak) {
        const insertHardBreak = chainCommands(exitCode, (state, dispatch) => {
            dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
            return true
        })
        bind('Mod-Enter', insertHardBreak)
        bind('Shift-Enter', insertHardBreak)
        if (isMac) {
            bind('Ctrl-Enter', insertHardBreak)
        }
    }

    const listItem = schema.nodes.list_item
    if (listItem) {
        bind('Enter', splitListItem(listItem))
        bind('Mod-[', liftListItem(listItem))
        bind('Mod-]', sinkListItem(listItem))
    }

    const paragraph = schema.nodes.paragraph
    if (paragraph) {
        bind('Shift-Ctrl-0', setBlockType(paragraph))
    }

    const codeBlock = schema.nodes.code_block
    if (codeBlock) {
        bind('Shift-Ctrl-\\', setBlockType(codeBlock))
    }

    const heading = schema.nodes.heading
    if (heading) {
        for (let level = 1; level <= 6; level += 1) bind(`Shift-Ctrl-${level}`, setBlockType(heading, { level }))
    }

    const horizontalRule = schema.nodes.horizontal_rule
    if (horizontalRule) {
        bind('Mod-_', (state, dispatch) => {
            dispatch?.(state.tr.replaceSelectionWith(horizontalRule.create()).scrollIntoView())
            return true
        })
    }

    return keys
}
