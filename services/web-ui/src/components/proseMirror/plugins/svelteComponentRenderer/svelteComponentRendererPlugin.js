import { Plugin, PluginKey } from 'prosemirror-state'
import { SvelteComponentRenderer } from '$src/components/proseMirror/plugins/svelteComponentRenderer/svelteComponentRenderer.js'

export const createSvelteComponentRendererPlugin = (SvelteComponent, nodeName, defaultAttrs = {}) => {
    const key = new PluginKey(nodeName)

    const state = {
        init: () => ({ attrs: defaultAttrs }),
        apply: (tr, prev) => {
            const attrs = tr.getMeta(nodeName); //TODO this doesn't do anything
            return attrs ? { attrs } : prev;
        }
    }

    const appendTransaction = (transactions, oldState, newState) => {
        const transaction = transactions.find(tr => tr.getMeta(`insert:${nodeName}`));
        if (transaction) {
            const attrs = transaction.getMeta(`insert:${nodeName}`);
            const nodeType = newState.schema.nodes[nodeName];
            const taskNode = nodeType.create(attrs);
            const { $from, $to } = newState.selection;
            return newState.tr.replaceWith($from.pos, $to.pos, taskNode);
        }
    }

    const props = {
        nodeViews: {
            [nodeName]: (node, view, getPos, decorations) => {
                const nodeDom = SvelteComponentRenderer.create(node, SvelteComponent, node.attrs);
                return {
                    dom: nodeDom,
                    destroy: () => SvelteComponentRenderer.destroy(node),
                }
            }
        }
    }

    return new Plugin({ key, state, appendTransaction, props });
}
