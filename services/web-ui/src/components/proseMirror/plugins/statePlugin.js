import { Plugin, PluginKey } from 'prosemirror-state'

export const statePlugin = (initialStateContent, dispatchUpdateCallback, documentTitleChangeCallback) => {
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

    const applyPluginState = (tr, _, oldState) => {
        const skipDispatch = tr.getMeta('skipDispatch');
        // If the transaction has the 'skipDispatch' flag set, don't call the update callback
        if (!skipDispatch && tr.docChanged && !hasInProgressAiContent(tr.doc)) {
            dispatchUpdateCallback(tr.doc.toJSON());

            // Check if 'documentTitle' node's content has changed
            const oldTitle = oldState.doc.firstChild.textContent;
            const newTitle = tr.doc.firstChild.textContent;

            if (newTitle !== oldTitle) {
                documentTitleChangeCallback(newTitle);
            }
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
