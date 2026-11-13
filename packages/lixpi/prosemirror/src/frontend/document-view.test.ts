// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    Plugin,
    PluginKey,
} from 'prosemirror-state'

import {
    createCoreDocumentKindRegistry,
    DOCUMENT_TYPE,
} from '../shared/document-kinds.ts'
import {
    baseKeymapFeature,
    historyFeature,
} from './core-features.ts'
import {
    DOCUMENT_REPLACE_META,
    mountDocumentView,
    type DocumentViewFeature,
    type DocumentViewHandle,
} from './document-view.ts'

const registry = createCoreDocumentKindRegistry()
const handles: DocumentViewHandle[] = []

afterEach(() => {
    for (const handle of handles.splice(0))
        handle.destroy()
})

const paragraphDoc = (text: string) => ({
    type: 'doc',
    content: [{
        type: 'paragraph',
        content: [{
            type: 'text',
            text,
        }],
    }],
})

const namedPluginFeature = (id: string): DocumentViewFeature<unknown> => ({
    id,
    create: () => ({ plugins: [new Plugin({ key: new PluginKey(id) })] }),
})

const mount = (
    features: DocumentViewFeature<unknown>[],
    document: unknown = paragraphDoc('hello'),
): DocumentViewHandle => {
    const handle = mountDocumentView({
        registry,
        definition: {
            kindId: DOCUMENT_TYPE.ASSET_CONTENT,
            features,
        },
        container: document === null ? globalThis.document.createElement('div') : globalThis.document.createElement('div'),
        document,
        context: {},
    })
    handles.push(handle)

    return handle
}

// =============================================================================
// MOUNT
// =============================================================================

describe('mountDocumentView', () => {
    it('uses the kind schema from the registry and keeps feature order as plugin order', () => {
        const handle = mount([
            namedPluginFeature('first'),
            historyFeature,
            namedPluginFeature('last'),
        ])
        const keys = handle.view.state.plugins.map(plugin => (plugin as unknown as { key: string }).key)

        expect(handle.view.state.schema).toBe(registry.schema(DOCUMENT_TYPE.ASSET_CONTENT))
        expect(keys[0]).toMatch(/^first/)
        expect(keys.at(-1)).toMatch(/^last/)
    })

    it('starts from the kind empty document when the host supplies none or an invalid one', () => {
        const onInvalidDocument = vi.fn()
        const empty = mount([], undefined)
        const invalid = mountDocumentView({
            registry,
            definition: {
                kindId: DOCUMENT_TYPE.ASSET_CONTENT,
                features: [],
            },
            container: document.createElement('div'),
            document: { type: 'doc' },
            context: {},
            onInvalidDocument,
        })
        handles.push(invalid)

        expect(empty.view.state.doc.childCount).toBe(1)
        expect(invalid.view.state.doc.childCount).toBe(1)
        expect(onInvalidDocument).toHaveBeenCalledTimes(1)
    })

    it('creates each feature once with the schema and the host context', () => {
        const create = vi.fn(() => ({}))
        const context = { auth: 'token' }
        const handle = mountDocumentView({
            registry,
            definition: {
                kindId: DOCUMENT_TYPE.ASSET_CONTENT,
                features: [{
                    id: 'probe',
                    create,
                }],
            },
            container: document.createElement('div'),
            context,
        })
        handles.push(handle)
        handle.replaceDocument(paragraphDoc('again'))

        expect(create).toHaveBeenCalledTimes(1)
        expect(create).toHaveBeenCalledWith({
            schema: registry.schema(DOCUMENT_TYPE.ASSET_CONTENT),
            context,
        })
    })
})

// =============================================================================
// REPLACE
// =============================================================================

describe('DocumentViewHandle.replaceDocument', () => {
    it('replaces the document in one transaction that keeps plugins and stays out of history', () => {
        const handle = mount([
            historyFeature,
            baseKeymapFeature,
        ])
        const plugins = handle.view.state.plugins
        const dispatched: boolean[] = []
        const originalDispatch = handle.view.dispatch.bind(handle.view)
        handle.view.dispatch = transaction => {
            dispatched.push(transaction.getMeta(DOCUMENT_REPLACE_META) === true && transaction.getMeta('addToHistory') === false)
            originalDispatch(transaction)
        }

        handle.replaceDocument(paragraphDoc('from the server'))

        expect(handle.view.state.doc.textContent).toBe('from the server')
        expect(handle.view.state.plugins).toBe(plugins)
        expect(dispatched).toEqual([true])

        handle.replaceDocument(paragraphDoc('from the server'))
        expect(dispatched).toHaveLength(1)
    })
})

// =============================================================================
// COMBINED PROPS
// =============================================================================

describe('combined feature props', () => {
    it('stops at the first DOM handler that returns true and stays editable only while every feature allows it', () => {
        const calls: string[] = []
        let locked = false
        const handle = mount([
            {
                id: 'first',
                create: () => ({
                    props: {
                        handleDOMEvents: {
                            mousedown: () => {
                                calls.push('first')

                                return true
                            },
                        },
                        editable: () => !locked,
                    },
                }),
            },
            {
                id: 'second',
                create: () => ({
                    props: {
                        handleDOMEvents: {
                            mousedown: () => {
                                calls.push('second')

                                return true
                            },
                        },
                        editable: () => true,
                    },
                }),
            },
        ])

        handle.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(calls).toEqual(['first'])
        expect(handle.view.editable).toBe(true)

        locked = true
        handle.view.setProps({})
        expect(handle.view.editable).toBe(false)
    })
})
