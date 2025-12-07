import type { EditorView } from 'prosemirror-view'
import type { Schema } from 'prosemirror-model'
import { toggleMark, wrapIn, setBlockType } from 'prosemirror-commands'
import { createEl } from '../../components/domTemplates.ts'
import {
    boldIcon,
    italicIcon,
    strikethroughIcon,
    inlineCodeIcon,
    codeBlockIcon,
    blockquoteIcon,
    linkIcon,
    chevronDownIcon,
    paragraphIcon,
    heading1Icon,
    heading2Icon,
    heading3Icon,
} from '../../../../svgIcons/index.ts'

type BubbleMenuView = {
    showLinkInput: () => void
    closeLinkInput: () => void
    applyLink: (href: string) => void
    removeLink: () => void
}

type Command = (state: EditorView['state'], dispatch?: EditorView['dispatch']) => boolean

// =============================================================================
// MENU CONFIGURATION
// =============================================================================
// Edit this array to add/remove/reorder menu items.
// Each item is either a button, separator, or dropdown.
// Icon sizes are normalized here to ensure visual consistency.

const MENU_ITEMS = [
    // Text type dropdown
    {
        type: 'dropdown' as const,
        key: 'textType',
        defaultIcon: paragraphIcon,
        options: [
            { icon: paragraphIcon, node: 'paragraph' },
            { icon: heading1Icon, node: 'heading', attrs: { level: 1 } },
            { icon: heading2Icon, node: 'heading', attrs: { level: 2 } },
            { icon: heading3Icon, node: 'heading', attrs: { level: 3 } },
        ],
    },

    { type: 'separator' as const },

    // Mark buttons (inline formatting)
    { type: 'mark' as const, key: 'bold', mark: 'strong', icon: boldIcon, title: 'Bold (Ctrl+B)', iconSize: 14 },
    { type: 'mark' as const, key: 'italic', mark: 'em', icon: italicIcon, title: 'Italic (Ctrl+I)', iconSize: 13 },
    { type: 'mark' as const, key: 'strikethrough', mark: 'strikethrough', icon: strikethroughIcon, title: 'Strikethrough', iconSize: 15 },
    { type: 'mark' as const, key: 'link', mark: 'link', icon: linkIcon, title: 'Link', iconSize: 15, action: 'showLinkInput' as const },
    { type: 'mark' as const, key: 'inlineCode', mark: 'code', icon: inlineCodeIcon, title: 'Inline Code', iconSize: 16 },

    { type: 'separator' as const },

    // Block buttons
    { type: 'block' as const, key: 'codeBlock', node: 'code_block', icon: codeBlockIcon, title: 'Code Block', iconSize: 17 },
    { type: 'blockWrap' as const, key: 'blockquote', node: 'blockquote', icon: blockquoteIcon, title: 'Blockquote', iconSize: 17 },
]

// =============================================================================
// IMPLEMENTATION (no need to edit below unless adding new item types)
// =============================================================================

type MenuItem =
    | { type: 'separator' }
    | { type: 'dropdown'; key: string; defaultIcon: string; options: Array<{ icon: string; node: string; attrs?: Record<string, unknown> }> }
    | { type: 'mark'; key: string; mark: string; icon: string; title: string; iconSize: number; action?: 'showLinkInput' }
    | { type: 'block'; key: string; node: string; icon: string; title: string; iconSize: number }
    | { type: 'blockWrap'; key: string; node: string; icon: string; title: string; iconSize: number }

function getMarkCommand(schema: Schema, markName: string): Command | null {
    const markType = schema.marks[markName]
    return markType ? (state, dispatch) => toggleMark(markType)(state, dispatch) : null
}

function getBlockCommand(schema: Schema, nodeName: string): Command | null {
    const nodeType = schema.nodes[nodeName]
    return nodeType ? (state, dispatch) => setBlockType(nodeType)(state, dispatch) : null
}

function getBlockWrapCommand(schema: Schema, nodeName: string): Command | null {
    const nodeType = schema.nodes[nodeName]
    return nodeType ? (state, dispatch) => wrapIn(nodeType)(state, dispatch) : null
}

function createButton(
    item: { key: string; icon: string; title: string; iconSize: number; action?: 'showLinkInput' },
    command: Command | null,
    view: EditorView,
    bubbleMenuView: BubbleMenuView,
    markType?: string
): HTMLElement | null {
    if (!command) return null

    const button = createEl('button', {
        className: 'bubble-menu-button',
        type: 'button',
        title: item.title,
        innerHTML: item.icon,
    })

    // Apply icon size normalization inline
    const svg = button.querySelector('svg')
    if (svg) {
        svg.style.width = `${item.iconSize}px`
        svg.style.height = `${item.iconSize}px`
    }

    if (markType) {
        button.dataset.markType = markType
        button.dataset.update = 'true'
    }

    button.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()

        if (item.action === 'showLinkInput') {
            bubbleMenuView.showLinkInput()
        } else {
            command(view.state, view.dispatch)
        }

        view.focus()
    })

    return button
}

function createSeparator(): HTMLElement {
    return createEl('span', { className: 'bubble-menu-separator' })
}

function createDropdown(
    item: { key: string; defaultIcon: string; options: Array<{ icon: string; node: string; attrs?: Record<string, unknown> }> },
    view: EditorView
): { element: HTMLElement; update: () => void } {
    const { schema } = view.state
    const menu = createEl('div', { className: 'bubble-menu-dropdown-menu' })

    const labelSpan = createEl('span', { className: 'dropdown-label', innerHTML: item.defaultIcon })

    const optionButtons: Array<{ btn: HTMLElement; node: string; attrs?: Record<string, unknown> }> = []

    item.options.forEach((opt) => {
        const nodeType = schema.nodes[opt.node]
        if (!nodeType) return

        const btn = createEl('button', {
            className: 'bubble-menu-dropdown-item',
            type: 'button',
            innerHTML: opt.icon,
        })

        optionButtons.push({ btn, node: opt.node, attrs: opt.attrs })

        btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            setBlockType(nodeType, opt.attrs)(view.state, view.dispatch)
            view.focus()
            menu.classList.remove('is-open')
        })

        menu.appendChild(btn)
    })

    const toggle = createEl('button', {
        className: 'bubble-menu-dropdown-toggle',
        type: 'button',
    })
    toggle.appendChild(labelSpan)
    toggle.insertAdjacentHTML('beforeend', chevronDownIcon)

    const wrapper = createEl('div', { className: 'bubble-menu-dropdown' }, toggle, menu)

    toggle.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        menu.classList.toggle('is-open')
    })

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target as Node)) {
            menu.classList.remove('is-open')
        }
    })

    const update = (): void => {
        const { state } = view
        const { $from } = state.selection
        const parentNode = $from.parent

        let currentIcon = item.defaultIcon
        for (const opt of item.options) {
            if (parentNode.type.name === opt.node) {
                if (opt.attrs) {
                    const attrsMatch = Object.entries(opt.attrs).every(
                        ([key, value]) => parentNode.attrs[key] === value
                    )
                    if (attrsMatch) {
                        currentIcon = opt.icon
                        break
                    }
                } else {
                    currentIcon = opt.icon
                    break
                }
            }
        }

        labelSpan.innerHTML = currentIcon

        // Update active state on dropdown items
        for (const { btn, node, attrs } of optionButtons) {
            let isActive = parentNode.type.name === node
            if (isActive && attrs) {
                isActive = Object.entries(attrs).every(
                    ([key, value]) => parentNode.attrs[key] === value
                )
            }
            btn.classList.toggle('is-active', isActive)
        }
    }

    return { element: wrapper, update }
}

function createLinkInputPanel(view: EditorView, bubbleMenuView: BubbleMenuView): HTMLElement {
    const input = createEl('input', {
        type: 'url',
        placeholder: 'Enter URL...',
        className: 'link-input-field',
    }) as HTMLInputElement

    const applyButton = createEl('button', {
        className: 'link-input-apply',
        type: 'button',
        innerHTML: 'Apply',
    })

    const removeButton = createEl('button', {
        className: 'link-input-remove',
        type: 'button',
        innerHTML: 'Remove',
    })

    applyButton.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        bubbleMenuView.applyLink(input.value)
    })

    removeButton.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        bubbleMenuView.removeLink()
    })

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            bubbleMenuView.applyLink(input.value)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            bubbleMenuView.closeLinkInput()
            view.focus()
        }
    })

    return createEl('div', { className: 'bubble-menu-link-input' }, input, applyButton, removeButton)
}

export function buildBubbleMenuItems(
    view: EditorView,
    bubbleMenuView: BubbleMenuView
): { items: HTMLElement[]; linkInputPanel: HTMLElement; dropdownUpdaters: Array<() => void> } {
    const { schema } = view.state
    const items: HTMLElement[] = []
    const dropdownUpdaters: Array<() => void> = []

    for (const item of MENU_ITEMS as MenuItem[]) {
        switch (item.type) {
            case 'separator':
                items.push(createSeparator())
                break

            case 'dropdown': {
                const { element, update } = createDropdown(item, view)
                items.push(element)
                dropdownUpdaters.push(update)
                break
            }

            case 'mark': {
                const cmd = getMarkCommand(schema, item.mark)
                const btn = createButton(item, cmd, view, bubbleMenuView, item.mark)
                if (btn) items.push(btn)
                break
            }

            case 'block': {
                const cmd = getBlockCommand(schema, item.node)
                const btn = createButton(item, cmd, view, bubbleMenuView)
                if (btn) items.push(btn)
                break
            }

            case 'blockWrap': {
                const cmd = getBlockWrapCommand(schema, item.node)
                const btn = createButton(item, cmd, view, bubbleMenuView)
                if (btn) items.push(btn)
                break
            }
        }
    }

    return { items, linkInputPanel: createLinkInputPanel(view, bubbleMenuView), dropdownUpdaters }
}
