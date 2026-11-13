import {
    applyStyle,
    html,
} from '@lixpi/ui-primitives/dom'
import { BubbleMenu } from '@lixpi/ui-kit/components/bubble-menu'
import {
    chevronDownIcon,
    heading1Icon,
    heading2Icon,
    heading3Icon,
    paragraphIcon,
    plusIcon,
    dragIcon,
    verticalTrippleDots,
} from '@lixpi/ui-kit/svg'
import {
    type EditorView,
} from 'prosemirror-view'
import {
    changeNestedListBlockStyle,
    insertNestedListBlockAfter,
    type NestedListBlockStyle,
} from './block-commands.ts'
import { findNestedListEntry } from './commands.ts'
import {
    type NestedListBlockContext,
    type NestedListBlockMenuItem,
    type NestedListPluginOptions,
} from './types.ts'

export type NestedListBlockTarget = NestedListBlockContext & { element: HTMLElement }
type Target = NestedListBlockTarget
const styles: Array<{
    label: string
    icon: string
    style: NestedListBlockStyle
}> = [
    {
        label: 'Text',
        icon: paragraphIcon,
        style: { type: 'paragraph' },
    },
    {
        label: 'Heading 1',
        icon: heading1Icon,
        style: {
            type: 'heading',
            level: 1,
        },
    },
    {
        label: 'Heading 2',
        icon: heading2Icon,
        style: {
            type: 'heading',
            level: 2,
        },
    },
    {
        label: 'Heading 3',
        icon: heading3Icon,
        style: {
            type: 'heading',
            level: 3,
        },
    },
]

export const resolveNestedListBlockTarget = (
    view: EditorView,
    element: Element,
): NestedListBlockTarget | undefined => {
    const block = element.closest<HTMLElement>('p, h1, h2, h3, .nested-list-item')

    if (
        !block
        || !view.dom.contains(block)
    )
        return undefined

    let isLabel = false

    if (block.matches('p, h1, h2, h3')) {
        try {
            const position = view.state.doc.resolve(
                view.posAtDOM(block, 0),
            )
            isLabel = position.depth > 0
                && position.parent.type.name === 'paragraph'
                && ['list_item', 'section'].includes(position.node(position.depth - 1).type.name)
                && position.index(position.depth - 1) === 0
        } catch {
            return undefined
        }
    }

    const target = isLabel ? (block.closest<HTMLElement>('.nested-list-item') ?? block) : block

    if (target.matches('.nested-list-item')) {
        const entryId = target.dataset.entryId
        const entry = entryId ? findNestedListEntry(view.state.doc, entryId) : undefined

        return entry?.node.firstChild ? {
            entryId: entryId!,
            node: entry.node,
            label: entry.node.firstChild,
            isListItem: true,
            element: target,
        } : undefined
    }

    try {
        const position = view.state.doc.resolve(
            view.posAtDOM(target, 0),
        )

        for (let depth = position.depth; depth > 0; depth -= 1) {
            const node = position.node(depth)

            if (
                (node.type.name === 'paragraph' || node.type.name === 'heading')
                && node.attrs.entryId
            )
                return {
                    entryId: String(node.attrs.entryId),
                    node,
                    label: node,
                    isListItem: false,
                    element: target,
                }
        }
    } catch {
        return undefined
    }

    return undefined
}

export class NestedListBlockControls {
    private readonly bubble: BubbleMenu
    private readonly trigger: HTMLButtonElement
    private readonly dragHandle: HTMLElement
    private readonly panel: HTMLElement
    private readonly toolbar: HTMLElement
    private styleMenu?: HTMLElement
    private styleToggle?: HTMLButtonElement
    private target?: Target
    private leaveTimer?: ReturnType<typeof setTimeout>
    private open = false

    constructor(
        private readonly view: EditorView,
        private readonly options: NestedListPluginOptions,
        private readonly onDragHandlePointerDown: (
            event: PointerEvent,
            target: Target,
        ) => void,
    ) {
        this.trigger = html`
            <button
                type="button"
                className="nested-list-block-trigger"
                aria-label="Block actions"
                aria-expanded="false"
                contenteditable="false"
                hidden
            ></button>
        ` as HTMLButtonElement
        this.trigger.innerHTML = verticalTrippleDots
        this.dragHandle = html`
            <span
                className="nested-list-block-drag-handle"
                data-nested-list-drag-handle="true"
                contenteditable="false"
                aria-hidden="true"
                hidden
            ></span>
        ` as HTMLElement
        this.dragHandle.innerHTML = dragIcon
        this.panel = html`
            <div
                className="bubble-menu-dropdown-menu nested-list-block-panel"
                role="menu"
                aria-label="Block actions"
                hidden
            ></div>
        ` as HTMLElement
        this.toolbar = html`<div className="nested-list-block-toolbar"></div>` as HTMLElement
        const parent = view.dom.parentElement as HTMLElement
        parent.append(this.dragHandle, this.trigger)
        this.bubble = new BubbleMenu({
            parentEl: view.dom.ownerDocument.body,
            items: [{
                element: this.toolbar,
                context: ['block'],
            }],
            panels: [this.panel],
            label: 'Block actions',
        })
        this.bubble.element.classList.add('nested-list-block-bubble')

        if (options.controlOwnerId)
            this.bubble.element.dataset.nestedListOwner = options.controlOwnerId

        this.dragHandle.addEventListener('pointerdown', this.dragPointerDown)
        this.dragHandle.addEventListener('pointerenter', this.cancelLeave)
        this.dragHandle.addEventListener('pointerleave', this.leave)
        this.trigger.addEventListener('pointerdown', this.preventFocus)
        this.trigger.addEventListener('mousedown', this.preventFocus)
        this.trigger.addEventListener('click', this.toggle)
        this.trigger.addEventListener('pointerenter', this.cancelLeave)
        this.trigger.addEventListener('pointerleave', this.leave)
        this.trigger.addEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.bubble.element.addEventListener('pointerenter', this.cancelLeave)
        this.bubble.element.addEventListener('pointerleave', this.leave)
        this.bubble.element.addEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        view.dom.addEventListener('pointermove', this.hover)
        view.dom.addEventListener('pointerleave', this.leave)
        view.dom.addEventListener('focusin', this.focusIn)
        view.dom.addEventListener('focusout', this.focusOut)
        view.dom.addEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        view.dom.ownerDocument.addEventListener(
            'pointerdown',
            this.outside,
            true,
        )
        view.dom.ownerDocument.addEventListener(
            'scroll',
            this.reposition,
            true,
        )
    }

    private anchor(): HTMLElement | undefined {
        if (!this.target)
            return undefined

        const entry = findNestedListEntry(this.view.state.doc, this.target.entryId)
        const label = entry
            && this.target.isListItem
            ? this.view.nodeDOM(entry.pos + 1)
            : undefined

        return label instanceof HTMLElement ? label : this.target.element
    }

    private position(): {
        targetRect: DOMRect
        placement: 'left'
        clampToParent: false
        animateOnShow: false
    } {
        return {
            targetRect: this.trigger.getBoundingClientRect(),
            placement: 'left',
            clampToParent: false,
            animateOnShow: false,
        }
    }

    private placeTrigger(): void {
        const anchor = this.anchor()

        if (!anchor)
            return

        const parent = this.view.dom.parentElement as HTMLElement
        const row = anchor.getBoundingClientRect()
        const frame = parent.getBoundingClientRect()
        const height = this.trigger.offsetHeight || 28
        this.trigger.style.top = `${row.top - frame.top + (row.height - height) / 2}px`
        this.trigger.hidden = false
    }

    private placeDragHandle(): void {
        const anchor = this.anchor()

        if (
            !anchor
            || !this.target
        ) {
            this.dragHandle.hidden = true

            return
        }

        const parent = this.view.dom.parentElement as HTMLElement
        const block = anchor.getBoundingClientRect()
        const frame = parent.getBoundingClientRect()
        const height = this.dragHandle.offsetHeight || 18
        this.dragHandle.style.top = `${block.top - frame.top + (block.height - height) / 2}px`
        this.dragHandle.hidden = false
    }

    private showFor(target: Target | undefined): void {
        if (
            !target
            || this.options.blockMenu?.(target) === null
        ) {
            this.hide()

            return
        }

        this.cancelLeave()

        if (this.target?.isListItem)
            this.target.element.removeAttribute('data-nested-list-hover')

        this.target = target

        if (target.isListItem)
            target.element.setAttribute('data-nested-list-hover', 'true')

        this.reposition()
    }

    private dragging(): boolean {
        return this.view.dom.closest<HTMLElement>('.nested-list')?.dataset.nestedListDragging === 'true'
    }

    private hover = (event: PointerEvent): void => {
        if (
            !this.open
            && !this.dragging()
        )
            this.showFor(
                event.target instanceof Element
                    ? resolveNestedListBlockTarget(this.view, event.target)
                    : undefined,
            )
    }

    private focusIn = (event: FocusEvent): void => {
        if (
            !this.open
            && !this.dragging()
        )
            this.showFor(
                event.target instanceof Element
                    ? resolveNestedListBlockTarget(this.view, event.target)
                    : undefined,
            )
    }

    private focusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget as Node | null

        if (
            !this.open
            && (!next || (!this.view.dom.contains(next) && !this.trigger.contains(next) && !this.bubble.element.contains(next)))
        )
            this.hide()
    }

    private cancelLeave = (): void => {
        if (this.leaveTimer)
            clearTimeout(this.leaveTimer)

        this.leaveTimer = undefined
    }

    private leave = (): void => {
        if (this.open)
            return

        this.cancelLeave()
        this.leaveTimer = setTimeout(() => this.hide(), 120)
    }

    private closePopup(): void {
        this.open = false
        this.panel.hidden = true
        this.panel.classList.remove('is-open')
        this.closeStyleMenu()
        this.trigger.setAttribute('aria-expanded', 'false')
        this.bubble.hide()
    }

    hide(): void {
        this.cancelLeave()
        this.closePopup()
        this.trigger.hidden = true
        this.dragHandle.hidden = true

        if (this.target?.isListItem)
            this.target.element.removeAttribute('data-nested-list-hover')

        this.target = undefined
    }

    private genericInsert = (target: Target): NestedListBlockMenuItem[] =>
        styles.map(
            ({
                label,
                icon,
                style,
            }) => ({
                label,
                icon,
                disabled: !insertNestedListBlockAfter(target.entryId, style)(this.view.state),
                onSelect: () => {
                    if (insertNestedListBlockAfter(target.entryId, style)(this.view.state, this.view.dispatch))
                        this.view.focus()
                },
            }),
        )

    private select(item: NestedListBlockMenuItem): void {
        if (item.disabled)
            return

        if (item.entersEdit !== false) {
            this.options.onEnterEdit?.()

            if (this.options.isEditable?.() === false)
                return
        }

        this.hide()
        void item.onSelect?.()
    }

    private iconButton(
        label: string,
        icon: string,
        action: () => void,
        iconSize = 16,
    ): HTMLButtonElement {
        const button = html`
            <button
                type="button"
                className="bubble-menu-button"
                aria-label=${label}
                data-help-tooltip="aria-label"
            ></button>
        ` as HTMLButtonElement
        button.innerHTML = icon
        const svg = button.querySelector('svg')

        if (svg)
            applyStyle(
                svg,
                {
                    width: `${iconSize}px`,
                    height: `${iconSize}px`,
                },
            )

        button.addEventListener('pointerdown', event => event.preventDefault())
        button.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            action()
        })

        return button
    }

    private closeStyleMenu(): void {
        this.styleMenu?.classList.remove('is-open')
        this.styleToggle?.setAttribute('aria-expanded', 'false')
    }

    private styleDropdown(target: Target): HTMLElement {
        const current = styles.find(
            option => option.style.type === target.label.type.name
                && (option.style.type !== 'heading' || option.style.level === target.label.attrs.level),
        ) ?? styles[0]
        const wrapper = html`<div className="bubble-menu-dropdown"></div>` as HTMLElement
        const toggle = html`
            <button
                type="button"
                className="bubble-menu-dropdown-toggle"
                aria-label="Change current style"
                aria-haspopup="menu"
                aria-expanded="false"
                data-help-tooltip="aria-label"
            ><span className="dropdown-label"></span></button>
        ` as HTMLButtonElement
        toggle.querySelector<HTMLElement>('.dropdown-label')!.innerHTML = current.icon
        toggle.insertAdjacentHTML('beforeend', chevronDownIcon)
        const menu = html`
            <div
                className="bubble-menu-dropdown-menu nested-list-block-style-menu"
                role="menu"
                aria-label="Text style"
            ></div>
        ` as HTMLElement

        for (const {
            label,
            icon,
            style,
        } of styles) {
            const checked = label === current.label
            const item: NestedListBlockMenuItem = {
                label,
                icon,
                checked,
                onSelect: () => {
                    if (changeNestedListBlockStyle(target.entryId, style)(this.view.state, this.view.dispatch))
                        this.view.focus()
                },
            }
            menu.append(
                this.button(item, () => this.select(item)),
            )
        }

        toggle.addEventListener('pointerdown', event => event.preventDefault())
        toggle.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            this.panel.hidden = true
            this.panel.classList.remove('is-open')
            const open = menu.classList.toggle('is-open')
            toggle.setAttribute(
                'aria-expanded',
                String(open),
            )
            this.placePanel()
        })
        wrapper.append(toggle, menu)
        this.styleMenu = menu
        this.styleToggle = toggle

        return wrapper
    }

    private renderRoot(target: Target): void {
        const extension = this.options.blockMenu?.(target)
        const insert = this.iconButton(
            'Insert new block',
            plusIcon,
            () => this.render(
                () => [
                    ...this.genericInsert(target),
                    ...(extension?.insert ?? []),
                ],
                [],
            ),
            12,
        )
        const controls: HTMLElement[] = [insert]

        if (!target.isListItem)
            controls.push(
                this.styleDropdown(target),
            )
        else {
            this.styleMenu = undefined
            this.styleToggle = undefined
        }

        if (extension?.actions?.length) {
            controls.push(html`<span className="bubble-menu-separator"></span>` as HTMLElement)
            controls.push(
                this.iconButton(
                    'More',
                    verticalTrippleDots,
                    () => this.render(() => extension.actions ?? [], []),
                ),
            )
        }

        this.toolbar.replaceChildren(...controls)
    }

    private viewport(): DOMRect {
        let current: HTMLElement | null = this.view.dom.parentElement
        const window = this.view.dom.ownerDocument.defaultView!

        while (current) {
            const overflow = window.getComputedStyle(current)

            if (
                overflow.overflowY === 'auto'
                || overflow.overflowY === 'scroll'
                || overflow.overflow === 'auto'
                || overflow.overflow === 'scroll'
            )
                return current.getBoundingClientRect()

            current = current.parentElement
        }

        return new DOMRect(
            0,
            0,
            window.innerWidth,
            window.innerHeight,
        )
    }

    private placePanel(): void {
        if (!this.open)
            return

        const active = this.styleMenu?.classList.contains('is-open')
            ? this.styleMenu
            : this.panel.classList.contains('is-open')
                ? this.panel
                : undefined

        if (!active)
            return

        const viewport = this.viewport()
        const toolbar = this.bubble.element.getBoundingClientRect()

        if (
            !viewport.height
            || !toolbar.height
        )
            return

        const below = Math.max(0, viewport.bottom - toolbar.bottom - 4)
        const above = Math.max(0, toolbar.top - viewport.top - 4)
        const aboveIsBetter = below < active.scrollHeight && above > below
        const space = aboveIsBetter ? above : below
        active.classList.toggle('nested-list-block-panel-above', aboveIsBetter)
        active.style.maxHeight = `${Math.min(288, space)}px`
    }

    private render(
        source: () => NestedListBlockMenuItem[],
        trail: Array<() => NestedListBlockMenuItem[]>,
    ): void {
        this.closeStyleMenu()
        const back = trail.length
            ? [this.button(
                { label: 'Back' },
                () => this.render(
                    trail.at(-1)!,
                    trail.slice(0, -1),
                ),
            )]
            : []
        const items = source()
        this.panel.classList.toggle('nested-list-block-panel-text', back.length > 0 || items.some(item => !item.icon))
        const rows = items.map(
            item => this.button(
                item,
                () => {
                    if (item.children) {
                        this.render(item.children, [...trail, source])

                        return
                    }

                    this.select(item)
                },
            ),
        )
        this.panel.replaceChildren(...back, ...rows)
        this.panel.hidden = false
        this.panel.classList.add('is-open')
        this.placePanel()
    }

    private button(
        item: NestedListBlockMenuItem,
        action: () => void,
    ): HTMLButtonElement {
        const button = html`
            <button
                type="button"
                className=${item.icon ? 'bubble-menu-dropdown-item nested-list-block-icon-item' : 'nested-list-block-menu-item'}
                role="menuitem"
                aria-label=${item.label}
            ></button>
        ` as HTMLButtonElement
        button.disabled = Boolean(item.disabled)

        if (item.icon) {
            button.innerHTML = item.icon
            button.dataset.helpTooltip = 'aria-label'
            button.classList.toggle(
                'is-active',
                Boolean(item.checked),
            )
        } else
            button.textContent = item.checked ? `✓ ${item.label}` : item.label

        button.addEventListener('pointerdown', event => event.preventDefault())
        button.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            action()
        })

        return button
    }

    private preventFocus = (event: Event): void => void event.preventDefault()

    private dragPointerDown = (event: PointerEvent): void => {
        const target = this.target

        if (target) {
            this.onDragHandlePointerDown(event, target)

            if (this.open)
                this.closePopup()
        }
    }

    private toggle = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()

        if (this.open) {
            const returnFocus = this.bubble.element.contains(this.view.dom.ownerDocument.activeElement)
            this.closePopup()

            if (returnFocus)
                this.trigger.focus({ preventScroll: true })

            return
        }

        const target = this.target

        if (!target)
            return

        this.renderRoot(target)
        this.open = true
        this.trigger.setAttribute('aria-expanded', 'true')
        this.bubble.show(
            'block',
            this.position(),
        )
        this.placePanel()
        this.view.dom.blur()
        this.bubble.element.focus({ preventScroll: true })
    }

    private reposition = (): void => {
        if (!this.target)
            return

        if (!this.view.dom.contains(this.target.element)) {
            this.hide()

            return
        }

        this.placeTrigger()
        this.placeDragHandle()

        if (this.open) {
            this.bubble.reposition(
                this.position(),
            )
            this.placePanel()
        }
    }

    private outside = (event: PointerEvent): void => {
        if (
            this.open
            && !this.bubble.element.contains(event.target as Node)
            && !this.trigger.contains(event.target as Node)
            && !this.dragHandle.contains(event.target as Node)
        )
            this.hide()
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (
            event.key === 'F10'
            && event.shiftKey
        ) {
            const target = (
                event.target instanceof Element
                    ? resolveNestedListBlockTarget(this.view, event.target)
                    : undefined
            ) ?? this.target

            if (!target)
                return

            event.preventDefault()
            event.stopImmediatePropagation()
            this.showFor(target)

            if (!this.open)
                this.toggle(event)

            return
        }

        if (event.key !== 'Escape')
            return

        const editing = this.options.isEditable?.() ?? false

        if (
            !this.open
            && (!editing || !this.options.onExitEdit)
        )
            return

        event.preventDefault()
        event.stopImmediatePropagation()

        if (this.open) {
            const fromPopup = this.bubble.element.contains(event.target as Node)
            this.closePopup()

            if (fromPopup)
                this.trigger.focus()
        }

        if (editing)
            this.options.onExitEdit?.()
    }

    update(): void {
        this.reposition()
    }

    destroy(): void {
        this.hide()
        this.dragHandle.removeEventListener('pointerdown', this.dragPointerDown)
        this.dragHandle.removeEventListener('pointerenter', this.cancelLeave)
        this.dragHandle.removeEventListener('pointerleave', this.leave)
        this.trigger.removeEventListener('pointerdown', this.preventFocus)
        this.trigger.removeEventListener('mousedown', this.preventFocus)
        this.trigger.removeEventListener('click', this.toggle)
        this.trigger.removeEventListener('pointerenter', this.cancelLeave)
        this.trigger.removeEventListener('pointerleave', this.leave)
        this.trigger.removeEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.bubble.element.removeEventListener('pointerenter', this.cancelLeave)
        this.bubble.element.removeEventListener('pointerleave', this.leave)
        this.bubble.element.removeEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.view.dom.removeEventListener('pointermove', this.hover)
        this.view.dom.removeEventListener('pointerleave', this.leave)
        this.view.dom.removeEventListener('focusin', this.focusIn)
        this.view.dom.removeEventListener('focusout', this.focusOut)
        this.view.dom.removeEventListener(
            'keydown',
            this.keyDown,
            true,
        )
        this.view.dom.ownerDocument.removeEventListener(
            'pointerdown',
            this.outside,
            true,
        )
        this.view.dom.ownerDocument.removeEventListener(
            'scroll',
            this.reposition,
            true,
        )
        this.bubble.destroy()
        this.dragHandle.remove()
        this.trigger.remove()
    }
}
