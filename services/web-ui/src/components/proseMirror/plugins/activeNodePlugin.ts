import {
    Plugin,
    PluginKey,
} from 'prosemirror-state'
import {
    type Attrs,
} from 'prosemirror-model'

type ActiveNodePluginState = {
    nodeType: string | null
    nodeAttrs: Attrs
}

export const pluginKey = new PluginKey<ActiveNodePluginState>('activeNodePlugin')

export const activeNodePlugin = new Plugin<ActiveNodePluginState>({
    key: pluginKey,
    state: {
        init: () => ({
            nodeType: null,
            nodeAttrs: {},
        }),
        apply: (
            _transaction,
            value,
            _oldState,
            newState,
        ) => {
            const nodeType = newState.selection.$from.parent.type.name
            const nodeAttrs = newState.selection.$from.parent.attrs

            if (
                value.nodeType !== nodeType
                || JSON.stringify(value.nodeAttrs) !== JSON.stringify(nodeAttrs)
            )
                return {
                    nodeType,
                    nodeAttrs,
                }

            return value
        },
    },
})
