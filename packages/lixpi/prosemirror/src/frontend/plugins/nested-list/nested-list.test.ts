// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    EditorState,
    TextSelection,
} from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { sinkListItem, liftListItem } from 'prosemirror-schema-list'
import { undo, redo } from 'prosemirror-history'

import {
    mountNestedList,
    createNestedListPlugins,
    createNestedListItemView,
    findNestedListEntry,
    splitNestedListItem,
    deleteNestedListItem,
    insertNestedListBlockBefore,
    insertNestedListBlockAfter,
    changeNestedListBlockStyle,
    toggleNestedListBlockBold,
    type MountNestedListOptions,
    type NestedListHandle,
} from './index.ts'
import {
    createNestedListSchema,
    parseNestedListDocument,
    type NestedListDocumentJson,
} from '../../../shared/nested-list.ts'

const paragraph = (text = ''): NestedListDocumentJson => ({
    type: 'paragraph',
    content: text ? [{
        type: 'text',
        text,
    }] : [],
})
const item = (id: string, text = id, itemType = 'text', children?: NestedListDocumentJson[]): NestedListDocumentJson => ({
    type: 'list_item',
    attrs: {
        entryId: id,
        itemType,
        data: itemType === 'bound' ? { reference: id } : null,
        tagIds: [],
    },
    content: [paragraph(text), ...(children ? [{
        type: 'bullet_list',
        content: children,
    }] : [])],
})
const documentJson = (...items: NestedListDocumentJson[]): NestedListDocumentJson => ({
    type: 'doc',
    content: [paragraph('Before'), {
        type: 'bullet_list',
        content: items,
    }, {
        type: 'heading',
        attrs: { level: 2 },
        content: [{
            type: 'text',
            text: 'After',
        }],
    }],
})
const mounted: NestedListHandle[] = []
const mount = (options: Partial<MountNestedListOptions> = {}): NestedListHandle => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountNestedList({
        container,
        document: documentJson(item('a', 'Alpha', 'bound'), item('b', 'Beta')),
        ...options,
    })
    mounted.push(handle)

    return handle
}
const caret = (handle: NestedListHandle, id: string, offset = 0): void => {
    const entry = findNestedListEntry(handle.view.state.doc, id)!
    handle.view.dispatch(handle.view.state.tr.setSelection(TextSelection.create(handle.view.state.doc, entry.pos + 2 + offset)))
}
const rows = (handle: NestedListHandle) => [...handle.view.dom.querySelectorAll<HTMLElement>('.nested-list-item')]
const directIds = (handle: NestedListHandle): string[] => {
    const list = handle.view.state.doc.child(1)

    return Array.from({ length: list.childCount }, (_, index) => list.child(index).attrs.entryId)
}

afterEach(() => {
    for (const handle of mounted.splice(0))
        handle.destroy()

    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('nested list schema and item views', () => {
    it('round-trips standard lists, headings and serializable custom data headlessly', () => {
        const schema = createNestedListSchema()
        const doc = parseNestedListDocument(documentJson(item('a', '', 'bound', [item('child')])), schema)
        const json = doc.toJSON()
        expect(schema.nodeFromJSON(json).eq(doc)).toBe(true)
        expect(doc.child(1).firstChild?.firstChild?.textContent).toBe('')
        expect(doc.child(1).firstChild?.attrs.data).toEqual({ reference: 'a' })
    })

    it('places the collapse widget after the rendered label and retains the shared drag overlay', () => {
        const handle = mount({
            document: documentJson(item('a', 'Alpha', 'bound', [item('child')]), item('b')),
        })
        const parent = rows(handle)[0]
        const label = parent.querySelector<HTMLElement>(':scope > .nested-list-item-content > p:first-child')!
        const collapse = label.querySelector<HTMLButtonElement>('.nested-list-collapse')!

        expect(collapse.previousSibling?.textContent).toBe('Alpha')
        expect(parent.querySelector(':scope > .nested-list-item-left-chrome')).toBeNull()
        parent.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        const drag = handle.view.dom.parentElement?.querySelector<HTMLElement>('.nested-list-block-drag-handle')
        expect(drag?.hidden).toBe(false)
        expect(drag?.querySelector('svg')).not.toBeNull()
        expect(collapse.querySelector('svg')).not.toBeNull()
        expect(rows(handle).find(row => row.dataset.entryId === 'b')?.querySelector('.nested-list-collapse')).toBeNull()
    })

    it('keeps the inline collapse control after edited and empty labels, then removes it with the child list', () => {
        const handle = mount({ document: documentJson(item('a', 'Alpha', 'bound', [item('child')])) })
        const label = (): HTMLElement => rows(handle)[0].querySelector<HTMLElement>(':scope > .nested-list-item-content > p:first-child')!
        const collapse = (): HTMLButtonElement | null => label().querySelector<HTMLButtonElement>('.nested-list-collapse')
        handle.enterEdit()
        let entry = findNestedListEntry(handle.view.state.doc, 'a')!
        const from = entry.pos + 2
        const to = entry.pos + entry.node.firstChild!.nodeSize
        handle.view.dispatch(handle.view.state.tr.insertText('A longer label that can wrap', from, to))
        expect(collapse()?.previousSibling?.textContent).toBe('A longer label that can wrap')
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild?.textContent).toBe('A longer label that can wrap')

        entry = findNestedListEntry(handle.view.state.doc, 'a')!
        handle.view.dispatch(handle.view.state.tr.delete(entry.pos + 2, entry.pos + entry.node.firstChild!.nodeSize))
        expect(collapse()).not.toBeNull()
        expect(collapse()?.parentElement).toBe(label())
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild?.textContent).toBe('')

        entry = findNestedListEntry(handle.view.state.doc, 'a')!
        const childList = entry.node.child(1)
        const childListFrom = entry.pos + 1 + entry.node.firstChild!.nodeSize
        handle.view.dispatch(handle.view.state.tr.delete(childListFrom, childListFrom + childList.nodeSize))
        expect(collapse()).toBeNull()
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.childCount).toBe(1)
    })

    it('omits the shared drag affordance for a read-only custom shell without a mount wrapper', () => {
        const schema = createNestedListSchema()
        const host = document.createElement('div')
        document.body.appendChild(host)
        const view = new EditorView(host, {
            state: EditorState.create({
                doc: parseNestedListDocument(documentJson(item('a', 'Alpha', 'bound')), schema),
                plugins: createNestedListPlugins(schema, {
                    readOnly: true,
                    itemViews: {
                        bound: node => createNestedListItemView(node),
                    },
                }),
            }),
        })

        try {
            expect(view.dom.closest('.nested-list')).toBeNull()
            expect(view.dom.querySelector('.nested-list-drag-handle')).toBeNull()
            expect(view.dom.parentElement?.querySelector('.nested-list-block-drag-handle')).toBeNull()
        } finally {
            view.destroy()
            host.remove()
        }
    })

    it('coexists with custom NodeViews and destroys the correct implementation on kind change', () => {
        const destroyed = vi.fn()
        const handle = mount({ itemViews: {
            bound: node => {
                const shell = createNestedListItemView(node)
                const original = shell.update.bind(shell)

                return {
                    dom: shell.dom,
                    contentDOM: shell.contentDOM,
                    update: original,
                    destroy: destroyed,
                }
            },
        } })
        expect(handle.view.dom.querySelectorAll('ul > li')).toHaveLength(2)
        handle.enterEdit()
        const entry = findNestedListEntry(handle.view.state.doc, 'a')!
        handle.view.dispatch(handle.view.state.tr.setNodeMarkup(entry.pos, undefined, {
            ...entry.node.attrs,
            itemType: 'text',
            data: null,
        }))
        expect(destroyed).toHaveBeenCalledOnce()
        expect(rows(handle)[0].dataset.itemType).toBe('text')
    })

    it('keeps a tagged parent and custom controls on its own label row before descendants', () => {
        const source = documentJson(item('parent', 'Parent', 'bound', [item('child')]))
        source.content![1].content![0].attrs!.tagIds = ['review']
        const badge = document.createElement('button')
        badge.textContent = 'Status'
        const tags = { review: {
            name: 'Review',
            color: '#778899',
        } }
        const handle = mount({
            document: source,
            tags,
            itemViews: {
                bound: node => createNestedListItemView(node, {
                    tags: () => tags,
                    controls: [badge],
                }),
            },
        })
        const parent = rows(handle)[0]
        const chrome = parent.querySelector<HTMLElement>(':scope > .nested-list-item-chrome')!
        const content = parent.querySelector<HTMLElement>(':scope > .nested-list-item-content')!
        const child = rows(handle)[1]

        expect(parent.querySelector(':scope > .nested-list-item-row-underlay')).not.toBeNull()
        expect(chrome.querySelector('.nested-list-tag')?.textContent).toBe('Review')
        expect(chrome.contains(badge)).toBe(true)
        expect(content.contains(child)).toBe(true)
        expect(parent.children[1]).toBe(content)
        expect(parent.children[2]).toBe(chrome)
        expect(content.querySelector('p:first-child > .nested-list-collapse')).not.toBeNull()
    })

    it('rejects duplicate custom identities and preserves custom data without invoking a view', () => void expect(() => parseNestedListDocument(documentJson(item('a', 'A', 'bound'), item('a', 'A', 'bound')))).toThrow(/unique/))
})

describe('block menu commands', () => {
    it('inserts an empty heading after the final row of a complete list', () => {
        const handle = mount()
        handle.enterEdit()
        expect(insertNestedListBlockAfter('b', {
            type: 'heading',
            level: 2,
        })(handle.view.state, handle.view.dispatch)).toBe(true)
        const doc = handle.view.state.doc
        expect(doc.childCount).toBe(4)
        expect(doc.child(1).firstChild?.attrs.entryId).toBe('a')
        expect(doc.child(2).type.name).toBe('heading')
        expect(doc.child(2).attrs.level).toBe(2)
        expect(doc.child(2).textContent).toBe('')
        expect(doc.child(1).lastChild?.attrs.entryId).toBe('b')
    })

    it('inserts a plain list item below a row without copying its binding', () => {
        const handle = mount()
        handle.enterEdit()
        expect(insertNestedListBlockAfter('a', { type: 'bullet_list' })(handle.view.state, handle.view.dispatch)).toBe(true)
        const list = handle.view.state.doc.child(1)
        expect(list.childCount).toBe(3)
        expect(list.child(1).attrs.itemType).toBe('text')
        expect(list.child(1).attrs.data).toBeNull()
        expect(list.child(1).attrs.entryId).not.toBe('a')
    })

    it('changes a standalone block style and toggles a whole bound label bold', () => {
        const handle = mount()
        handle.enterEdit()
        const standaloneId = handle.view.state.doc.lastChild!.attrs.entryId as string
        expect(changeNestedListBlockStyle(standaloneId, { type: 'paragraph' })(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(handle.view.state.doc.lastChild?.type.name).toBe('paragraph')
        expect(changeNestedListBlockStyle('a', {
            type: 'heading',
            level: 1,
        })(handle.view.state)).toBe(false)
        expect(toggleNestedListBlockBold('a')(handle.view.state, handle.view.dispatch)).toBe(true)
        const label = findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild!
        expect(label.attrs.bold).toBe(true)
        expect(label.textContent).toBe('Alpha')
        expect(label.toJSON().attrs.bold).toBe(true)
    })
})

describe('floating block menu', () => {
    const menuItem = (label: string): HTMLButtonElement =>
        [...document.querySelectorAll<HTMLButtonElement>('.nested-list-block-bubble button')]
            .find(button => button.getAttribute('aria-label') === label)!

    it('opens from the trigger in view mode and queues a blank heading in a draft', () => {
        const handle = mount()
        rows(handle)[1].querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        const trigger = document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
        expect(trigger).not.toBeNull()
        const bubble = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
        expect(trigger.closest('.bubble-menu')).toBeNull()
        expect(bubble.classList.contains('is-visible')).toBe(false)
        trigger.click()
        expect(bubble.classList.contains('is-visible')).toBe(true)
        expect(menuItem('Insert new block').querySelector('svg')).not.toBeNull()
        expect(bubble.querySelector('[aria-label="Bold"]')).toBeNull()
        menuItem('Insert new block').click()
        const panel = document.querySelector<HTMLElement>('.nested-list-block-panel')!
        expect(panel.querySelectorAll('.bubble-menu-dropdown-item')).toHaveLength(4)
        expect(panel.querySelector('[aria-label="Bulleted list"]')).toBeNull()
        menuItem('Heading 2').click()
        expect(handle.mode).toBe('edit')
        expect(handle.view.state.doc.child(2).type.name).toBe('heading')
        expect(handle.view.state.doc.child(2).textContent).toBe('')
    })

    it('opens trigger and style controls without focusing or editing the document', () => {
        const handle = mount()
        const original = handle.view.state.doc
        const focus = vi.spyOn(handle.view, 'focus')
        const heading = handle.view.dom.querySelector('h2')!
        heading.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        const trigger = document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
        const pointerDown = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
        })
        trigger.dispatchEvent(pointerDown)
        expect(pointerDown.defaultPrevented).toBe(true)
        const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        })
        trigger.dispatchEvent(mouseDown)
        expect(mouseDown.defaultPrevented).toBe(true)

        trigger.click()
        expect(handle.mode).toBe('view')
        expect(handle.view.dom.getAttribute('contenteditable')).toBe('false')
        expect(document.activeElement).not.toBe(handle.view.dom)
        expect(focus).not.toHaveBeenCalled()

        menuItem('Change current style').click()
        expect(document.querySelector('.nested-list-block-style-menu')?.classList.contains('is-open')).toBe(true)
        expect(handle.mode).toBe('view')
        expect(handle.view.state.doc.eq(original)).toBe(true)
        expect(focus).not.toHaveBeenCalled()
    })

    it('focuses the menu and hides an existing edit caret without leaving edit mode', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'b', 2)
        handle.view.focus()
        expect(document.activeElement).toBe(handle.view.dom)
        const original = handle.view.state.doc
        const selection = handle.view.state.selection
        const heading = handle.view.dom.querySelector('h2')!
        heading.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        const trigger = document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 18, 18))
        trigger.click()

        const bubble = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
        expect(handle.mode).toBe('edit')
        expect(document.activeElement).toBe(bubble)
        expect(handle.view.hasFocus()).toBe(false)
        expect(handle.view.state.selection.eq(selection)).toBe(true)
        expect(handle.view.state.doc.eq(original)).toBe(true)

        menuItem('Change current style').click()
        expect(handle.mode).toBe('edit')
        expect(document.activeElement).toBe(bubble)
        trigger.click()
        expect(document.activeElement).toBe(trigger)
    })

    it('keeps list labels out of heading conversion and hides Bold from navigation actions', () => {
        const handle = mount()
        rows(handle)[0].querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!.click()
        expect(document.querySelector('.nested-list-block-toolbar .bubble-menu-dropdown')).toBeNull()
        expect(document.querySelector('.nested-list-block-bubble [aria-label="Bold"]')).toBeNull()
        expect(handle.mode).toBe('view')
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild?.attrs.bold).toBe(false)
    })

    it('uses the vertical icon style selector for an ordinary heading', () => {
        const handle = mount()
        const original = handle.view.state.doc.lastChild!
        const heading = handle.view.dom.querySelector('h2')!
        heading.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!.click()

        const toggle = menuItem('Change current style')
        expect(toggle.querySelector('.dropdown-label svg')).not.toBeNull()
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        toggle.click()
        const selector = document.querySelector<HTMLElement>('.nested-list-block-style-menu')!
        expect(selector.classList.contains('is-open')).toBe(true)
        expect([...selector.querySelectorAll<HTMLButtonElement>('.bubble-menu-dropdown-item')]
            .map(button => button.getAttribute('aria-label'))).toEqual([
            'Text',
            'Heading 1',
            'Heading 2',
            'Heading 3',
        ])
        expect(selector.querySelector('[aria-label="Bulleted list"]')).toBeNull()
        expect(selector.querySelector('[aria-label="Heading 2"]')?.classList.contains('is-active')).toBe(true)
        selector.querySelector<HTMLButtonElement>('[aria-label="Text"]')!.click()
        expect(handle.mode).toBe('edit')
        expect(handle.view.state.doc.lastChild?.type.name).toBe('paragraph')
        expect(handle.view.state.doc.lastChild?.attrs.entryId).toBe(original.attrs.entryId)
    })

    it('closes the trigger menu and exits editing with Escape while retaining changes', () => {
        const changed = vi.fn()
        const handle = mount({ onChange: changed })
        handle.enterEdit()
        caret(handle, 'b')
        handle.view.dispatch(handle.view.state.tr.insertText('draft '))
        rows(handle)[0].dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        const trigger = document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
        trigger.click()
        trigger.focus()
        trigger.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        }))

        expect(handle.mode).toBe('view')
        expect(document.querySelector('.nested-list-block-panel')?.hasAttribute('hidden')).toBe(true)
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toContain('draft ')
        expect(changed).toHaveBeenCalledOnce()
    })

    it('flips the action panel above a row near the scroll viewport bottom', () => {
        const handle = mount()
        const host = handle.view.dom.closest('.nested-list')!.parentElement as HTMLElement
        host.style.overflowY = 'auto'
        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 280, 200))
        const bubble = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
        vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 170, 40, 28))
        const panel = document.querySelector<HTMLElement>('.nested-list-block-panel')!
        Object.defineProperty(panel, 'scrollHeight', {
            configurable: true,
            value: 200,
        })

        rows(handle)[0].dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!.click()
        menuItem('Insert new block').click()
        expect(panel.classList.contains('nested-list-block-panel-above')).toBe(true)
        expect(panel.style.maxHeight).toBe('166px')
    })

    it('opens the same menu from a focused row with Shift+F10', () => {
        const handle = mount()
        const row = rows(handle)[0]
        row.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        row.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'F10',
            shiftKey: true,
            bubbles: true,
        }))
        expect(document.querySelector<HTMLElement>('.nested-list-block-bubble')?.classList.contains('is-visible')).toBe(true)
        expect(handle.mode).toBe('view')
    })

    it('does not mount mutation controls for a read-only list', () => {
        const handle = mount({ readOnly: true })
        rows(handle)[0].querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        expect(document.querySelector('.nested-list-block-trigger')).toBeNull()
    })
})

describe('normal editing and guarded identities', () => {
    it('splits at the middle of a custom label without copying its binding', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'a', 2)
        expect(splitNestedListItem(handle.view.state, handle.view.dispatch)).toBe(true)
        const list = handle.view.state.doc.child(1)
        expect(list.child(0).textContent).toBe('Al')
        expect(list.child(0).attrs.entryId).toBe('a')
        expect(list.child(1).textContent).toBe('pha')
        expect(list.child(1).attrs.itemType).toBe('text')
        expect(list.child(1).attrs.data).toBeNull()
        expect(list.child(1).attrs.entryId).not.toBe('a')
    })

    it('indents and outdents mixed custom/plain items using ordinary list commands', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'b')
        expect(sinkListItem(handle.view.state.schema.nodes.list_item)(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(handle.view.state.doc.child(1).childCount).toBe(1)
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.lastChild?.type.name).toBe('bullet_list')
        expect(liftListItem(handle.view.state.schema.nodes.list_item)(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(directIds(handle)).toEqual(['a', 'b'])
    })

    it('permits erasing a bound label while a consumer guard rejects removing the bound item', () => {
        const changed = vi.fn()
        const handle = mount({
            onChange: changed,
            filterTransaction: tr => Boolean(findNestedListEntry(tr.doc, 'a')),
        })
        handle.enterEdit()
        const entry = findNestedListEntry(handle.view.state.doc, 'a')!
        handle.view.dispatch(handle.view.state.tr.delete(entry.pos + 2, entry.pos + 2 + entry.node.firstChild!.content.size))
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild!.textContent).toBe('')
        const empty = findNestedListEntry(handle.view.state.doc, 'a')!
        handle.view.dispatch(handle.view.state.tr.delete(empty.pos, empty.pos + empty.node.nodeSize))
        expect(findNestedListEntry(handle.view.state.doc, 'a')).toBeDefined()
        expect(changed).toHaveBeenCalledTimes(1)
    })

    it('rejects a pasted custom duplicate, but assigns fresh IDs to pasted plain items', () => {
        const handle = mount()
        handle.enterEdit()
        let entry = findNestedListEntry(handle.view.state.doc, 'a')!
        handle.view.dispatch(handle.view.state.tr.insert(entry.pos + entry.node.nodeSize, entry.node))
        expect(directIds(handle)).toEqual(['a', 'b'])
        entry = findNestedListEntry(handle.view.state.doc, 'b')!
        handle.view.dispatch(handle.view.state.tr.insert(entry.pos + entry.node.nodeSize, entry.node))
        const ids = directIds(handle)
        expect(ids).toHaveLength(3)
        expect(new Set(ids).size).toBe(3)
    })

    it('allows ordinary plain item deletion and undo/redo', () => {
        const handle = mount({ document: documentJson(item('a', 'One'), item('b', 'Two')) })
        handle.enterEdit()
        const entry = findNestedListEntry(handle.view.state.doc, 'b')!
        handle.view.dispatch(handle.view.state.tr.delete(entry.pos, entry.pos + entry.node.nodeSize))
        expect(directIds(handle)).toEqual(['a'])
        expect(undo(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(directIds(handle)).toEqual(['a', 'b'])
        expect(redo(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(directIds(handle)).toEqual(['a'])
    })
})

describe('document reordering', () => {
    it('moves a complete subtree in view mode without opening text editing', () => {
        const changed = vi.fn()
        const handle = mount({
            document: documentJson(item('a', 'A', 'bound', [item('child')]), item('b')),
            onChange: changed,
        })
        expect(handle.move({
            entryId: 'a',
            targetEntryId: 'b',
            placement: 'after',
        })).toBe(true)
        expect(directIds(handle)).toEqual(['b', 'a'])
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.lastChild?.textContent).toBe('child')
        expect(handle.mode).toBe('view')
        expect(changed).toHaveBeenCalledOnce()
        const beforeTyping = handle.view.state.doc
        const entry = findNestedListEntry(beforeTyping, 'a')!
        handle.view.dispatch(handle.view.state.tr.insertText('!', entry.pos + 2))
        expect(handle.view.state.doc.eq(beforeTyping)).toBe(true)
    })

    it('moves into a plain item and rejects drops into its own descendant', () => {
        const handle = mount({ document: documentJson(item('a'), item('b')) })
        expect(handle.move({
            entryId: 'a',
            targetEntryId: 'b',
            placement: 'inside',
        })).toBe(true)
        expect(directIds(handle)).toEqual(['b'])
        expect(handle.move({
            entryId: 'b',
            targetEntryId: 'a',
            placement: 'inside',
        })).toBe(false)
    })

    it('does not apply a move rejected by the consumer', () => {
        const handle = mount({ filterTransaction: () => false })
        expect(handle.move({
            entryId: 'a',
            targetEntryId: 'b',
            placement: 'after',
        })).toBe(false)
        expect(directIds(handle)).toEqual(['a', 'b'])
    })
})

describe('editing and synchronization', () => {
    it('keeps local edits when an outside pointer leaves edit mode', () => {
        const changed = vi.fn()
        const handle = mount({ onChange: changed })
        handle.enterEdit()
        caret(handle, 'b', 4)
        handle.view.dispatch(handle.view.state.tr.insertText(' draft'))
        expect(handle.setDocument(documentJson(item('a', 'Remote'), item('b')))).toBe('deferred')
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        expect(handle.mode).toBe('view')
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toBe('Beta draft')
        expect(changed).toHaveBeenCalledOnce()
    })

    it('exits edit mode and blurs when clicking blank editor surfaces without changing the document', () => {
        const onChange = vi.fn()
        const handle = mount({ onChange })
        const before = handle.view.state.doc
        const blur = vi.spyOn(handle.view.dom, 'blur')
        const editor = handle.view.dom.parentElement!
        const root = editor.parentElement!

        for (const blank of [handle.view.dom, editor, root]) {
            handle.enterEdit()
            handle.view.focus()
            const pointerDown = new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
            })
            blank.dispatchEvent(pointerDown)
            const mouseDown = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
            })
            blank.dispatchEvent(mouseDown)

            expect(pointerDown.defaultPrevented).toBe(true)
            expect(mouseDown.defaultPrevented).toBe(true)
            expect(handle.mode).toBe('view')
            expect(document.activeElement).not.toBe(handle.view.dom)
            expect(handle.view.state.doc.eq(before)).toBe(true)
        }

        expect(blur).toHaveBeenCalledTimes(3)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('keeps an actual empty paragraph editable when clicked', () => {
        const handle = mount({
            document: {
                type: 'doc',
                content: [paragraph()],
            },
        })
        handle.enterEdit()
        const empty = handle.view.dom.querySelector('p')!
        empty.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
        }))
        empty.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        }))

        expect(handle.mode).toBe('edit')
        expect(handle.view.dom.getAttribute('contenteditable')).toBe('true')
    })

    it('still enters edit mode when double-clicking an empty editor background', () => {
        const handle = mount()
        const editor = handle.view.dom.parentElement!
        const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        })
        editor.dispatchEvent(mouseDown)
        expect(mouseDown.defaultPrevented).toBe(true)
        editor.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            detail: 2,
        }))

        expect(handle.mode).toBe('edit')
        expect(document.activeElement).toBe(handle.view.dom)
    })

    it.each([
        {
            source: 'text',
            fromMenu: false,
        },
        {
            source: 'portaled menu',
            fromMenu: true,
        },
    ])('exits and blurs editing on Escape from $source', ({ fromMenu }) => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'b')
        handle.view.dispatch(handle.view.state.tr.insertText('local '))
        handle.view.focus()
        const blur = vi.spyOn(handle.view.dom, 'blur')
        let target: HTMLElement = handle.view.dom

        if (fromMenu) {
            rows(handle)[0].dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
            handle.view.dom.parentElement!.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!.click()
            target = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
        }

        target.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        }))

        expect(handle.mode).toBe('view')
        expect(blur).toHaveBeenCalled()
        expect(document.activeElement).not.toBe(handle.view.dom)
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toContain('local ')

        if (fromMenu)
            expect(target.classList.contains('is-visible')).toBe(false)
    })

    it('keeps editing while interacting with its portaled block menu', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'b', 4)
        const selection = handle.view.state.selection.from
        rows(handle)[0].querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        document.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!.click()
        const menu = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
        expect(menu.parentElement).toBe(document.body)
        menu.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        expect(handle.mode).toBe('edit')
        expect(handle.view.state.selection.from).toBe(selection)
    })

    it('has no Save or Cancel controls or keyboard shortcuts', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'b')
        handle.view.dispatch(handle.view.state.tr.insertText('local '))

        for (const event of [
            new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                ctrlKey: true,
            }),
        ])
            handle.view.dom.dispatchEvent(event)

        expect(handle.mode).toBe('edit')
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toContain('local ')
        expect(document.querySelector('.nested-list-toolbar')).toBeNull()
    })
})

describe('navigation gestures and read-only use', () => {
    it('enters edit from its empty editor surface without intercepting host siblings or controls', () => {
        const changed = vi.fn()
        const handle = mount({ onChange: changed })
        const editor = handle.view.dom.parentElement!
        const root = editor.parentElement!
        const sibling = document.createElement('button')
        root.parentElement!.appendChild(sibling)
        const control = document.createElement('button')
        editor.appendChild(control)
        sibling.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        control.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(handle.mode).toBe('view')

        const before = handle.view.state.doc
        editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(handle.mode).toBe('edit')
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(handle.view.state.selection.from).toBe(before.content.size - 1)
        expect(changed).not.toHaveBeenCalled()
    })

    it('keeps the empty read-only surface fixed and removes its listener on destroy', () => {
        const handle = mount({ readOnly: true })
        const editor = handle.view.dom.parentElement!
        editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(handle.mode).toBe('view')

        const enter = vi.spyOn(handle, 'enterEdit')
        handle.destroy()
        editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(enter).not.toHaveBeenCalled()
    })

    it('activates a read-only catalog immediately and never enters edit mode', () => {
        const activate = vi.fn()
        const handle = mount({
            readOnly: true,
            onActivate: activate,
        })
        rows(handle)[0].dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            detail: 1,
        }))
        expect(activate).toHaveBeenCalledOnce()
        rows(handle)[0].dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            detail: 2,
        }))
        expect(handle.mode).toBe('view')
        expect(handle.enterEdit()).toBe(false)
        expect(handle.move({
            entryId: 'a',
            targetEntryId: 'b',
            placement: 'after',
        })).toBe(false)
        expect(document.querySelector('.nested-list-toolbar')).toBeNull()
    })

    it('activates on the first click without waiting, and a double click enters edit mode without activating again', () => {
        const activate = vi.fn()
        const handle = mount({ onActivate: activate })
        rows(handle)[0].dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            detail: 1,
        }))
        expect(activate).toHaveBeenCalledOnce()
        rows(handle)[0].dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            detail: 2,
        }))
        rows(handle)[0].dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            detail: 2,
        }))
        expect(activate).toHaveBeenCalledOnce()
        expect(handle.mode).toBe('edit')
        rows(handle)[0].dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            ctrlKey: true,
        }))
        expect(activate).toHaveBeenCalledTimes(2)
    })

    it('supports controlled collapse and active ancestors without document edits', () => {
        const collapse = vi.fn()
        const changed = vi.fn()
        const handle = mount({
            readOnly: true,
            document: documentJson(item('a', 'A', 'text', [item('child')])),
            onCollapseChange: collapse,
            onChange: changed,
        })
        rows(handle)[0].querySelector<HTMLButtonElement>(':scope > .nested-list-item-content > p:first-child > .nested-list-collapse')!.click()
        expect(collapse).toHaveBeenCalledWith('a', true)
        expect(handle.collapsed.has('a')).toBe(true)
        handle.setActive('child')
        expect(rows(handle)[0].classList.contains('nested-list-active-ancestor')).toBe(true)
        expect(changed).not.toHaveBeenCalled()
    })
})

describe('pointer dragging and shared keyboard controls', () => {
    it('drags a whole row in view mode and performs a real move, then cleans up listeners', () => {
        const handle = mount({ document: documentJson(item('a'), item('b')) })
        const target = rows(handle)[1]
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
        const bounds = new DOMRect(0, 100, 100, 40)
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(bounds)
        vi.spyOn(target.querySelector('p')!, 'getBoundingClientRect').mockReturnValue(bounds)
        vi.spyOn(rows(handle)[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 40))
        const row = rows(handle)[0]
        row.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: 0,
            clientY: 0,
        }))
        document.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            clientX: 10,
            clientY: 135,
        }))
        expect(handle.mode).toBe('view')
        expect(target.dataset.nestedListDrop).toBe('after')
        document.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 1,
            clientX: 10,
            clientY: 135,
        }))
        expect(directIds(handle)).toEqual(['b', 'a'])
        expect(document.querySelector('[data-nested-list-drop]')).toBeNull()
        document.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            clientX: 10,
            clientY: 20,
        }))
        expect(document.querySelector('[data-nested-list-drop]')).toBeNull()
    })

    it('keeps text pointer selection separate from row dragging', () => {
        const handle = mount()
        handle.enterEdit()
        const text = rows(handle)[0].querySelector('p')!
        text.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerId: 1,
        }))
        document.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            clientX: 80,
            clientY: 80,
        }))
        expect(document.querySelector('[data-nested-list-drop]')).toBeNull()
    })
})

describe('editable content and caller-owned editor integration', () => {
    it('keeps custom selection hooks optional so native caret placement remains available', () => {
        const handle = mount({ itemViews: { bound: node => {
            const shell = createNestedListItemView(node)

            return {
                dom: shell.dom,
                contentDOM: shell.contentDOM,
            }
        } } })
        handle.enterEdit()
        caret(handle, 'a', 3)
        handle.view.focus()
        expect(handle.view.state.selection.$from.parentOffset).toBe(3)
        handle.view.dispatch(handle.view.state.tr.insertText('!'))
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.textContent).toBe('Alp!ha')
    })

    it('creates a paragraph below a standalone heading on Enter', () => {
        const handle = mount({ document: {
            type: 'doc',
            content: [{
                type: 'heading',
                attrs: {
                    entryId: 'section',
                    level: 2,
                },
                content: [{
                    type: 'text',
                    text: 'Section',
                }],
            }],
        } })
        handle.enterEdit()
        const heading = findNestedListEntry(handle.view.state.doc, 'section')!
        handle.view.dispatch(handle.view.state.tr.setSelection(TextSelection.create(
            handle.view.state.doc,
            heading.pos + 1 + heading.node.content.size,
        )))
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }))

        const doc = handle.view.state.doc
        expect(doc.childCount).toBe(2)
        expect(doc.child(0).type.name).toBe('heading')
        expect(doc.child(0).attrs.entryId).toBe('section')
        expect(doc.child(1).type.name).toBe('paragraph')
        expect(doc.child(1).attrs.entryId).not.toBe('section')
        expect(handle.view.state.selection.$from.parent.type.name).toBe('paragraph')
        handle.view.dispatch(handle.view.state.tr.insertText('Body'))
        expect(handle.view.state.doc.child(1).textContent).toBe('Body')
        expect(undo(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(handle.view.state.doc.child(0).attrs.entryId).toBe('section')
    })

    it('allows an empty plain list item to lift into an ordinary paragraph', () => {
        const handle = mount({ document: documentJson(item('a', '')) })
        handle.enterEdit()
        caret(handle, 'a')
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }))
        expect(handle.view.state.doc.child(1).type.name).toBe('paragraph')
    })

    it('keeps the stock outdent for an unguarded empty nested plain item', () => {
        const handle = mount({ document: documentJson(item('outer', 'Outer', 'bound', [
            item('first', 'First'),
            item('empty', ''),
        ])) })
        handle.enterEdit()
        caret(handle, 'empty')
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }))

        const list = handle.view.state.doc.child(1)
        expect(list.childCount).toBe(2)
        expect(list.child(0).attrs.entryId).toBe('outer')
        expect(findNestedListEntry(handle.view.state.doc, 'first')).toBeDefined()
        expect(list.child(1).attrs.itemType).toBe('text')
        expect(list.child(1).attrs.entryId).not.toBe('outer')
    })

    it('activates a custom read-only NodeView with keyboard input', () => {
        const activate = vi.fn()
        const handle = mount({
            readOnly: true,
            onActivate: activate,
            itemViews: { bound: node => {
            const shell = createNestedListItemView(node)

            return {
                dom: shell.dom,
                contentDOM: shell.contentDOM,
            }
        } },
        })
        rows(handle)[0].dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }))
        expect(activate).toHaveBeenCalledOnce()
    })
})

describe('integration safeguards', () => {
    it('places the edit caret in the second row that was double-clicked', () => {
        const handle = mount()
        const entry = findNestedListEntry(handle.view.state.doc, 'b')!
        vi.spyOn(handle.view, 'posAtCoords').mockReturnValue({
            pos: entry.pos + 4,
            inside: entry.pos,
        })
        rows(handle)[1].querySelector('p')!.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            clientX: 25,
            clientY: 60,
            detail: 2,
        }))
        expect(handle.mode).toBe('edit')
        expect(handle.view.state.selection.from).toBe(entry.pos + 4)
        handle.view.dispatch(handle.view.state.tr.insertText('!'))
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toBe('Be!ta')
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.textContent).toBe('Alpha')
    })

    it('falls back to the clicked row when pointer coordinates cannot be resolved', () => {
        const handle = mount()
        vi.spyOn(handle.view, 'posAtCoords').mockReturnValue(null)
        rows(handle)[1].querySelector('p')!.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            detail: 2,
        }))
        handle.view.dispatch(handle.view.state.tr.insertText('!'))
        expect(findNestedListEntry(handle.view.state.doc, 'b')!.node.textContent).toBe('!Beta')
    })

    it('checks the consumer guard before displaying a valid drop without applying preview transactions', () => {
        const onChange = vi.fn()
        const guard = vi.fn(() => false)
        const handle = mount({
            filterTransaction: guard,
            onChange,
        })
        const target = rows(handle)[1]
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
        const bounds = new DOMRect(0, 100, 100, 40)
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(bounds)
        vi.spyOn(target.querySelector('p')!, 'getBoundingClientRect').mockReturnValue(bounds)
        vi.spyOn(rows(handle)[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 40))
        rows(handle)[0].dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerId: 1,
        }))
        document.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            clientX: 10,
            clientY: 135,
        }))
        expect(guard).toHaveBeenCalled()
        expect(document.querySelector('[data-nested-list-drop]')).toBeNull()
        expect(onChange).not.toHaveBeenCalled()
        document.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 1,
        }))
        expect(directIds(handle)).toEqual(['a', 'b'])
        expect(onChange).not.toHaveBeenCalled()
    })

    it('removes the final item of a list without deleting adjacent blocks', () => {
        const handle = mount({ document: documentJson(item('a')) })
        handle.enterEdit()
        expect(deleteNestedListItem('a')(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(handle.view.state.doc.childCount).toBe(2)
        expect(handle.view.state.doc.child(0).textContent).toBe('Before')
        expect(handle.view.state.doc.child(1).textContent).toBe('After')
    })

    it('leaves an empty paragraph when explicit deletion empties the document', () => {
        const handle = mount({ document: {
            type: 'doc',
            content: [{
                type: 'bullet_list',
                content: [item('a')],
            }],
        } })
        handle.enterEdit()
        deleteNestedListItem('a')(handle.view.state, handle.view.dispatch)
        expect(handle.view.state.doc.childCount).toBe(1)
        expect(handle.view.state.doc.firstChild!.type.name).toBe('paragraph')
        expect(handle.view.state.doc.firstChild!.textContent).toBe('')
    })

    it('inserts a heading before the complete list and selects its placeholder', () => {
        const handle = mount()
        handle.enterEdit()
        expect(insertNestedListBlockBefore('a', {
            type: 'heading',
            level: 2,
            text: 'New heading',
        })(handle.view.state, handle.view.dispatch)).toBe(true)
        expect(handle.view.state.doc.child(1).type.name).toBe('heading')
        expect(handle.view.state.doc.child(2).type.name).toBe('bullet_list')
        expect(handle.view.state.doc.textBetween(handle.view.state.selection.from, handle.view.state.selection.to)).toBe('New heading')
        expect(findNestedListEntry(handle.view.state.doc, 'a')).toBeDefined()
        expect(findNestedListEntry(handle.view.state.doc, 'b')).toBeDefined()
    })
})


describe('complete list boundaries', () => {
    it('rejects body paragraphs and headings inside an item while retaining nested list items', () => {
        for (const type of ['paragraph', 'heading']) {
            const source = documentJson(item('a'))
            source.content![1].content![0].content!.push({
                type,
                attrs: type === 'heading' ? { level: 2 } : {},
                content: [{
                    type: 'text',
                    text: 'Not a label',
                }],
            })
            expect(() => parseNestedListDocument(source)).toThrow()
        }

        expect(() => parseNestedListDocument(documentJson(item('a', 'A', 'text', [item('child')])))).not.toThrow()
    })

    it('rejects block insertion between rows and inside a nested group', () => {
        const handle = mount({ document: documentJson(item('a', 'A', 'bound', [item('child')]), item('b')) })
        handle.enterEdit()
        const original = handle.view.state.doc
        expect(insertNestedListBlockAfter('a', { type: 'paragraph' })(handle.view.state, handle.view.dispatch)).toBe(false)
        expect(insertNestedListBlockBefore('b', { type: 'heading' })(handle.view.state, handle.view.dispatch)).toBe(false)
        expect(insertNestedListBlockAfter('child', { type: 'paragraph' })(handle.view.state, handle.view.dispatch)).toBe(false)
        expect(handle.view.state.doc.eq(original)).toBe(true)
    })

    it('keeps pasted paragraphs in list structure and prevents standalone headings inside titles', () => {
        const handle = mount()
        handle.enterEdit()
        caret(handle, 'a', 2)
        const original = handle.view.state.doc
        handle.view.pasteHTML('<h2>Heading</h2>')
        expect(handle.view.state.doc.eq(original)).toBe(true)
        handle.view.pasteHTML('<p>One</p><p>Two</p>')
        const parent = findNestedListEntry(handle.view.state.doc, 'a')!.node
        expect(parent.firstChild!.textContent).toBe('AlOne')
        expect(parent.childCount).toBe(2)
        expect(parent.child(1).type.name).toBe('bullet_list')
        expect(parent.child(1).firstChild!.type.name).toBe('list_item')
        expect(parent.child(1).firstChild!.firstChild!.textContent).toBe('Twopha')
        expect(handle.view.state.doc.childCount).toBe(original.childCount)
        expect(findNestedListEntry(handle.view.state.doc, 'b')).toBeDefined()
        caret(handle, 'a', 2)
        handle.view.pasteText(' pasted ')
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.firstChild!.textContent).toBe('Al pasted One')
    })

    it('rejects a transaction that splits a complete list around a standalone block', () => {
        const handle = mount()
        handle.enterEdit()
        const original = handle.view.state.doc
        const list = original.child(1)
        const schema = handle.view.state.schema
        const separated = [
            original.firstChild!,
            list.copy(schema.nodes.bullet_list.create(null, list.firstChild!).content),
            schema.nodes.heading.create({
                entryId: 'injected',
                level: 2,
            }, schema.text('Between')),
            schema.nodes.bullet_list.create({ entryId: 'split-list' }, list.lastChild!),
            original.lastChild!,
        ]
        handle.view.dispatch(handle.view.state.tr.replaceWith(0, original.content.size, separated))
        expect(handle.view.state.doc.eq(original)).toBe(true)
    })

    it('keeps Enter from lifting a middle empty item into a paragraph between its siblings', () => {
        const handle = mount({ document: documentJson(item('a'), item('middle', ''), item('b')) })
        handle.enterEdit()
        caret(handle, 'middle')
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        expect(handle.view.state.doc.child(1).type.name).toBe('bullet_list')
        expect(directIds(handle)).toEqual(['a', 'middle', 'b'])
    })
})


describe('consumer-owned item Enter commands', () => {
    it('passes the current state and view to the registered item command without splitting its subtree', () => {
        const enter = vi.fn(() => true)
        const handle = mount({
            document: documentJson(item('a', 'Alpha', 'bound', [item('child')]), item('b')),
            itemEnter: { bound: enter },
        })
        handle.enterEdit()
        caret(handle, 'a', 2)
        const before = handle.view.state
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        expect(enter).toHaveBeenCalledOnce()
        expect(enter).toHaveBeenCalledWith(before, expect.any(Function), handle.view)
        expect(handle.view.state.doc.eq(before.doc)).toBe(true)
    })

    it('consumes a registered refusal instead of creating a plain item', () => {
        const enter = vi.fn(() => false)
        const handle = mount({ itemEnter: { bound: enter } })
        handle.enterEdit()
        caret(handle, 'a', 2)
        const before = handle.view.state.doc
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        expect(enter).toHaveBeenCalledOnce()
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(directIds(handle)).toEqual(['a', 'b'])
    })

    it('keeps ordinary plain item Enter behavior when another type owns its command', () => {
        const enter = vi.fn(() => false)
        const handle = mount({ itemEnter: { bound: enter } })
        handle.enterEdit()
        caret(handle, 'b', 2)
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        expect(enter).not.toHaveBeenCalled()
        const list = handle.view.state.doc.child(1)
        expect(list.childCount).toBe(3)
        expect(list.child(1).firstChild!.textContent).toBe('Be')
        expect(list.child(2).attrs.itemType).toBe('text')
        expect(list.child(2).firstChild!.textContent).toBe('ta')
    })
})
