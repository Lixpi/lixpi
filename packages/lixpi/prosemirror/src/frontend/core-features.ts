import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'

import {
    type DocumentViewFeature,
} from './document-view.ts'

// Features that need nothing but ProseMirror. A view definition lists the
// ones it wants; each works with any context.

export const historyFeature: DocumentViewFeature<unknown> = {
    id: 'history',
    create: () => ({ plugins: [history()] }),
}

export const baseKeymapFeature: DocumentViewFeature<unknown> = {
    id: 'base-keymap',
    create: () => ({ plugins: [keymap(baseKeymap)] }),
}

export const dropCursorFeature: DocumentViewFeature<unknown> = {
    id: 'drop-cursor',
    create: () => ({ plugins: [dropCursor()] }),
}

export const gapCursorFeature: DocumentViewFeature<unknown> = {
    id: 'gap-cursor',
    create: () => ({ plugins: [gapCursor()] }),
}
