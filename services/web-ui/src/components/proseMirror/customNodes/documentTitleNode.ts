'use strict'

export const documentTitleNodeType = 'documentTitle'

export const documentTitleNodeSpec = {
    content: 'text*',
    defining: true,
    selectable: false,
    toDOM() { return ['h1', { class: 'document-title' }, 0]},
    parseDOM: [{ tag: 'h1.document-title' }]
}
