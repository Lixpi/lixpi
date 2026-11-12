import {
    Plugin,
    PluginKey,
} from 'prosemirror-state'
import { ImageNodeView } from './image-node-view.ts'
import {
    type RichEditingPorts,
} from '../rich-editing-ports.ts'

export const imageSelectionPluginKey = new PluginKey('imageSelection')

export const imageSelectionPlugin = (ports: RichEditingPorts): Plugin => {
    return new Plugin({
        key: imageSelectionPluginKey,
        props: {
            nodeViews: {
                image(
                    node,
                    view,
                    getPos,
                ) {
                    return new ImageNodeView({
                        ports,
                        node,
                        view,
                        getPos: getPos as () => number | undefined,
                    })
                },
                aiGeneratedImage(
                    node,
                    view,
                    getPos,
                ) {
                    return new ImageNodeView({
                        ports,
                        node,
                        view,
                        getPos: getPos as () => number | undefined,
                    })
                },
            },
        },
    })
}
