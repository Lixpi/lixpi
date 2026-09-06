import {
    Plugin,
    PluginKey,
    type EditorState,
    type Transaction,
} from 'prosemirror-state'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'

type DocumentJson = Record<string, unknown>
type StatePluginValue = { doc: ProseMirrorNode } | undefined
type DocumentUpdateCallback = (document: DocumentJson) => void
type LocalTransactionCallback = (transaction: Transaction) => void

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

export const statePlugin = (
    initialStateContent: DocumentJson,
    dispatchUpdateCallback: DocumentUpdateCallback,
    dispatchLiveUpdateCallback?: DocumentUpdateCallback,
    dispatchLocalTransactionCallback?: LocalTransactionCallback | null,
): Plugin<StatePluginValue> => {
    const applyPluginState = (
        transaction: Transaction,
        pluginState: StatePluginValue,
    ): StatePluginValue => {
        const skipDispatch = transaction.getMeta('skipDispatch')

        // Live consumers need every document change, including streamed changes that skip persistence.
        if (transaction.docChanged)
            dispatchLiveUpdateCallback?.(
                transaction.doc.toJSON(),
            )

        if (
            !skipDispatch
            && transaction.docChanged
        )
            dispatchLocalTransactionCallback?.(transaction)

        if (
            !skipDispatch
            && !dispatchLocalTransactionCallback
            && transaction.docChanged
            && !hasInProgressAiContent(transaction.doc)
            && !isAiChatThreadDocument(transaction.doc)
        )
            dispatchUpdateCallback(
                transaction.doc.toJSON(),
            )

        return pluginState
    }

    const initState = (
        _config: unknown,
        state: EditorState,
    ): StatePluginValue => {
        if (Object.keys(initialStateContent).length === 0)
            return undefined

        return { doc: state.schema.nodeFromJSON(initialStateContent) }
    }

    return new Plugin<StatePluginValue>({
        key: new PluginKey<StatePluginValue>('statePlugin'),
        state: {
            init: initState,
            apply: applyPluginState,
        },
    })
}
