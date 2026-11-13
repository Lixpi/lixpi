// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest'
import {
    EditorState,
} from 'prosemirror-state'
import {
    EditorView,
} from 'prosemirror-view'
import {
    history,
} from 'prosemirror-history'

import {
    createCoreDocumentKindRegistry,
    DOCUMENT_TYPE,
} from '../../../shared/document-kinds.ts'
import { createCodeBlockPlugin } from './code-block.ts'

const coreRegistry = createCoreDocumentKindRegistry()

const views: EditorView[] = []

const createEditor = (): EditorView => {
    const schema = coreRegistry.schema(DOCUMENT_TYPE.ASSET_CONTENT)
    const codeBlock = schema.nodes.code_block.create(null, schema.text('initial'))
    const state = EditorState.create({
        schema,
        doc: schema.nodes.doc.create(null, codeBlock),
        plugins: [
            history(),
            createCodeBlockPlugin(schema),
        ],
    })
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView(host, { state })
    views.push(view)

    return view
}

afterEach(() => {
    for (const view of views.splice(0))
        view.destroy()

    document.body.replaceChildren()
})

describe('code block editor editability', () => {
    it('keeps a readonly code block non-editable and blocks keyboard mutation commands', () => {
        const view = createEditor()
        view.setProps({ editable: () => false })
        const codeContent = view.dom.querySelector<HTMLElement>('.cm-content')

        expect(view.editable).toBe(false)
        expect(codeContent?.getAttribute('contenteditable')).toBe('false')

        codeContent?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        }))
        codeContent?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        }))

        expect(view.state.doc.textContent).toBe('initial')
        expect(codeContent?.textContent).toContain('initial')
    })

    it('synchronizes host document updates while readonly and restores editing when toggled', () => {
        const view = createEditor()
        const codeContent = view.dom.querySelector<HTMLElement>('.cm-content')
        view.setProps({ editable: () => false })

        const codeBlock = view.state.doc.firstChild!
        view.dispatch(view.state.tr.replaceWith(
            0,
            codeBlock.nodeSize,
            codeBlock.type.create(codeBlock.attrs, view.state.schema.text('host update')),
        ))

        expect(codeContent?.textContent).toContain('host update')

        view.setProps({ editable: () => true })

        expect(view.editable).toBe(true)
        expect(codeContent?.getAttribute('contenteditable')).toBe('true')
        expect(codeContent?.textContent).toContain('host update')
    })
})
