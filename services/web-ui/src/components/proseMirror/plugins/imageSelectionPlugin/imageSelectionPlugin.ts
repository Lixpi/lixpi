import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { ImageNodeView } from '$src/components/proseMirror/plugins/imageSelectionPlugin/imageNodeView.ts'

export const imageSelectionPluginKey = new PluginKey('imageSelection')

export function imageSelectionPlugin(): Plugin {
    return new Plugin({
        key: imageSelectionPluginKey,

        props: {
            nodeViews: {
                image(node, view, getPos) {
                    return new ImageNodeView({
                        node,
                        view,
                        getPos: getPos as () => number | undefined
                    })
                },
                aiGeneratedImage(node, view, getPos) {
                    return new ImageNodeView({
                        node,
                        view,
                        getPos: getPos as () => number | undefined
                    })
                }
            }
        }
    })
}
