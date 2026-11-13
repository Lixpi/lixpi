import {
    Plugin,
    PluginKey,
    TextSelection,
    type Transaction,
    type Command,
} from 'prosemirror-state'
import { html } from '@lixpi/ui-primitives/dom'
import { chevronDownIcon } from '@lixpi/ui-kit/svg'
import {
    Decoration,
    DecorationSet,
    type EditorView,
    type NodeView,
    type NodeViewConstructor,
} from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import {
    baseKeymap,
    chainCommands,
    liftEmptyBlock,
} from 'prosemirror-commands'
import {
    history,
    isHistoryTransaction,
    undo,
    redo,
} from 'prosemirror-history'
import {
    liftListItem,
    sinkListItem,
    wrapInList,
} from 'prosemirror-schema-list'
import {
    inputRules,
    wrappingInputRule,
    InputRule,
} from 'prosemirror-inputrules'
import {
    assertNestedListDocument,
    identifyNestedListDocument,
    preservesNestedListBoundaries,
} from '../../../shared/nested-list.ts'
import { NestedListItemView } from './item-view.ts'
import { NestedListAutoScroll } from './auto-scroll.ts'
import { NestedListDragPreview } from './drag-preview.ts'
import {
    isNestedListMoveTransaction,
    moveNestedListBlock,
} from './block-move.ts'
import {
    NestedListBlockControls,
    resolveNestedListBlockTarget,
    type NestedListBlockTarget,
} from './block-controls.ts'
import {
    findNestedListEntry,
    identifyNestedListTransaction,
    splitNestedListBodyBlock,
    splitNestedListItem,
} from './commands.ts'
import {
    type NestedListPluginOptions,
    type NestedListMove,
} from './types.ts'
import {
    type Schema,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'

export const nestedListPluginKey = new PluginKey('nestedList')

const collapseDecorations = (doc: ProseMirrorNode): DecorationSet => {
    const widgets: Decoration[] = []

    doc.descendants((node, pos) => {
        if (
            node.type.name !== 'list_item'
            && node.type.name !== 'section'
        )
            return

        let hasChildren = node.type.name === 'section' && node.childCount > 1

        for (let index = 1; index < node.childCount; index += 1)
            if (node.child(index).type.name === 'bullet_list') {
                hasChildren = true

                break
            }

        if (!hasChildren)
            return

        const label = node.firstChild

        if (
            !label
            || label.type.name !== 'paragraph'
        )
            return

        widgets.push(
            Decoration.widget(
                pos + label.nodeSize,
                () => {
                    const button = html`
                        <button
                            type="button"
                            className="nested-list-collapse"
                            data-nested-list-collapse="true"
                            contenteditable="false"
                            aria-label="Expand or collapse"
                        ></button>
                    ` as HTMLButtonElement
                    button.innerHTML = chevronDownIcon

                    return button
                },
                {
                    key: `nested-list-collapse:${node.attrs.entryId}`,
                    side: 1,
                    stopEvent: () => true,
                },
            ),
        )
    })

    return DecorationSet.create(doc, widgets)
}

class ItemView implements NodeView {
    readonly dom: Node
    readonly contentDOM?: HTMLElement
    private node: ProseMirrorNode
    private readonly inner: NodeView

    constructor(
        node: ProseMirrorNode,
        factory: NodeViewConstructor | undefined,
        args: Parameters<NodeViewConstructor>,
        private readonly instances: Set<ItemView>,
        options: NestedListPluginOptions,
    ) {
        this.node = node
        this.inner = factory ? factory(...args) : new NestedListItemView(node, { tags: options.tags })

        if (this.inner.setSelection)
            this.setSelection = this.inner.setSelection.bind(this.inner)

        if (this.inner.selectNode)
            this.selectNode = this.inner.selectNode.bind(this.inner)

        if (this.inner.deselectNode)
            this.deselectNode = this.inner.deselectNode.bind(this.inner)

        this.dom = this.inner.dom

        if (
            !(this.dom instanceof HTMLElement)
            || this.dom.tagName !== (node.type.name === 'section' ? 'SECTION' : 'LI')
            || !this.inner.contentDOM
        )
            throw new Error('Custom nested list views must provide their node root and editable contentDOM')

        this.contentDOM = this.inner.contentDOM

        if (this.dom instanceof HTMLElement) {
            this.dom.dataset.entryId = String(node.attrs.entryId)
            this.dom.dataset.itemType = String(node.attrs.itemType)
            this.dom.classList.add('nested-list-item')
        }

        instances.add(this)
    }

    update: NonNullable<NodeView['update']> = (
        node,
        decorations,
        innerDecorations,
    ) => {
        if (
            node.type !== this.node.type
            || node.attrs.itemType !== this.node.attrs.itemType
        )
            return false

        if (this.inner.update ? !this.inner.update(
            node,
            decorations,
            innerDecorations,
        ) : !node.eq(this.node))
            return false

        this.node = node

        if (this.dom instanceof HTMLElement)
            this.dom.dataset.entryId = String(node.attrs.entryId)

        return true
    }

    refresh(): void {
        const inner = this.inner as NodeView & { refresh?: () => void }
        inner.refresh?.()
    }

    selectNode?: NodeView["selectNode"]
    deselectNode?: NodeView["deselectNode"]
    setSelection?: NodeView["setSelection"]
    stopEvent = (event: Event): boolean => this.inner.stopEvent?.(event) ?? false
    ignoreMutation: NonNullable<NodeView["ignoreMutation"]> = mutation => {
        if (this.inner.ignoreMutation)
            return this.inner.ignoreMutation(mutation)

        return mutation.type !== 'selection' && !this.contentDOM?.contains(mutation.target)
    }
    destroy = (): void => {
        this.instances.delete(this)
        this.inner.destroy?.()
    }
}

class NestedListEvents {
    private suppressClick = false
    private suppressDoubleClick = false
    private pending?: {
        entryId: string
        element: HTMLElement
        x: number
        y: number
        pointerId: number
        dragging: boolean
    }
    private drop?: NestedListMove
    private dragPreview?: NestedListDragPreview
    private indicator?: HTMLElement
    private preview?: {
        entryId: string
        placement: NestedListMove['placement']
        element: HTMLElement
        doc: ProseMirrorNode
    }
    private readonly autoScroll: NestedListAutoScroll

    constructor(
        private readonly view: EditorView,
        private readonly options: NestedListPluginOptions,
        private readonly hideControls: () => void,
    ) {
        this.autoScroll = new NestedListAutoScroll(
            view.dom.ownerDocument.defaultView!,
            () => options.scrollContainer?.() ?? view.dom.parentElement,
            (x, y) => this.resolveDrop(x, y),
        )
        view.dom.addEventListener(
            'click',
            this.suppressDragClick,
            true,
        )
        view.dom.addEventListener('click', this.click)
        view.dom.addEventListener('dblclick', this.doubleClick)
        view.dom.addEventListener('keydown', this.keyDown)
        view.dom.addEventListener('pointerdown', this.pointerDown)
        view.dom.addEventListener(
            'dragstart',
            this.nativeDragStart,
            true,
        )
    }

    private entry(target: EventTarget | null): HTMLElement | undefined {
        const row = (target as HTMLElement | null)?.closest?.<HTMLElement>('.nested-list-item')

        return row
            && this.view.dom.contains(row)
            ? row
            : undefined
    }

    private activate(
        row: HTMLElement,
        event: MouseEvent | KeyboardEvent,
    ): void {
        const entry = findNestedListEntry(this.view.state.doc, row.dataset.entryId!)

        if (entry)
            this.options.onActivate?.({
                entryId: row.dataset.entryId!,
                node: entry.node,
                event,
            })
    }

    private editable(): boolean {
        return this.options.isEditable?.() ?? !this.options.readOnly
    }

    private interactive(target: Element): boolean {
        const control = target.closest('button, a, input, select, textarea, [role="button"], [data-nested-list-control], [contenteditable="false"]')

        return Boolean(control && control !== this.view.dom)
    }

    private suppressDragClick = (event: MouseEvent): void => {
        if (!this.suppressClick)
            return

        this.suppressClick = false
        event.preventDefault()
        event.stopImmediatePropagation()
    }

    private click = (event: MouseEvent): void => {
        const row = this.entry(event.target)
        const target = event.target as HTMLElement

        if (!row)
            return

        if (target.closest('[data-nested-list-collapse]')) {
            event.preventDefault()
            const id = row.dataset.entryId!
            this.options.onCollapseChange?.(id, !this.options.collapsed?.().has(id))

            return
        }

        if (this.interactive(target))
            return

        if (this.editable()) {
            if (
                event.metaKey
                || event.ctrlKey
            ) {
                event.preventDefault()
                this.activate(row, event)
            }

            return
        }

        event.preventDefault()

        // The second click of a double click belongs to edit mode, so only
        // the first one navigates.
        if (
            this.options.readOnly
            || event.metaKey
            || event.ctrlKey
            || event.detail < 2
        )
            this.activate(row, event)
    }

    private doubleClick = (event: MouseEvent): void => {
        if (this.suppressDoubleClick) {
            event.preventDefault()
            event.stopPropagation()

            return
        }

        if (
            this.options.readOnly
            || this.interactive(event.target as HTMLElement)
        )
            return

        if (this.editable())
            return

        this.options.onEnterEdit?.()

        if (!this.editable())
            return

        const { state } = this.view
        const row = this.entry(event.target)
        const entry = row ? findNestedListEntry(state.doc, row.dataset.entryId!) : undefined
        let position: number | undefined

        try {
            position = this.view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
            })?.pos
        } catch {
            // A detached/zero-layout host can still focus the clicked item.
        }

        if (
            position === undefined
            && !entry
        ) {
            const block = (event.target as HTMLElement).closest('p, h1, h2, h3')

            if (
                block
                && this.view.dom.contains(block)
            )
                position = this.view.posAtDOM(block, 0)
        }

        position ??= entry ? entry.pos + 2 : state.selection.from
        this.view.dispatch(
            state.tr.setSelection(
                TextSelection.near(
                    state.doc.resolve(
                        Math.max(
                            0,
                            Math.min(position, state.doc.content.size),
                        ),
                    ),
                ),
            ),
        )
        this.view.focus()
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented)
            return

        if (this.editable())
            return

        if (
            event.key === 'Enter'
            || event.key === ' '
        ) {
            const row = this.entry(event.target)

            if (row) {
                event.preventDefault()
                this.activate(row, event)
            }
        }
    }

    private overText(
        element: HTMLElement,
        x: number,
        y: number,
    ): boolean {
        const document = this.view.dom.ownerDocument
        const walker = document.createTreeWalker(element, 4)
        const range = document.createRange()
        let text: Node | null

        while ((text = walker.nextNode())) {
            range.selectNodeContents(text)

            for (const rect of Array.from(
                range.getClientRects(),
            ))
                if (
                    x >= rect.left
                    && x <= rect.right
                    && y >= rect.top
                    && y <= rect.bottom
                )
                    return true
        }

        return false
    }

    private startDrag(
        event: PointerEvent,
        block: NestedListBlockTarget,
        explicitHandle: boolean,
    ): void {
        if (
            this.options.readOnly
            || block.node.type.name === 'section'
            || event.button !== 0
            || (this.editable() && !explicitHandle && this.overText(
                block.element,
                event.clientX,
                event.clientY,
            ))
        )
            return

        if (
            !this.editable()
            || explicitHandle
        )
            event.preventDefault()

        this.suppressClick = false
        this.suppressDoubleClick = false
        this.cancelDrag()
        this.pending = {
            entryId: block.entryId,
            element: block.element,
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            dragging: false,
        }
        const document = this.view.dom.ownerDocument
        document.addEventListener('pointermove', this.pointerMove)
        document.addEventListener('pointerup', this.pointerUp)
        document.addEventListener('pointercancel', this.pointerCancel)
        document.addEventListener(
            'keydown',
            this.dragKeyDown,
            true,
        )
        document.defaultView?.addEventListener('blur', this.cancelDrag)
    }

    beginDragFromHandle(
        event: PointerEvent,
        block: NestedListBlockTarget,
    ): void {
        if (this.view.dom.contains(block.element))
            this.startDrag(
                event,
                block,
                true,
            )
    }

    private pointerDown = (event: PointerEvent): void => {
        this.suppressClick = false
        this.suppressDoubleClick = false
        const target = event.target

        if (
            !(target instanceof Element)
            || this.interactive(target)
        )
            return

        const block = resolveNestedListBlockTarget(this.view, target)

        if (block)
            this.startDrag(
                event,
                block,
                false,
            )
    }

    private pointerMove = (event: PointerEvent): void => {
        const pending = this.pending

        if (
            !pending
            || event.pointerId !== pending.pointerId
        )
            return

        if (
            !pending.dragging
            && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 4
        )
            return

        if (!pending.dragging) {
            pending.dragging = true
            this.suppressClick = true
            this.suppressDoubleClick = true
            this.dragPreview = new NestedListDragPreview(
                pending.element,
                this.view.dom,
                pending.x,
                pending.y,
                event.clientX,
                event.clientY,
            )
            const root = this.view.dom.closest<HTMLElement>('.nested-list')

            if (root)
                root.dataset.nestedListDragging = 'true'

            this.hideControls()
        }

        event.preventDefault()
        this.dragPreview?.update(event.clientX, event.clientY)
        this.resolveDrop(event.clientX, event.clientY)
        this.autoScroll.update(event.clientX, event.clientY)
    }

    private targetBounds(target: NestedListBlockTarget): DOMRect {
        const entry = findNestedListEntry(this.view.state.doc, target.entryId)
        const label = target.isListItem
            && entry
            ? this.view.nodeDOM(entry.pos + 1)
            : target.element

        const bounds = (label instanceof HTMLElement ? label : target.element).getBoundingClientRect()

        if (!target.isListItem)
            return bounds

        const row = target.element.getBoundingClientRect()

        return new DOMRect(
            row.left,
            bounds.top,
            row.width,
            bounds.height,
        )
    }

    private containsPointer(
        rect: DOMRect,
        x: number,
        y: number,
    ): boolean {
        return rect.width > 0 && rect.height > 0
            && x >= rect.left && x <= rect.right
            && y >= rect.top && y <= rect.bottom
    }

    private localGapDrop(
        element: Element | null,
        x: number,
        y: number,
    ): {
        target: NestedListBlockTarget
        placement: 'before' | 'after' | 'inside'
    } | undefined {
        if (
            !element
            || !this.view.dom.contains(element)
        )
            return undefined

        const seen = new Set<string>()
        const rows: Array<{
            target: NestedListBlockTarget
            rect: DOMRect
        }> = []

        for (const label of this.view.dom.querySelectorAll('p, h1, h2, h3')) {
            const target = resolveNestedListBlockTarget(this.view, label)

            if (
                !target
                || seen.has(target.entryId)
                || this.pending?.element.contains(target.element)
            )
                continue

            const collapsed = target.element.parentElement?.closest('.nested-list-collapsed')

            if (collapsed)
                continue

            const rect = this.targetBounds(target)

            if (
                rect.width <= 0
                || rect.height <= 0
                || x < rect.left
                || x > rect.right
            )
                continue

            seen.add(target.entryId)
            rows.push({
                target,
                rect,
            })
        }

        const hit = rows.find(
            row => this.containsPointer(
                row.rect,
                x,
                y,
            ),
        )

        if (hit) {
            const ratio = (y - hit.rect.top) / hit.rect.height

            return {
                target: hit.target,
                placement: hit.target.isListItem
                    ? ratio < 0.25
                        ? 'before'
                        : ratio > 0.75
                            ? 'after'
                            : 'inside'
                    : ratio < 0.5
                        ? 'before'
                        : 'after',
            }
        }

        const before = rows.filter(row => row.rect.bottom < y).sort((left, right) => right.rect.bottom - left.rect.bottom)[0]
        const after = rows.filter(row => row.rect.top > y).sort((left, right) => left.rect.top - right.rect.top)[0]

        if (
            !before
            || !after
        )
            return undefined

        const beforeEnd = before.target.element.getBoundingClientRect().bottom

        return beforeEnd <= y
            && y - beforeEnd < after.rect.top - y
            ? {
                target: before.target,
                placement: 'after',
            }
            : {
                target: after.target,
                placement: 'before',
            }
    }

    private blankEdgeDrop(
        element: Element | null,
        x: number,
        y: number,
    ): {
        target: NestedListBlockTarget
        placement: 'before' | 'after'
    } | undefined {
        const editor = this.view.dom

        if (
            element !== editor
            && element !== editor.parentElement
        )
            return undefined

        const bounds = editor.getBoundingClientRect()

        if (
            x < bounds.left
            || x > bounds.right
            || y < bounds.top
            || y > bounds.bottom
        )
            return undefined

        const blocks = [...editor.children].filter(
            (child): child is HTMLElement =>
                child instanceof HTMLElement
                && child.matches('p, h1, h2, h3, ul, section.nested-list-section'),
        )
        const first = blocks[0]
        const last = blocks.at(-1)

        if (
            !first
            || !last
        )
            return undefined

        const before = y <= first.getBoundingClientRect().top
        const after = y >= last.getBoundingClientRect().bottom

        if (
            !before
            && !after
        )
            return undefined

        const edge = before ? first : last
        const block = edge.matches('ul')
            ? before
                ? edge.querySelector<HTMLElement>(':scope > li.nested-list-item')
                : [...edge.querySelectorAll<HTMLElement>(':scope > li.nested-list-item')].at(-1)
            : edge
        const target = block
            ? resolveNestedListBlockTarget(this.view, block)
            : undefined

        return target ? {
            target,
            placement: before ? 'before' : 'after',
        } : undefined
    }

    private edgeDescendant(
        target: NestedListBlockTarget,
        placement: 'before' | 'after',
    ): NestedListBlockTarget | undefined {
        if (
            !target.isListItem
            || target.element.classList.contains('nested-list-collapsed')
        )
            return undefined

        const index = placement === 'before'
            ? 1
            : target.node.childCount - 1

        if (index < 1)
            return undefined

        const child = target.node.child(index)
        const edge = child.type.name === 'bullet_list'
            ? placement === 'before'
                ? child.firstChild
                : child.lastChild
            : child
        const entryId = edge?.attrs.entryId

        if (typeof entryId !== 'string')
            return undefined

        const entry = findNestedListEntry(this.view.state.doc, entryId)
        const element = entry ? this.view.nodeDOM(entry.pos) : undefined

        return element instanceof HTMLElement
            ? resolveNestedListBlockTarget(this.view, element)
            : undefined
    }

    private clearPreview(): void {
        this.indicator?.removeAttribute('data-nested-list-drop')
        this.indicator = undefined
        this.preview = undefined
        this.drop = undefined
    }

    private resolveDrop(
        x: number,
        y: number,
    ): void {
        const pending = this.pending

        if (!pending?.dragging)
            return

        const source = pending.element.getBoundingClientRect()
        const editor = this.view.dom.getBoundingClientRect()
        const sourceBounds = new DOMRect(
            editor.left,
            source.top,
            editor.width,
            source.height,
        )

        if (this.containsPointer(
            sourceBounds,
            x,
            y,
        )) {
            this.clearPreview()

            return
        }

        const element = this.view.dom.ownerDocument.elementFromPoint(x, y)
        const hit = element instanceof Element
            ? resolveNestedListBlockTarget(this.view, element)
            : undefined
        const direct = hit
            && this.containsPointer(
                this.targetBounds(hit),
                x,
                y,
            )
            ? hit
            : undefined
        const local = direct ? undefined : this.localGapDrop(
            element,
            x,
            y,
        )
        const edge = direct
            || local
            ? undefined
            : this.blankEdgeDrop(
                element,
                x,
                y,
            )
        const origin = direct
            ?? local?.target
            ?? edge?.target

        if (
            !origin
            || origin.entryId === pending.entryId
        ) {
            this.clearPreview()

            return
        }

        const entry = findNestedListEntry(this.view.state.doc, origin.entryId)

        if (!entry) {
            this.clearPreview()

            return
        }

        const rect = this.targetBounds(origin)
        const ratio = rect.height ? (y - rect.top) / rect.height : 0.5
        const placement = local?.placement
            ?? edge?.placement
            ?? (
            origin.isListItem
                ? ratio < 0.25
                    ? 'before'
                    : ratio > 0.75
                        ? 'after'
                        : 'inside'
                : ratio < 0.5
                    ? 'before'
                    : 'after'
        )

        if (
            this.preview?.entryId === origin.entryId
            && this.preview.placement === placement
            && this.preview.element === origin.element
            && this.preview.doc === this.view.state.doc
        )
            return

        this.clearPreview()
        this.preview = {
            entryId: origin.entryId,
            placement,
            element: origin.element,
            doc: this.view.state.doc,
        }
        let target: NestedListBlockTarget | undefined = origin

        while (target) {
            if (target.entryId === pending.entryId)
                return

            const move: NestedListMove = {
                entryId: pending.entryId,
                targetEntryId: target.entryId,
                placement,
            }
            let candidate: Transaction | undefined
            moveNestedListBlock(move)(this.view.state, transaction => void (candidate = transaction))

            if (
                candidate
                && this.options.filterTransaction?.(candidate, this.view.state) !== false
            ) {
                this.drop = move
                this.indicator = target.element
                target.element.dataset.nestedListDrop = placement

                return
            }

            target = edge ? this.edgeDescendant(target, edge.placement) : undefined
        }
    }

    private pointerUp = (event: PointerEvent): void => {
        if (
            !this.pending
            || event.pointerId !== this.pending.pointerId
        )
            return

        const dragging = this.pending.dragging

        if (dragging)
            this.resolveDrop(event.clientX, event.clientY)

        const move = this.drop
        this.cancelDrag()

        if (dragging)
            event.preventDefault()

        if (move)
            moveNestedListBlock(move)(
                this.view.state,
                transaction => {
                    if (this.options.filterTransaction?.(transaction, this.view.state) !== false)
                        this.view.dispatch(transaction)
                },
            )
    }

    private pointerCancel = (event: PointerEvent): void => {
        if (event.pointerId === this.pending?.pointerId)
            this.cancelDrag()
    }

    private nativeDragStart = (event: DragEvent): void => {
        if (!this.pending)
            return

        if (this.pending.dragging) {
            event.preventDefault()
            event.stopImmediatePropagation()
        } else
            this.cancelDrag()
    }

    private dragKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape')
            return

        const target = event.target
        const document = this.view.dom.ownerDocument
        const root = this.view.dom.closest('.nested-list')
        const bubble = target instanceof Element
            ? target.closest<HTMLElement>('.nested-list-block-bubble')
            : undefined
        const ownPortal = Boolean(
            this.options.controlOwnerId
            && bubble?.dataset.nestedListOwner === this.options.controlOwnerId,
        )

        if (
            target instanceof Node
            && target !== document
            && target !== document.body
            && !this.view.dom.contains(target)
            && !root?.contains(target)
            && !ownPortal
        )
            return

        event.preventDefault()
        event.stopImmediatePropagation()
        this.cancelDrag()

        if (this.editable())
            this.options.onExitEdit?.()
    }

    private cancelDrag = (): void => {
        this.autoScroll.stop()
        const document = this.view.dom.ownerDocument
        document.removeEventListener('pointermove', this.pointerMove)
        document.removeEventListener('pointerup', this.pointerUp)
        document.removeEventListener('pointercancel', this.pointerCancel)
        document.removeEventListener(
            'keydown',
            this.dragKeyDown,
            true,
        )
        document.defaultView?.removeEventListener('blur', this.cancelDrag)
        this.dragPreview?.destroy()
        this.dragPreview = undefined
        this.view.dom.closest('.nested-list')?.removeAttribute('data-nested-list-dragging')
        this.clearPreview()
        this.pending = undefined
    }

    update(documentChanged: boolean): void {
        if (
            documentChanged
            && this.pending
        )
            this.cancelDrag()
    }

    destroy(): void {
        this.cancelDrag()
        this.view.dom.removeEventListener(
            'click',
            this.suppressDragClick,
            true,
        )
        this.view.dom.removeEventListener('click', this.click)
        this.view.dom.removeEventListener('dblclick', this.doubleClick)
        this.view.dom.removeEventListener('keydown', this.keyDown)
        this.view.dom.removeEventListener('pointerdown', this.pointerDown)
        this.view.dom.removeEventListener(
            'dragstart',
            this.nativeDragStart,
            true,
        )
    }
}

class NestedListPlugin {
    private readonly instances = new Set<ItemView>()
    private transactions: Transaction[] = []

    constructor(private readonly options: NestedListPluginOptions) {}

    create(): Plugin {
        return new Plugin({
            key: nestedListPluginKey,
            state: {
                init: () => null,
                apply: transaction => {
                    this.transactions.push(transaction)

                    return null
                },
            },
            filterTransaction: (transaction, state) => {
                if (!transaction.docChanged)
                    return true

                if (
                    this.options.readOnly
                    || (this.options.isEditable?.() === false && !isNestedListMoveTransaction(transaction))
                )
                    return false

                try {
                    // Temporary missing plain IDs are normalized below. Custom
                    // duplicates remain invalid instead of becoming new bindings.
                    assertNestedListDocument(
                        identifyNestedListDocument(transaction.doc),
                    )
                } catch {
                    return false
                }

                if (
                    !isNestedListMoveTransaction(transaction)
                    && !isHistoryTransaction(transaction)
                    && !preservesNestedListBoundaries(state.doc, transaction.doc)
                )
                    return false

                return this.options.filterTransaction?.(transaction, state) !== false
            },
            appendTransaction: (
                transactions,
                _oldState,
                state,
            ) => {
                if (!transactions.some(transaction => transaction.docChanged))
                    return null

                const tr = identifyNestedListTransaction(state.tr)

                return tr.docChanged ? tr : null
            },
            props: {
                decorations: state => collapseDecorations(state.doc),
                handlePaste: (
                    view,
                    _event,
                    slice,
                ) => {
                    const { $from } = view.state.selection
                    let inItem = false

                    for (let depth = $from.depth; depth > 0; depth -= 1)
                        if ($from.node(depth).type.name === 'list_item')
                            inItem = true

                    if (!inItem)
                        return false

                    let standaloneBlocks = 0
                    let heading = false
                    slice.content.forEach(node => {
                        if (node.type.name === 'heading')
                            heading = true

                        if (node.isTextblock)
                            standaloneBlocks += 1
                    })

                    return heading || standaloneBlocks > 1
                },
                editable: () => !this.options.readOnly && (this.options.isEditable?.() ?? true),
                attributes: {
                    class: 'nested-list-document',
                    'data-side-panel-no-drag': '',
                },
                nodeViews: {
                    section: (...args) => new ItemView(
                        args[0],
                        this.options.itemViews?.[args[0].attrs.itemType],
                        args,
                        this.instances,
                        this.options,
                    ),
                    list_item: (...args) => new ItemView(
                        args[0],
                        this.options.itemViews?.[args[0].attrs.itemType],
                        args,
                        this.instances,
                        this.options,
                    ),
                },
            },
            view: view => {
                let controls: NestedListBlockControls | undefined
                const events = new NestedListEvents(
                    view,
                    this.options,
                    () => controls?.hide(),
                )
                controls = this.options.readOnly
                    ? undefined
                    : new NestedListBlockControls(
                        view,
                        this.options,
                        (event, target) => events.beginDragFromHandle(event, target),
                    )

                return {
                    update: (current, previous) => {
                        const transactions = this.transactions.splice(0)

                        for (const instance of this.instances)
                            instance.refresh()

                        events.update(!previous.doc.eq(current.state.doc))
                        controls?.update()

                        if (!previous.doc.eq(current.state.doc))
                            this.options.onChange?.({
                                previous: previous.doc,
                                document: current.state.doc,
                                transactions,
                            })
                    },
                    destroy: () => {
                        events.destroy()
                        controls?.destroy()
                    },
                }
            },
        })
    }
}

// Retains each selected block's identity and formatting. The installed stock
// command accepts one attrs object for the entire selection.
const setSelectedBlockType = (
    schema: Schema,
    name: 'paragraph' | 'heading',
    level?: number,
): Command =>
(state, dispatch) => {
    const tr = state.tr
    const visited = new Set<number>()
    const type = schema.nodes[name]

    for (const range of state.selection.ranges)
        state.doc.nodesBetween(
            range.$from.pos,
            range.$to.pos,
            (node, pos) => {
                if (
                    !node.isTextblock
                    || visited.has(pos)
                )
                    return

                visited.add(pos)
                const at = state.doc.resolve(pos)

                if (
                    (at.parent.type.name === 'list_item' || at.parent.type.name === 'section')
                    && at.index() === 0
                )
                    return

                const attrs = {
                    entryId: node.attrs.entryId,
                    bold: node.attrs.bold,
                    ...(level ? { level } : {}),
                }

                if (
                    !node.hasMarkup(type, attrs)
                    && at.parent.canReplaceWith(
                        at.index(),
                        at.index() + 1,
                        type,
                    )
                )
                    tr.setNodeMarkup(
                        pos,
                        type,
                        attrs,
                    )
            },
        )

    if (!tr.docChanged)
        return false

    dispatch?.(
        tr.scrollIntoView(),
    )

    return true
}

const enterCustomNestedListItem = (options: NestedListPluginOptions): Command =>
(
    state,
    dispatch,
    view,
) => {
    const { $from } = state.selection

    if (
        $from.parent.type.name !== 'paragraph'
        || $from.depth < 2
        || $from.node(-1).type.name !== 'list_item'
        || $from.index(-1) !== 0
    )
        return false

    const handler = options.itemEnter?.[$from.node(-1).attrs.itemType]

    if (
        !handler
        || options.readOnly
        || options.isEditable?.() === false
    )
        return false

    if (dispatch)
        handler(
            state,
            dispatch,
            view,
        )

    return true
}

const splitNestedListItemWithGuard = (options: NestedListPluginOptions): Command =>
(state, dispatch) => {
    if (!options.filterTransaction)
        return splitNestedListItem(state, dispatch)

    let candidate: Transaction | undefined
    const handled = splitNestedListItem(state, transaction => void (candidate = transaction))

    if (
        !handled
        || !candidate
        || options.filterTransaction(candidate, state) === false
    )
        return false

    dispatch?.(candidate)

    return true
}

// The plugins also work in a caller-owned EditorState/EditorView.
export const createNestedListPlugins = (
    schema: Schema,
    options: NestedListPluginOptions = {},
): Plugin[] => [
    new NestedListPlugin(options).create(),
    keymap({
        Enter: chainCommands(
            enterCustomNestedListItem(options),
            splitNestedListBodyBlock,
            splitNestedListItemWithGuard(options),
            liftEmptyBlock,
        ),
        Tab: sinkListItem(schema.nodes.list_item),
        'Shift-Tab': liftListItem(schema.nodes.list_item),
        'Mod-[': liftListItem(schema.nodes.list_item),
        'Mod-]': sinkListItem(schema.nodes.list_item),
        'Mod-z': undo,
        'Shift-Mod-z': redo,
        'Mod-y': redo,
        'Mod-Shift-8': wrapInList(schema.nodes.bullet_list),
        'Mod-Alt-0': setSelectedBlockType(schema, 'paragraph'),
        'Mod-Alt-1': setSelectedBlockType(
            schema,
            'heading',
            1,
        ),
        'Mod-Alt-2': setSelectedBlockType(
            schema,
            'heading',
            2,
        ),
        'Mod-Alt-3': setSelectedBlockType(
            schema,
            'heading',
            3,
        ),
    }),
    inputRules({ rules: [
        wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
        new InputRule(
            /^(#{1,3})\s$/,
            (
                state,
                match,
                start,
                end,
            ) => {
                const at = state.doc.resolve(start)

                if (!at.node(-1).canReplaceWith(
                    at.index(-1),
                    at.indexAfter(-1),
                    schema.nodes.heading,
                ))
                    return null

                return state.tr.delete(start, end).setBlockType(
                    start,
                    start,
                    schema.nodes.heading,
                    {
                        entryId: at.parent.attrs.entryId,
                        bold: at.parent.attrs.bold,
                        level: match[1].length,
                    },
                )
            },
        ),
    ] }),
    keymap(baseKeymap),
    history(),
]
