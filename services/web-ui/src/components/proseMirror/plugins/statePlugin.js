import { Plugin, PluginKey } from 'prosemirror-state'

export const statePlugin = (
    initialStateContent,
    dispatchUpdateCallback,
    dispatchLiveUpdateCallback,
    dispatchLocalTransactionCallback,
) => {
    const hasInProgressAiContent = (doc) => {
        let inProgress = false
        doc.descendants((node) => {
            const attrs = node.attrs || {}
            if (attrs.isReceivingAnimation || attrs.isStreaming || attrs.isPartial) {
                inProgress = true
                return false
            }
        })
        return inProgress
    }

    const isAiChatThreadDocument = (doc) => {
        let found = false
        doc.descendants((node) => {
            if (node.type.name !== 'aiChatThread') return
            found = true
            return false
        })
        return found
    }

    const applyPluginState = (tr) => {
        const skipDispatch = tr.getMeta('skipDispatch');
        // Live consumers (e.g. branch lineage markers) need to mirror the document
        // as it streams. Streamed AI tokens are dispatched with `skipDispatch` set
        // so they never persist — but those are exactly the transactions the live
        // preview must react to. This callback therefore fires on EVERY doc change,
        // ignoring `skipDispatch`, and must never persist: it is purely a read-only
        // projection of the live doc.
        if (tr.docChanged) {
            dispatchLiveUpdateCallback?.(tr.doc.toJSON());
        }
        if (!skipDispatch && tr.docChanged) {
            dispatchLocalTransactionCallback?.(tr);
        }
        // If the transaction has the 'skipDispatch' flag set, don't call the update callback
        if (!skipDispatch && !dispatchLocalTransactionCallback && tr.docChanged && !hasInProgressAiContent(tr.doc) && !isAiChatThreadDocument(tr.doc)) {
            dispatchUpdateCallback(tr.doc.toJSON());
        }
    }

    const initState = (config, state) => {
        // TODO: initialStateContent is not used anymore. Editor is initialized with doc property as initial content. This code could be redundant
        if (initialStateContent && Object.keys(initialStateContent).length > 0) {
            // Initialize the document with provided initial content
            return { doc: state.schema.nodeFromJSON(initialStateContent) };
        } else {
            // Return undefined to use default initial state
            return undefined;
        }
    }

    return new Plugin({
        key: new PluginKey('statePlugin'),
        state: {
            init: initState,
            apply: applyPluginState,
        },
    })
}
