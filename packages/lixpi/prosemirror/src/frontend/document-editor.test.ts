// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { EditorState } from 'prosemirror-state'

import {
    createCoreDocumentKindRegistry,
    DOCUMENT_TYPE,
} from '../shared/document-kinds.ts'
import {
    type DocumentAuthorityTransport,
} from './document-authority.ts'
import {
    createDocumentSyncPlugin,
    documentEditableFeature,
    documentFocusFeature,
    documentFocusKey,
    documentSyncFeature,
    mountDocumentEditor,
    type DocumentEditorContext,
    type DocumentEditorHandle,
    type DocumentEditorSession,
} from './document-editor.ts'
import {
    DOCUMENT_REPLACE_META,
    type DocumentViewDefinition,
} from './document-view.ts'

const registry = createCoreDocumentKindRegistry()
const schema = registry.schema(DOCUMENT_TYPE.ASSET_CONTENT)
const handles: DocumentEditorHandle[] = []

afterEach(() => {
    for (const handle of handles.splice(0))
        handle.destroy()
})

const paragraphDoc = (text: string, attrs: Record<string, unknown> = {}) => schema.nodes.doc!.create(null, [
    schema.nodes.paragraph!.create(attrs, text ? schema.text(text) : null),
])

const sessionFor = (overrides: Partial<DocumentEditorSession> = {}): DocumentEditorSession => ({
    onChange: vi.fn(),
    onLiveChange: vi.fn(),
    authority: null,
    isEditable: () => true,
    ...overrides,
})

const stateWith = (session: DocumentEditorSession, text = 'hello') => EditorState.create({
    schema,
    doc: paragraphDoc(text),
    plugins: [createDocumentSyncPlugin(session)],
})

describe('document sync', () => {
    it('reports a replacement as a live change only', () => {
        const session = sessionFor()
        const state = stateWith(session)
        const transaction = state.tr.insertText('!', 1).setMeta(DOCUMENT_REPLACE_META, true)

        state.apply(transaction)

        expect(session.onLiveChange).toHaveBeenCalledExactlyOnceWith(transaction.doc.toJSON())
        expect(session.onChange).not.toHaveBeenCalled()
    })

    it('reports nothing for a transaction that leaves the document alone', () => {
        const session = sessionFor()
        const state = stateWith(session)

        state.apply(state.tr.setMeta('anything', true))

        expect(session.onLiveChange).not.toHaveBeenCalled()
        expect(session.onChange).not.toHaveBeenCalled()
    })

    it('reports a local edit as a change and a live change', () => {
        const session = sessionFor()
        const state = stateWith(session, '')
        const transaction = state.tr.insertText('New content', 1)

        state.apply(transaction)

        expect(session.onChange).toHaveBeenCalledExactlyOnceWith(transaction.doc.toJSON())
        expect(session.onLiveChange).toHaveBeenCalledTimes(1)
    })

    it('sends a local edit to the authority instead of reporting it as a change', () => {
        const submitLocalTransaction = vi.fn()
        const session = sessionFor({ authority: { submitLocalTransaction } as never })
        const state = stateWith(session, '')
        const transaction = state.tr.insertText('Authority content', 1)

        state.apply(transaction)

        expect(submitLocalTransaction).toHaveBeenCalledExactlyOnceWith(transaction)
        expect(session.onChange).not.toHaveBeenCalled()
        expect(session.onLiveChange).toHaveBeenCalledTimes(1)
    })

    it('holds a change back while AI content is still streaming', () => {
        const session = sessionFor()
        const state = EditorState.create({
            schema,
            doc: schema.nodes.doc!.create(null, [
                schema.nodes.paragraph!.create(null, schema.text('x')),
                schema.nodes.image!.create({
                    src: 'data:image/png;base64,AA==',
                    isPartial: true,
                }),
            ]),
            plugins: [createDocumentSyncPlugin(session)],
        })

        state.apply(state.tr.insertText('!', 1))

        expect(session.onChange).not.toHaveBeenCalled()
        expect(session.onLiveChange).toHaveBeenCalledTimes(1)
    })
})

const definition: DocumentViewDefinition<DocumentEditorContext> = {
    kindId: DOCUMENT_TYPE.ASSET_CONTENT,
    features: [documentSyncFeature, documentFocusFeature, documentEditableFeature],
}

const silentTransport = (): DocumentAuthorityTransport & { leaseGranted: () => void } => {
    let grant: (value: { leaseId: string }) => void = () => undefined

    return {
        isReady: () => true,
        userId: () => 'user-1',
        subscribe: () => ({ unsubscribe: () => undefined }),
        resume: () => new Promise(() => undefined),
        submitSteps: vi.fn(),
        fetchSnapshot: vi.fn(),
        acquireLease: () => new Promise(resolve => void (grant = resolve)),
        renewLease: vi.fn(),
        releaseLease: vi.fn().mockResolvedValue(undefined),
        readEditLease: vi.fn(),
        leaseGranted: () => grant({ leaseId: 'lease-1' }),
    }
}

describe('mountDocumentEditor', () => {
    it('mounts an editable view that reports changes and tracks focus', () => {
        const onChange = vi.fn()
        const handle = mountDocumentEditor({
            registry,
            definition,
            container: document.createElement('div'),
            document: paragraphDoc('hello').toJSON(),
            context: {},
            onChange,
        })
        handles.push(handle)

        handle.view.dispatch(handle.view.state.tr.insertText('!', 1))
        handle.view.dom.dispatchEvent(new FocusEvent('focus'))

        expect(handle.view.editable).toBe(true)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(documentFocusKey.getState(handle.view.state)).toBe(true)
        expect(handle.authority).toBeNull()
    })

    it('keeps a read-only or disabled view from being edited', () => {
        const readOnly = mountDocumentEditor({
            registry,
            definition,
            container: document.createElement('div'),
            context: {},
            readOnly: true,
        })
        const disabled = mountDocumentEditor({
            registry,
            definition,
            container: document.createElement('div'),
            context: {},
            disabled: true,
        })
        handles.push(readOnly, disabled)

        expect(readOnly.view.editable).toBe(false)
        expect(disabled.view.editable).toBe(false)
    })

    it('stays read-only until the authority holds the lease, then reports the lease state', async () => {
        const transport = silentTransport()
        const onLeaseStateChange = vi.fn()
        const handle = mountDocumentEditor({
            registry,
            definition,
            container: document.createElement('div'),
            context: {},
            authority: {
                transport,
                organizationId: 'org-1',
                workspaceId: 'workspace-1',
                assetId: 'asset-1',
                role: 'content',
                onLeaseStateChange,
            },
        })
        handles.push(handle)

        expect(handle.view.editable).toBe(false)

        transport.leaseGranted()
        await Promise.resolve()
        await Promise.resolve()

        expect(handle.view.editable).toBe(true)
        expect(onLeaseStateChange).toHaveBeenCalledWith({ readOnly: false })

        handle.destroy()
        handles.splice(0)

        expect(transport.releaseLease).toHaveBeenCalledWith('asset-1', 'workspace-1', 'lease-1', expect.any(String))
    })
})
