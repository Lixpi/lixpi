import {
    type Node as ProseMirrorNode,
    type Schema,
} from 'prosemirror-model'
import {
    EditorState,
    type Plugin,
    type Transaction,
} from 'prosemirror-state'
import {
    EditorView,
    type DirectEditorProps,
    type EditorProps,
    type NodeViewConstructor,
} from 'prosemirror-view'

import {
    type DocumentKindRegistry,
} from '../shared/document-kind.ts'

// Marks a transaction that replaces the document from outside the view, such
// as a server copy. Document sync does not send it back, and history does not
// record it.
export const DOCUMENT_REPLACE_META = 'skipDispatch'

export type DocumentViewEnvironment<Context> = {
    schema: Schema
    context: Context
}

type DomEventHandlers = NonNullable<EditorProps['handleDOMEvents']>

export type DocumentViewFeatureInstance = {
    plugins?: Plugin[]
    nodeViews?: Record<string, NodeViewConstructor>
    props?: {
        handleDOMEvents?: DomEventHandlers
        // The view is editable only while every feature allows it.
        editable?: (state: EditorState) => boolean
        attributes?: Record<string, string> | ((state: EditorState) => Record<string, string>)
    }
    destroy?: () => void
}

// A named unit of editor behavior. It is created once per view from the
// context the host supplies, and contributes plugins, node views and props.
export type DocumentViewFeature<Context> = {
    id: string
    create: (environment: DocumentViewEnvironment<Context>) => DocumentViewFeatureInstance
}

// The browser half of a document kind: which features its views run, in
// order. Feature order is plugin order.
export type DocumentViewDefinition<Context> = {
    kindId: string
    features: DocumentViewFeature<Context>[]
    // The document a view starts with when the host supplies none, or one
    // that fails to parse. Defaults to the kind's empty document.
    createInitialDocument?: (environment: DocumentViewEnvironment<Context>) => ProseMirrorNode
}

export type DocumentViewHandle = {
    view: EditorView
    // Replaces the whole document with one transaction that sync and history
    // ignore. Plugins and node views stay in place.
    replaceDocument: (json: unknown) => void
    destroy: () => void
}

export type MountDocumentViewOptions<Context> = {
    registry: DocumentKindRegistry
    definition: DocumentViewDefinition<Context>
    container: HTMLElement
    document?: unknown
    context: Context
    dispatchTransaction?: (
        transaction: Transaction,
        view: EditorView,
    ) => void
    onInvalidDocument?: (error: unknown) => void
}

const combineDomEvents = (instances: DocumentViewFeatureInstance[]): DomEventHandlers => {
    const handlers = new Map<string, Array<(
        view: EditorView,
        event: Event,
    ) => boolean | void>>()

    for (const instance of instances) {
        for (const [name, handler] of Object.entries(instance.props?.handleDOMEvents ?? {})) {
            if (!handler)
                continue

            handlers.set(
                name,
                [...(handlers.get(name) ?? []), handler as (
                    view: EditorView,
                    event: Event,
                ) => boolean | void],
            )
        }
    }

    // The first handler that returns true wins, as with ProseMirror's own
    // prop resolution.
    return Object.fromEntries(
        [...handlers].map(
            ([name, list]) => [
                name,
                (view: EditorView, event: Event) => list.some(handler => handler(view, event) === true),
            ],
        ),
    ) as DomEventHandlers
}

const combineAttributes = (instances: DocumentViewFeatureInstance[]): ((state: EditorState) => Record<string, string>) | undefined => {
    const sources = instances.flatMap(instance => (instance.props?.attributes ? [instance.props.attributes] : []))

    if (sources.length === 0)
        return undefined

    return state =>
        sources.reduce<Record<string, string>>(
            (merged, source) => ({
                ...merged,
                ...(typeof source === 'function' ? source(state) : source),
            }),
            {},
        )
}

class DocumentView<Context> implements DocumentViewHandle {
    readonly view: EditorView
    private readonly instances: DocumentViewFeatureInstance[]
    private readonly schema: Schema

    constructor(private readonly options: MountDocumentViewOptions<Context>) {
        this.schema = options.registry.schema(options.definition.kindId)
        const environment = {
            schema: this.schema,
            context: options.context,
        }
        this.instances = options.definition.features.map(feature => feature.create(environment))
        const attributes = combineAttributes(this.instances)
        const editableChecks = this.instances.flatMap(instance => (instance.props?.editable ? [instance.props.editable] : []))
        const props: DirectEditorProps = {
            state: EditorState.create({
                doc: this.initialDocument(environment),
                plugins: this.instances.flatMap(instance => instance.plugins ?? []),
            }),
            nodeViews: this.instances.reduce<Record<string, NodeViewConstructor>>(
                (merged, instance) => ({
                    ...merged,
                    ...(instance.nodeViews ?? {}),
                }),
                {},
            ),
            handleDOMEvents: combineDomEvents(this.instances),
            editable: state => editableChecks.every(check => check(state)),
            ...(attributes ? { attributes } : {}),
            ...(options.dispatchTransaction
                ? {
                    dispatchTransaction: (transaction: Transaction) => options.dispatchTransaction!(transaction, this.view),
                }
                : {}),
        }

        this.view = new EditorView(options.container, props)
    }

    private initialDocument(environment: DocumentViewEnvironment<Context>): ProseMirrorNode {
        const fallback = (): ProseMirrorNode => this.options.definition.createInitialDocument?.(environment)
            ?? this.options.registry.createEmptyDocument(this.options.definition.kindId)

        if (
            this.options.document === undefined
            || this.options.document === null
            || (typeof this.options.document === 'object' && Object.keys(this.options.document).length === 0)
        )
            return fallback()

        try {
            return this.options.registry.parse(this.options.definition.kindId, this.options.document)
        } catch (error) {
            this.options.onInvalidDocument?.(error)

            return fallback()
        }
    }

    replaceDocument(json: unknown): void {
        const next = this.options.registry.parse(this.options.definition.kindId, json)
        const { state } = this.view

        if (state.doc.eq(next))
            return

        this.view.dispatch(
            state.tr
                .replaceWith(
                    0,
                    state.doc.content.size,
                    next.content,
                )
                .setMeta(DOCUMENT_REPLACE_META, true)
                .setMeta('addToHistory', false),
        )
    }

    destroy(): void {
        for (const instance of this.instances)
            instance.destroy?.()

        this.view.destroy()
    }
}

// Creates an editor view for a registered kind from its view definition. The
// schema comes from the registry's cache, so mounting another view of the
// same kind builds nothing new.
export const mountDocumentView = <Context>(options: MountDocumentViewOptions<Context>): DocumentViewHandle => new DocumentView(options)
