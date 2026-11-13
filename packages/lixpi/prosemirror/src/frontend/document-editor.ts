import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    Plugin,
    PluginKey,
    type Transaction,
} from 'prosemirror-state'
import {
    type EditorView,
} from 'prosemirror-view'

import {
    type DocumentKindRegistry,
} from '../shared/document-kind.ts'
import {
    DocumentAuthority,
    type DocumentAuthorityOptions,
    type DocumentLeaseState,
} from './document-authority.ts'
import {
    DOCUMENT_REPLACE_META,
    mountDocumentView,
    type DocumentViewDefinition,
    type DocumentViewFeature,
    type DocumentViewHandle,
} from './document-view.ts'

type DocumentJson = Record<string, unknown>

// The per-view state the editor features share: the change callbacks, the
// authority when the document is server-authored, and whether the view may be
// edited right now.
export type DocumentEditorSession = {
    onChange?: (document: DocumentJson) => void
    onLiveChange?: (document: DocumentJson) => void
    authority: DocumentAuthority | null
    isEditable: () => boolean
}

export type DocumentEditorContext = {
    session: DocumentEditorSession
}

const hasInProgressAiContent = (doc: ProseMirrorNode): boolean => {
    let inProgress = false
    doc.descendants(node => {
        if (
            node.attrs.isReceivingAnimation
            || node.attrs.isStreaming
            || node.attrs.isPartial
        ) {
            inProgress = true

            return false
        }

        return undefined
    })

    return inProgress
}

const isAiChatThreadDocument = (doc: ProseMirrorNode): boolean => {
    let found = false
    doc.descendants(node => {
        if (node.type.name !== 'aiChatThread')
            return undefined

        found = true

        return false
    })

    return found
}

// Reports document changes. Every change reaches `onLiveChange`, including
// replacements from outside the view. A local edit goes to the authority when
// there is one; otherwise it reaches `onChange` unless AI content is still
// streaming or the document is a chat thread, which the server persists.
export const createDocumentSyncPlugin = (session: DocumentEditorSession): Plugin =>
    new Plugin({
        key: new PluginKey('documentSync'),
        state: {
            init: () => null,
            apply: (transaction: Transaction, value: null) => {
                if (!transaction.docChanged)
                    return value

                session.onLiveChange?.(
                    transaction.doc.toJSON(),
                )

                if (transaction.getMeta(DOCUMENT_REPLACE_META))
                    return value

                if (session.authority) {
                    session.authority.submitLocalTransaction(transaction)

                    return value
                }

                if (
                    !hasInProgressAiContent(transaction.doc)
                    && !isAiChatThreadDocument(transaction.doc)
                )
                    session.onChange?.(
                        transaction.doc.toJSON(),
                    )

                return value
            },
        },
    })

export const documentSyncFeature: DocumentViewFeature<DocumentEditorContext> = {
    id: 'document-sync',
    create: ({ context }) => ({ plugins: [createDocumentSyncPlugin(context.session)] }),
}

export const documentFocusKey = new PluginKey<boolean>('focus')

// Tracks whether the view has focus. Each change is a transaction, so the
// view checks again whether it may be edited.
export const documentFocusFeature: DocumentViewFeature<unknown> = {
    id: 'focus',
    create: () => {
        const setFocus = (
            view: EditorView,
            focused: boolean,
        ): boolean => {
            view.dispatch(
                view.state.tr.setMeta(documentFocusKey, focused),
            )

            return false
        }

        return {
            plugins: [
                new Plugin<boolean>({
                    key: documentFocusKey,
                    state: {
                        init: () => false,
                        apply: (transaction, previous) => {
                            const focused = transaction.getMeta(documentFocusKey)

                            return typeof focused === 'boolean' ? focused : previous
                        },
                    },
                    props: {
                        handleDOMEvents: {
                            blur: view => setFocus(view, false),
                            focus: view => setFocus(view, true),
                        },
                    },
                }),
            ],
        }
    },
}

export const documentEditableFeature: DocumentViewFeature<DocumentEditorContext> = {
    id: 'editable',
    create: ({ context }) => ({ props: { editable: () => context.session.isEditable() } }),
}

export type DocumentEditorAuthorityOptions = Omit<DocumentAuthorityOptions, 'getView' | 'onRemoteDocumentChange'>

export type MountDocumentEditorOptions<Context extends DocumentEditorContext> = {
    registry: DocumentKindRegistry
    definition: DocumentViewDefinition<Context>
    container: HTMLElement
    document?: unknown
    // The host's part of the context. The editor adds the session.
    context: Omit<Context, 'session'>
    readOnly?: boolean
    disabled?: boolean
    onChange?: (document: DocumentJson) => void
    onLiveChange?: (document: DocumentJson) => void
    authority?: DocumentEditorAuthorityOptions
    onInvalidDocument?: (error: unknown) => void
}

export type DocumentEditorHandle = DocumentViewHandle & {
    readonly authority: DocumentAuthority | null
    // Sends local steps still waiting for their batch.
    flushPendingSteps: () => Promise<void>
}

class DocumentEditor<Context extends DocumentEditorContext> implements DocumentEditorHandle {
    readonly authority: DocumentAuthority | null
    private readonly handle: DocumentViewHandle
    private readOnly: boolean

    constructor(options: MountDocumentEditorOptions<Context>) {
        // A view that edits through the authority starts read-only until the
        // lease is granted. A receive-only view follows the host's flag.
        this.readOnly = Boolean(options.readOnly)
            || Boolean(options.authority && !options.authority.receiveOnly)
        const session: DocumentEditorSession = {
            onChange: options.onChange,
            onLiveChange: options.onLiveChange,
            authority: null,
            isEditable: () => !options.disabled && !this.readOnly,
        }
        this.authority = options.authority
            ? new DocumentAuthority({
                ...options.authority,
                getView: () => this.handle?.view ?? null,
                onRemoteDocumentChange: document => options.onLiveChange?.(document as DocumentJson),
                onLeaseStateChange: state => this.handleLeaseStateChange(state, options.authority?.onLeaseStateChange),
            })
            : null
        session.authority = this.authority
        this.handle = mountDocumentView({
            registry: options.registry,
            definition: options.definition,
            container: options.container,
            document: options.document,
            context: {
                ...options.context,
                session,
            } as Context,
            onInvalidDocument: options.onInvalidDocument,
        })
    }

    get view(): EditorView {
        return this.handle.view
    }

    private handleLeaseStateChange(
        state: DocumentLeaseState,
        onLeaseStateChange?: (state: DocumentLeaseState) => void,
    ): void {
        this.readOnly = state.readOnly

        // An empty props update makes the view ask again whether it is
        // editable.
        this.handle?.view.setProps({})
        onLeaseStateChange?.(state)
    }

    replaceDocument(json: unknown): void {
        this.handle.replaceDocument(json)
    }

    async flushPendingSteps(): Promise<void> {
        await this.authority?.flushPendingSteps()
    }

    destroy(): void {
        this.authority?.disconnect()
        this.handle.destroy()
    }
}

// Mounts an editable document view with document sync, the editable rule and,
// when the document is server-authored, the authority that holds its lease.
// The view definition decides which of the session features it runs.
export const mountDocumentEditor = <Context extends DocumentEditorContext>(options: MountDocumentEditorOptions<Context>): DocumentEditorHandle =>
    new DocumentEditor(options)
