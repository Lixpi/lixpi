import { html } from '@lixpi/ui-primitives/dom'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    type NodeView,
} from 'prosemirror-view'
import {
    type NestedListTag,
} from './types.ts'

export type NestedListItemViewOptions = {
    tags?: () => Readonly<Record<string, NestedListTag>>
    // Consumer-owned controls stay outside the editable content.
    controls?: HTMLElement[]
}

// Custom item factories can reuse this shell and its ordinary contentDOM.
export class NestedListItemView implements NodeView {
    readonly dom: HTMLElement
    readonly contentDOM: HTMLDivElement
    private readonly tags: HTMLDivElement

    constructor(
        private node: ProseMirrorNode,
        private readonly options: NestedListItemViewOptions = {},
    ) {
        this.dom = node.type.name === 'section'
            ? html`<section className="nested-list-item nested-list-section"></section>` as HTMLElement
            : html`<li className="nested-list-item"></li>` as HTMLLIElement
        this.contentDOM = html`<div className="nested-list-item-content"></div>` as HTMLDivElement
        this.tags = html`
            <div
                className="nested-list-tags"
                contenteditable="false"
            ></div>
        ` as HTMLDivElement
        const controls = html`
            <span
                className="nested-list-controls"
                contenteditable="false"
            ></span>
        ` as HTMLElement
        controls.append(...(options.controls ?? []))
        const underlay = html`
            <span
                className="nested-list-item-row-underlay"
                aria-hidden="true"
            ></span>
        ` as HTMLElement
        const chrome = html`
            <span
                className="nested-list-item-chrome"
                contenteditable="false"
            ></span>
        ` as HTMLElement
        chrome.append(this.tags, controls)
        this.dom.append(
            underlay,
            this.contentDOM,
            chrome,
        )
        this.refresh()
    }

    refresh(): void {
        this.dom.dataset.entryId = String(this.node.attrs.entryId)
        this.dom.dataset.itemType = String(this.node.attrs.itemType)
        this.tags.replaceChildren(
            ...(this.node.attrs.tagIds as string[]).flatMap(id => {
                const tag = this.options.tags?.()[id]

                if (!tag)
                    return []

                const element = html`<span className="nested-list-tag">${tag.name}</span>` as HTMLElement
                element.style.setProperty('--nested-list-tag-color', tag.color)

                return [element]
            }),
        )
        this.tags.hidden = this.tags.childElementCount === 0
    }

    update(node: ProseMirrorNode): boolean {
        if (
            node.type !== this.node.type
            || node.attrs.itemType !== this.node.attrs.itemType
        )
            return false

        this.node = node
        this.refresh()

        return true
    }

    stopEvent(event: Event): boolean {
        const target = event.target as HTMLElement | null

        return Boolean(target && !this.contentDOM.contains(target))
    }

    ignoreMutation(mutation: MutationRecord | { type: 'selection' }): boolean {
        if (mutation.type === 'selection')
            return false

        return !this.contentDOM.contains(mutation.target)
    }
}

export const createNestedListItemView = (
    node: ProseMirrorNode,
    options: NestedListItemViewOptions = {},
): NestedListItemView => new NestedListItemView(node, options)
