import { keymap } from 'prosemirror-keymap'
import {
    type DocumentViewFeature,
} from '@lixpi/prosemirror/frontend/document-view'

import { bubbleMenuPlugin } from './bubble-menu/bubble-menu-plugin.ts'
import { imageSelectionPlugin } from './image-selection/image-selection-plugin.ts'
import { buildInputRules } from './input-rules.ts'
import { buildKeymap } from './keymap.ts'
import { linkTooltipPlugin } from './link-tooltip/link-tooltip-plugin.ts'
import {
    type RichEditingPorts,
} from './rich-editing-ports.ts'

// The part of a view's context the rich-editing features read.
export type RichEditingContext = {
    richEditing: RichEditingPorts
}

export const bubbleMenuFeature: DocumentViewFeature<RichEditingContext> = {
    id: 'bubble-menu',
    create: ({ context }) => ({ plugins: [bubbleMenuPlugin(context.richEditing.downloadImage)] }),
}

export const linkTooltipFeature: DocumentViewFeature<unknown> = {
    id: 'link-tooltip',
    create: () => ({ plugins: [linkTooltipPlugin()] }),
}

export const imageSelectionFeature: DocumentViewFeature<RichEditingContext> = {
    id: 'image-selection',
    create: ({ context }) => ({ plugins: [imageSelectionPlugin(context.richEditing)] }),
}

export const inputRulesFeature: DocumentViewFeature<unknown> = {
    id: 'input-rules',
    create: ({ schema }) => ({ plugins: [buildInputRules(schema)] }),
}

// Formatting, list, history and block shortcuts.
export const richKeymapFeature: DocumentViewFeature<unknown> = {
    id: 'rich-keymap',
    create: ({ schema }) => ({ plugins: [keymap(
        buildKeymap(schema),
    )] }),
}
