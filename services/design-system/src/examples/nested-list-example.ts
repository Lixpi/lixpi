import {
    createNestedListItemView,
    findNestedListEntry,
    mountNestedList,
    type NestedListHandle,
} from '@lixpi/prosemirror/frontend/nested-list'
import {
    type NestedListDocumentJson,
} from '@lixpi/prosemirror/shared/nested-list'
import { html } from '@lixpi/ui-primitives/dom'

import { ExampleFrame } from './example-frame.ts'

const tags = {
    review: {
        name: 'In review',
        color: '#ad7fdb',
    },
    approved: {
        name: 'Approved',
        color: '#67ae8b',
    },
}

const initialDocument: NestedListDocumentJson = {
    type: 'doc',
    content: [
        {
            type: 'heading',
            attrs: {
                entryId: 'example-heading',
                level: 2,
            },
            content: [{
                type: 'text',
                text: 'Campaign materials',
            }],
        },
        {
            type: 'bullet_list',
            attrs: { entryId: 'example-list' },
            content: [
                {
                    type: 'list_item',
                    attrs: {
                        entryId: 'draft-note',
                        itemType: 'text',
                    },
                    content: [{
                        type: 'paragraph',
                        attrs: { entryId: 'draft-note-title' },
                        content: [{
                            type: 'text',
                            text: 'Draft the launch note',
                        }],
                    }],
                },
                {
                    type: 'list_item',
                    attrs: {
                        entryId: 'asset-brief',
                        itemType: 'catalog-asset',
                        data: { status: 'Editable Asset' },
                        tagIds: ['review'],
                    },
                    content: [
                        {
                            type: 'paragraph',
                            attrs: { entryId: 'asset-brief-title' },
                            content: [{
                                type: 'text',
                                text: 'Creative brief',
                            }],
                        },
                        {
                            type: 'bullet_list',
                            attrs: { entryId: 'asset-brief-children' },
                            content: [{
                                type: 'list_item',
                                attrs: {
                                    entryId: 'asset-reference',
                                    itemType: 'text',
                                },
                                content: [{
                                    type: 'paragraph',
                                    attrs: { entryId: 'asset-reference-title' },
                                    content: [{
                                        type: 'text',
                                        text: 'Review reference images',
                                    }],
                                }],
                            }],
                        },
                    ],
                },
                {
                    type: 'list_item',
                    attrs: {
                        entryId: 'asset-approved',
                        itemType: 'catalog-asset',
                        data: { status: 'Protected Asset' },
                        tagIds: ['approved'],
                    },
                    content: [{
                        type: 'paragraph',
                        attrs: { entryId: 'asset-approved-title' },
                        content: [{
                            type: 'text',
                            text: 'Approved poster',
                        }],
                    }],
                },
            ],
        },
    ],
}

export class NestedListExample {
    readonly frame: ExampleFrame
    private readonly list: NestedListHandle
    private savedDocument: unknown = initialDocument

    constructor(host: HTMLElement) {
        this.frame = new ExampleFrame(
            host,
            'This is the shared nested-list editor. Click an item to activate it, double click or press Edit list to change text, drag a row to move a subtree, or use the pencil to insert a block or change its style, and changes update this in-memory example. Click outside the editor to leave edit mode. The approved poster cannot be edited.',
        )
        const listHost = html`<div className="canvas-library-nested-list-example"></div>` as HTMLDivElement
        this.frame.stage.append(listHost)
        this.list = mountNestedList({
            container: listHost,
            document: initialDocument,
            tags,
            itemViews: {
                'catalog-asset': node => {
                    const status = (node.attrs.data as { status?: string } | null)?.status ?? 'Asset'
                    const badge = html`<span data-nested-list-control="true">${status}</span>` as HTMLElement

                    return createNestedListItemView(
                        node,
                        {
                            tags: () => tags,
                            controls: [badge],
                        },
                    )
                },
            },
            filterTransaction: (transaction, state) => {
                const before = findNestedListEntry(state.doc, 'asset-approved')?.node
                const after = findNestedListEntry(transaction.doc, 'asset-approved')?.node
                const allowed = Boolean(before && after && before.eq(after))

                if (!allowed)
                    this.frame.report('The approved poster is protected. Edit another item.')

                return allowed
            },
            onActivate: ({ entryId }) => this.frame.report(`Activated ${entryId}`),
            onModeChange: mode => this.frame.report(mode === 'edit' ? 'Editing the list.' : 'Viewing the list.'),
            onChange: ({ document }) => {
                this.savedDocument = document.toJSON()
                this.frame.report('Updated in this example session.')
            },
        })
        this.frame.button('Edit list', () => void this.list.enterEdit())
        this.frame.code(
            () => JSON.stringify(
                this.savedDocument,
                null,
                2,
            ),
        )
        this.frame.report('Viewing the list. Double click or press Edit list to edit.')
    }

    destroy(): void {
        this.list.destroy()
        this.frame.destroy()
    }
}
