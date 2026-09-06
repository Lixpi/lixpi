import {
    Plugin,
    PluginKey,
    type Transaction,
} from 'prosemirror-state'
import {
    type EditorView,
} from 'prosemirror-view'

const key = new PluginKey<boolean>('focus')

const setFocus = (
    view: EditorView,
    isFocused: boolean,
    callback: (isFocused: boolean) => void,
): boolean => {
    view.dispatch(
        view.state.tr.setMeta(key, isFocused),
    )
    callback(isFocused)

    return false
}

const createPlugin = (callback: (isFocused: boolean) => void): Plugin<boolean> => {
    const handleDOMEvents = {
        blur: (view: EditorView): boolean => setFocus(
            view,
            false,
            callback,
        ),
        focus: (view: EditorView): boolean => setFocus(
            view,
            true,
            callback,
        ),
    }
    const applyPluginState = (
        transaction: Transaction,
        previousFocus: boolean,
    ): boolean => {
        const focused = transaction.getMeta(key)

        return typeof focused === 'boolean' ? focused : previousFocus
    }

    return new Plugin({
        key,
        state: {
            init: () => false,
            apply: applyPluginState,
        },
        props: { handleDOMEvents },
    })
}

export default createPlugin
