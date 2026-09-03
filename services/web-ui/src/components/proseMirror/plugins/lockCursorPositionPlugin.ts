import {
    Plugin,
    PluginKey,
} from 'prosemirror-state'
import {
    type EditorView,
} from 'prosemirror-view'

const key = new PluginKey<boolean>('lockCursorPosition')

const createPlugin = (): Plugin<boolean> =>
    new Plugin({
        key,
        state: {
            init: () => false,
            apply: (_transaction, previousState: boolean) => previousState,
        },
        props: {
            handleDOMEvents: {
                mousedown: (_view: EditorView, event: MouseEvent): boolean => {
                    event.preventDefault()
                    return true
                },
            },
        },
    })

export default createPlugin
