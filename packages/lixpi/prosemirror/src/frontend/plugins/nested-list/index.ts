import { html } from '@lixpi/ui-primitives/dom'
import {
    EditorState,
    Selection,
    type Plugin,
} from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    createNestedListSchema,
    emptyNestedListDocument,
    parseNestedListDocument,
} from '../../../shared/nested-list.ts'
import { createNestedListPlugins } from './plugins.ts'
import { moveNestedListBlock } from './block-move.ts'
import {
    type MountNestedListOptions,
    type NestedListHandle,
    type NestedListMode,
    type NestedListMove,
    type NestedListTag,
} from './types.ts'

export { createNestedListPlugins } from './plugins.ts'
export { moveNestedListBlock } from './block-move.ts'
export {
    changeNestedListBlockStyle,
    insertNestedListBlockAfter,
    toggleNestedListBlockBold,
    type NestedListBlockStyle,
} from './block-commands.ts'
export {
    createNestedListItemView,
    NestedListItemView,
    type NestedListItemViewOptions,
} from './item-view.ts'
export {
    findNestedListEntry,
    deleteNestedListItem,
    insertNestedListBlockBefore,
    moveNestedListItem,
    splitNestedListItem,
    type NestedListTextBlock,
} from './commands.ts'
export {
    type MountNestedListOptions,
    type NestedListHandle,
    type NestedListMode,
    type NestedListMove,
    type NestedListChange,
    type NestedListActivation,
    type NestedListPluginOptions,
    type NestedListTag,
    type NestedListBlockContext,
    type NestedListBlockMenuItem,
    type NestedListBlockMenuExtension,
} from './types.ts'

class NestedList implements NestedListHandle {
    readonly view: EditorView
    private readonly root: HTMLElement
    private readonly editor: HTMLElement
    private readonly plugins: Plugin[]
    private readonly controlOwnerId = crypto.randomUUID()
    private currentMode: NestedListMode = 'view'
    private destroyed = false
    private syncing = false
    private tags: Readonly<Record<string, NestedListTag>>
    private collapsedIds: Set<string>
    private activeId?: string

    constructor(private readonly options: MountNestedListOptions) {
        const schema = createNestedListSchema()
        const initial = parseNestedListDocument(options.document ?? emptyNestedListDocument(), schema)
        this.tags = options.tags ?? {}
        this.collapsedIds = new Set(options.collapsed)
        this.root = html`<div className="nested-list"></div>` as HTMLElement
        this.editor = html`<div className="nested-list-editor"></div>` as HTMLElement
        this.root.append(this.editor)
        options.container.appendChild(this.root)
        this.plugins = createNestedListPlugins(
            schema,
            {
                scrollContainer: options.scrollContainer,
                readOnly: options.readOnly,
                isEditable: () => this.currentMode === 'edit',
                controlOwnerId: this.controlOwnerId,
                itemViews: options.itemViews,
                itemEnter: options.itemEnter,
                blockMenu: options.blockMenu,
                tags: () => this.tags,
                collapsed: () => this.collapsedIds,
                onCollapseChange: (entryId, collapsed) => {
                    if (collapsed)
                        this.collapsedIds.add(entryId)
                    else
                        this.collapsedIds.delete(entryId)

                    this.reflect()
                    options.onCollapseChange?.(entryId, collapsed)
                },
                filterTransaction: options.filterTransaction,
                onChange: change => {
                    this.reflect()

                    if (!this.syncing)
                        options.onChange?.(change)
                },
                onActivate: options.onActivate,
                onEnterEdit: () => void this.enterEdit(),
                onExitEdit: () => {
                    this.exitEdit()
                    this.view.dom.blur()
                },
            },
        )
        this.view = new EditorView(
            this.editor,
            {
                state: EditorState.create({
                    doc: initial,
                    plugins: this.plugins,
                }),
                dispatchTransaction: transaction => {
                    const applied = this.view.state.applyTransaction(transaction)

                    if (applied.transactions.length) {
                        this.view.updateState(applied.state)
                        this.reflect()
                    }
                },
            },
        )
        this.editor.addEventListener('dblclick', this.enterFromEmptyArea)
        this.root.ownerDocument.addEventListener(
            'pointerdown',
            this.exitOnOutsidePointer,
            true,
        )
        this.root.ownerDocument.addEventListener(
            'mousedown',
            this.suppressBlankSurfaceMouseDown,
            true,
        )
        this.reflect()
    }

    get mode(): NestedListMode {
        return this.currentMode
    }
    get collapsed(): ReadonlySet<string> {
        return new Set(this.collapsedIds)
    }

    private reflect(): void {
        this.root.dataset.mode = this.currentMode
        this.root.dataset.navigation = String(
            Boolean(this.options.onActivate),
        )
        this.root.dataset.readOnly = String(
            Boolean(this.options.readOnly),
        )

        if (!this.view)
            return

        for (const row of this.view.dom.querySelectorAll<HTMLElement>('.nested-list-item')) {
            const id = row.dataset.entryId!
            row.classList.toggle(
                'nested-list-collapsed',
                this.collapsedIds.has(id),
            )
            row.classList.toggle('nested-list-active', id === this.activeId)
            row.classList.remove('nested-list-active-ancestor')
            row.setAttribute(
                'aria-expanded',
                String(!this.collapsedIds.has(id)),
            )

            if (this.currentMode === 'view')
                row.tabIndex = 0
            else
                row.removeAttribute('tabindex')
        }

        const active = [...this.view.dom.querySelectorAll<HTMLElement>('.nested-list-item')].find(row => row.dataset.entryId === this.activeId)
        let parent = active?.parentElement?.closest<HTMLElement>('.nested-list-item')

        while (parent) {
            parent.classList.add('nested-list-active-ancestor')
            parent = parent.parentElement?.closest<HTMLElement>('.nested-list-item')
        }
    }

    private enterFromEmptyArea = (event: MouseEvent): void => {
        if (
            event.defaultPrevented
            || event.target !== this.editor
            || !this.enterEdit()
        )
            return

        const { state } = this.view
        this.view.dispatch(
            state.tr.setSelection(
                Selection.atEnd(state.doc),
            ),
        )
        this.view.focus()
    }

    enterEdit = (): boolean => {
        if (
            this.options.readOnly
            || this.destroyed
        )
            return false

        if (this.currentMode === 'edit')
            return true

        this.currentMode = 'edit'
        this.view.setProps({})
        this.reflect()
        this.options.onModeChange?.('edit')

        return true
    }

    private replace(doc: ProseMirrorNode): void {
        this.syncing = true

        try {
            this.view.updateState(
                EditorState.create({
                    doc,
                    plugins: this.plugins,
                }),
            )
        } finally {
            this.syncing = false
        }
    }

    exitEdit = (): boolean => {
        if (
            this.currentMode !== 'edit'
            || this.destroyed
        )
            return false

        this.currentMode = 'view'
        this.view.setProps({})
        this.reflect()
        this.options.onModeChange?.('view')

        return true
    }

    private isBlankSurface(target: EventTarget | null): boolean {
        return target === this.root
            || target === this.editor
            || target === this.view.dom
    }

    private suppressBlankSurfaceMouseDown = (event: MouseEvent): void => {
        if (!this.isBlankSurface(event.target))
            return

        event.preventDefault()
        event.stopPropagation()
    }

    private exitOnOutsidePointer = (event: PointerEvent): void => {
        if (this.currentMode !== 'edit')
            return

        const target = event.target

        if (!(target instanceof Node))
            return

        if (this.isBlankSurface(target)) {
            event.preventDefault()
            event.stopPropagation()
            this.exitEdit()
            this.view.dom.blur()

            return
        }

        if (this.root.contains(target))
            return

        const bubble = target instanceof Element
            ? target.closest<HTMLElement>('.nested-list-block-bubble')
            : undefined

        if (bubble?.dataset.nestedListOwner === this.controlOwnerId)
            return

        this.exitEdit()
        this.view.dom.blur()
    }

    setDocument = (json: unknown): 'applied' | 'unchanged' | 'deferred' => {
        const next = parseNestedListDocument(json, this.view.state.schema)

        if (next.eq(this.view.state.doc))
            return 'unchanged'

        if (this.currentMode === 'edit')
            return 'deferred'

        this.replace(next)
        this.reflect()

        return 'applied'
    }

    setTags = (tags: Readonly<Record<string, NestedListTag>>): void => {
        this.tags = tags
        this.view.updateState(this.view.state)
    }
    setActive = (entryId: string | undefined): void => {
        this.activeId = entryId
        this.reflect()
    }
    setCollapsed = (ids: Iterable<string>): void => {
        this.collapsedIds = new Set(ids)
        this.reflect()
    }
    move = (move: NestedListMove): boolean => {
        if (
            this.options.readOnly
            || !moveNestedListBlock(move)(this.view.state)
        )
            return false

        const before = this.view.state.doc
        moveNestedListBlock(move)(this.view.state, this.view.dispatch)

        return !this.view.state.doc.eq(before)
    }
    destroy = (): void => {
        this.destroyed = true
        this.editor.removeEventListener('dblclick', this.enterFromEmptyArea)
        this.root.ownerDocument.removeEventListener(
            'pointerdown',
            this.exitOnOutsidePointer,
            true,
        )
        this.root.ownerDocument.removeEventListener(
            'mousedown',
            this.suppressBlankSurfaceMouseDown,
            true,
        )
        this.view.destroy()
        this.root.remove()
    }
}

export const mountNestedList = (options: MountNestedListOptions): NestedListHandle => new NestedList(options)
