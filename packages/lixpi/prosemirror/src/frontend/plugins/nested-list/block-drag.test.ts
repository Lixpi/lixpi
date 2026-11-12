// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { TextSelection } from 'prosemirror-state'
import {
    mountNestedList,
    type MountNestedListOptions,
    type NestedListHandle,
} from './index.ts'
import { findNestedListEntry } from './commands.ts'

const mounted: NestedListHandle[] = []
const mount = (options: Partial<MountNestedListOptions> = {}): NestedListHandle => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountNestedList({
        container,
        document: {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: {
                        entryId: 'lead',
                        bold: true,
                    },
                    content: [{
                        type: 'text',
                        text: 'Lead',
                    }],
                },
                {
                    type: 'bullet_list',
                    attrs: { entryId: 'list' },
                    content: ['a', 'b'].map(entryId => ({
                        type: 'list_item',
                        attrs: {
                            entryId,
                            itemType: 'text',
                            data: null,
                            tagIds: [],
                        },
                        content: [{
                            type: 'paragraph',
                            attrs: { entryId: `${entryId}-label` },
                            content: [{
                                type: 'text',
                                text: entryId,
                            }],
                        }],
                    })),
                },
                {
                    type: 'heading',
                    attrs: {
                        entryId: 'tail',
                        level: 2,
                    },
                    content: [{
                        type: 'text',
                        text: 'Tail',
                    }],
                },
            ],
        },
        ...options,
    })
    mounted.push(handle)

    return handle
}
const dom = (handle: NestedListHandle, id: string): HTMLElement =>
    handle.view.nodeDOM(findNestedListEntry(handle.view.state.doc, id)!.pos) as HTMLElement
const pointer = (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
): void => {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: y,
    }))
}
const dropAt = (target: HTMLElement): void => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
    const rect = new DOMRect(0, 100, 200, 40)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect)
    const label = target.matches('.nested-list-item')
        ? target.querySelector<HTMLElement>(':scope > .nested-list-item-content > p:first-child')
        : undefined

    if (label)
        vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(rect)
}

const sectionScene = (options: Partial<MountNestedListOptions> = {}): NestedListHandle => {
    const handle = mount(options)
    const content = handle.view.state.doc.toJSON().content
    const child = structuredClone(content[1].content[1])
    child.attrs.entryId = 'child'
    child.content[0].attrs.entryId = 'child-label'
    child.content[0].content[0].text = 'child'
    content[1].content[0].content.push({
        type: 'bullet_list',
        attrs: { entryId: 'children' },
        content: [child],
    })
    handle.setDocument({
        type: 'doc',
        content: [{
            type: 'section',
            attrs: { entryId: 'section' },
            content: [{
                type: 'paragraph',
                attrs: { entryId: 'section-label' },
                content: [{
                    type: 'text',
                    text: 'Section',
                }],
            }, ...content],
        }],
    })

    for (const [id, top, height] of [
        ['section', 0, 290], ['section-label', 10, 25], ['lead', 50, 30],
        ['a', 100, 70], ['a-label', 100, 30], ['child', 140, 30], ['child-label', 140, 30],
        ['b', 190, 30], ['b-label', 190, 30], ['tail', 240, 30],
    ] as Array<[string, number, number]>)
        vi.spyOn(dom(handle, id), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 200, height))

    vi.spyOn(handle.view.dom, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 350))
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(dom(handle, 'section'))

    return handle
}

afterEach(() => {
    for (const handle of mounted.splice(0))
        handle.destroy()

    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('nested-list row drag gestures', () => {
    it('starts from row text in view mode only after movement and suppresses navigation on drop', () => {
        vi.useFakeTimers()
        const onActivate = vi.fn()
        const onChange = vi.fn()
        const handle = mount({
            onActivate,
            onChange,
        })
        const label = dom(handle, 'a-label')
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(label, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 12, 11)
        expect(handle.mode).toBe('view')
        expect(handle.view.dom.closest('.nested-list')?.hasAttribute('data-nested-list-dragging')).toBe(false)
        pointer(document, 'pointermove', 10, 135)
        expect(handle.mode).toBe('view')
        expect(handle.view.dom.closest('.nested-list')?.getAttribute('data-nested-list-dragging')).toBe('true')
        expect(dom(handle, 'a').hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.dataset.nestedListDrop).toBe('after')
        expect(onChange).not.toHaveBeenCalled()
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.dom.closest('.nested-list')?.hasAttribute('data-nested-list-dragging')).toBe(false)
        expect(dom(handle, 'a').hasAttribute('data-nested-list-source')).toBe(false)
        expect(handle.mode).toBe('view')
        expect(handle.view.state.doc.lastChild?.firstChild?.attrs.entryId).toBe('a')
        expect(onChange).toHaveBeenCalledOnce()
        dom(handle, 'a').dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
        }))
        expect(onActivate).not.toHaveBeenCalled()
        vi.runAllTimers()
        expect(onActivate).not.toHaveBeenCalled()
        dom(handle, 'a').dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            detail: 2,
        }))
        expect(handle.mode).toBe('view')
    })

    it('leaves text selection alone in edit mode and permits dragging from row padding', () => {
        const handle = mount()
        handle.enterEdit()
        const range = document.createRange()
        vi.spyOn(document, 'createRange').mockReturnValue(range)
        vi.spyOn(range, 'getClientRects').mockReturnValue([
            {
                left: 0,
                right: 80,
                top: 0,
                bottom: 30,
            },
        ] as unknown as DOMRectList)
        dropAt(dom(handle, 'tail'))
        const before = handle.view.state.doc
        pointer(dom(handle, 'a-label'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        pointer(dom(handle, 'a'), 'pointerdown', 120, 10)
        pointer(document, 'pointermove', 10, 135)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.lastChild?.firstChild?.attrs.entryId).toBe('a')
        expect(handle.mode).toBe('edit')
    })

    it('uses the left drag affordance without navigating or selecting text', () => {
        vi.useFakeTimers()
        const onActivate = vi.fn()
        const handle = mount({ onActivate })
        pointer(dom(handle, 'a'), 'pointermove', 10, 10)
        const drag = handle.view.dom.parentElement?.querySelector<HTMLElement>('.nested-list-block-drag-handle')!
        expect(drag.hidden).toBe(false)
        drag.click()
        vi.runAllTimers()
        expect(onActivate).not.toHaveBeenCalled()

        handle.enterEdit()
        const range = document.createRange()
        vi.spyOn(document, 'createRange').mockReturnValue(range)
        vi.spyOn(range, 'getClientRects').mockReturnValue([
            {
                left: 0,
                right: 80,
                top: 0,
                bottom: 30,
            },
        ] as unknown as DOMRectList)
        dropAt(dom(handle, 'tail'))
        const pointerDown = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 7,
            clientX: 10,
            clientY: 10,
        })
        drag.dispatchEvent(pointerDown)
        expect(pointerDown.defaultPrevented).toBe(true)
        pointer(document, 'pointermove', 10, 135)
        expect(dom(handle, 'tail').dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.lastChild?.firstChild?.attrs.entryId).toBe('a')
        expect(onActivate).not.toHaveBeenCalled()
    })

    it.each([
        ['lead', 'tail'],
        ['tail', 'lead'],
        ['a', 'tail'],
    ])('uses the same overlay gesture and feedback for %s', (sourceId, targetId) => {
        const onActivate = vi.fn()
        const onChange = vi.fn()
        const handle = mount({
            onActivate,
            onChange,
        })
        const source = dom(handle, sourceId)
        const target = dom(handle, targetId)
        const drag = handle.view.dom.parentElement?.querySelector<HTMLElement>('.nested-list-block-drag-handle')!
        const before = handle.view.state.doc
        dropAt(target)
        pointer(source, 'pointermove', 10, 10)
        expect(drag.hidden).toBe(false)
        expect(drag.querySelector('svg')).not.toBeNull()
        const down = new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 7,
            clientX: 10,
            clientY: 10,
        })
        drag.dispatchEvent(down)
        expect(down.defaultPrevented).toBe(true)
        pointer(document, 'pointermove', 12, 11)
        expect(handle.mode).toBe('view')
        expect(handle.view.state.doc.eq(before)).toBe(true)
        pointer(document, 'pointercancel', 12, 11)
        expect(source.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)

        pointer(source, 'pointermove', 10, 10)
        pointer(drag, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        expect(handle.mode).toBe('view')
        expect(handle.view.dom.closest('.nested-list')?.dataset.nestedListDragging).toBe('true')
        expect(source.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 10, 135)
        expect(findNestedListEntry(handle.view.state.doc, sourceId)!.pos).toBeGreaterThan(findNestedListEntry(handle.view.state.doc, targetId)!.pos)
        expect(source.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        expect(onChange).toHaveBeenCalledOnce()
        expect(onActivate).not.toHaveBeenCalled()
    })

    it.each(['paragraph', 'heading'] as const)('drags a section body %s through the same overlay', type => {
        const handle = mount({ document: {
            type: 'doc',
            content: [{
                type: 'section',
                attrs: {
                    entryId: 'a',
                    itemType: 'text',
                    data: null,
                    tagIds: [],
                },
                content: [{
                    type: 'paragraph',
                    attrs: { entryId: 'a-label' },
                    content: [{
                        type: 'text',
                        text: 'a',
                    }],
                }, {
                    type,
                    attrs: {
                        entryId: 'body',
                        ...(type === 'heading' ? { level: 2 } : {}),
                    },
                    content: [{
                        type: 'text',
                        text: 'Body',
                    }],
                }],
            }, {
                type: 'heading',
                attrs: {
                    entryId: 'tail',
                    level: 2,
                },
                content: [{
                    type: 'text',
                    text: 'Tail',
                }],
            }],
        } })
        const source = dom(handle, 'body')
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(source, 'pointermove', 10, 10)
        const drag = handle.view.dom.parentElement?.querySelector<HTMLElement>('.nested-list-block-drag-handle')!
        expect(drag.hidden).toBe(false)
        pointer(drag, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        expect(source.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 10, 135)
        expect(findNestedListEntry(handle.view.state.doc, 'body')!.pos).toBeGreaterThan(findNestedListEntry(handle.view.state.doc, 'tail')!.pos)
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.childCount).toBe(1)
    })

    it.each(['cancel', 'drop'] as const)('lets a fresh collapse click through after drag %s', outcome => {
        const onCollapseChange = vi.fn()
        const handle = mount({
            onCollapseChange,
            document: {
                type: 'doc',
                content: [{
                    type: 'bullet_list',
                    attrs: { entryId: 'list' },
                    content: [{
                        type: 'list_item',
                        attrs: {
                            entryId: 'a',
                            itemType: 'text',
                            data: null,
                            tagIds: [],
                        },
                        content: [{
                            type: 'paragraph',
                            attrs: { entryId: 'a-label' },
                            content: [{
                                type: 'text',
                                text: 'a',
                            }],
                        }, {
                            type: 'bullet_list',
                            attrs: { entryId: 'children' },
                            content: [{
                                type: 'list_item',
                                attrs: {
                                    entryId: 'child',
                                    itemType: 'text',
                                    data: null,
                                    tagIds: [],
                                },
                                content: [{
                                    type: 'paragraph',
                                    attrs: { entryId: 'child-label' },
                                    content: [{
                                        type: 'text',
                                        text: 'child',
                                    }],
                                }],
                            }],
                        }],
                    }],
                }, {
                    type: 'heading',
                    attrs: {
                        entryId: 'tail',
                        level: 2,
                    },
                    content: [{
                        type: 'text',
                        text: 'Tail',
                    }],
                }],
            },
        })
        dropAt(dom(handle, 'tail'))
        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        const preview = document.querySelector<HTMLElement>('.nested-list-drag-preview')!
        expect(preview.querySelectorAll('li.nested-list-item')).toHaveLength(2)
        pointer(document, outcome === 'cancel' ? 'pointercancel' : 'pointerup', 10, 135)
        expect(preview.isConnected).toBe(false)
        expect(dom(handle, 'a').hasAttribute('data-nested-list-drag-source')).toBe(false)
        const collapse = dom(handle, 'a').querySelector<HTMLButtonElement>('.nested-list-collapse')!
        pointer(collapse, 'pointerdown', 10, 10)
        collapse.click()
        expect(onCollapseChange).toHaveBeenCalledWith('a', true)
    })

    it.each(['lead', 'a', 'tail'])('lifts a %s clone with the pointer and restores its source on cancel', sourceId => {
        const handle = mount()
        const source = dom(handle, sourceId)
        const before = handle.view.state.doc
        const target = dom(handle, sourceId === 'tail' ? 'lead' : 'tail')
        dropAt(target)
        vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 180, 40))
        source.id = 'source-only-id'
        pointer(source, 'pointerdown', 20, 30)
        pointer(document, 'pointermove', 22, 31)
        expect(document.querySelector('.nested-list-drag-preview')).toBeNull()
        expect(source.hasAttribute('data-nested-list-drag-source')).toBe(false)
        pointer(document, 'pointermove', 50, 60)
        const preview = document.querySelector<HTMLElement>('.nested-list-drag-preview')!
        const clone = preview.querySelector<HTMLElement>(source.tagName.toLowerCase())!
        expect(preview.parentElement).toBe(document.body)
        expect(preview.getAttribute('aria-hidden')).toBe('true')
        expect(preview.hasAttribute('inert')).toBe(true)
        expect(preview.style.transform).toBe('translate3d(40px, 50px, 0)')
        expect(preview.style.width).toBe('180px')
        expect(clone).not.toBe(source)
        expect(clone.id).toBe('')
        expect(clone.textContent).toBe(source.textContent)
        expect(source.dataset.nestedListDragSource).toBe('true')
        expect(source.isConnected).toBe(true)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        pointer(document, 'pointermove', 70, 90)
        expect(preview.style.transform).toBe('translate3d(60px, 80px, 0)')
        pointer(document, 'pointercancel', 70, 90)
        expect(preview.isConnected).toBe(false)
        expect(source.hasAttribute('data-nested-list-drag-source')).toBe(false)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(handle.mode).toBe('view')
    })

    it('shows an inside line at the target and nests the complete item without entering edit mode', () => {
        const handle = mount()
        const target = dom(handle, 'a')
        dropAt(target)
        pointer(dom(handle, 'b'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 120)
        expect(handle.mode).toBe('view')
        expect(target.dataset.nestedListDrop).toBe('inside')
        expect(dom(handle, 'b').hasAttribute('data-nested-list-source')).toBe(false)
        pointer(document, 'pointerup', 10, 120)
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.lastChild?.firstChild?.attrs.entryId).toBe('b')
        expect(handle.mode).toBe('view')
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
    })

    it('rejects protected drop previews without buffering document changes', () => {
        const onChange = vi.fn()
        const guard = vi.fn(() => false)
        const handle = mount({
            filterTransaction: guard,
            onChange,
        })
        const before = handle.view.state.doc
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(dom(handle, 'a-label'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        expect(guard).toHaveBeenCalled()
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('rechecks a changed consumer guard at drop', () => {
        let allowed = true
        const handle = mount({ filterTransaction: () => allowed })
        const before = handle.view.state.doc
        dropAt(dom(handle, 'tail'))
        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        allowed = false
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })

    it('keeps one preview for unchanged targets and rechecks the pointer at release', () => {
        const guard = vi.fn(() => true)
        const handle = mount({ filterTransaction: guard })
        const before = handle.view.state.doc
        const target = dom(handle, 'tail')
        const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 40))

        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        expect(target.dataset.nestedListDrop).toBe('after')
        expect(guard).toHaveBeenCalledOnce()
        pointer(document, 'pointermove', 11, 134)
        expect(guard).toHaveBeenCalledOnce()

        hit.mockReturnValue(document.body)
        pointer(document, 'pointerup', 11, 134)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        expect(dom(handle, 'a').hasAttribute('data-nested-list-source')).toBe(false)
    })

    it('drops before or after the top-level content when released in the editor blank area', () => {
        for (const placement of ['before', 'after'] as const) {
            const handle = mount()
            const editor = handle.view.dom
            const first = dom(handle, 'lead')
            const last = dom(handle, 'tail')
            vi.spyOn(document, 'elementFromPoint').mockReturnValue(editor)
            vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 300))
            vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 200, 40))
            vi.spyOn(last, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 150, 200, 40))
            const entryId = placement === 'before' ? 'b' : 'a'
            const y = placement === 'before' ? 10 : 250
            const edge = placement === 'before' ? first : last

            pointer(dom(handle, entryId), 'pointerdown', 10, 100)
            pointer(document, 'pointermove', 10, y)
            expect(edge.dataset.nestedListDrop).toBe(placement)
            pointer(document, 'pointerup', 10, y)
            expect(edge.hasAttribute('data-nested-list-drop')).toBe(false)
            const moved = placement === 'before'
                ? handle.view.state.doc.firstChild?.firstChild
                : handle.view.state.doc.lastChild?.firstChild
            expect(moved?.attrs.entryId).toBe(entryId)
        }
    })

    it('uses an allowed child boundary below a protected outer item', () => {
        const item = (id: string, content: unknown[] = []): unknown => ({
            type: 'list_item',
            attrs: {
                entryId: id,
                itemType: 'text',
                data: null,
                tagIds: [],
            },
            content: [{
                type: 'paragraph',
                attrs: { entryId: `${id}-label` },
                content: [{
                    type: 'text',
                    text: id,
                }],
            }, ...content],
        })
        const list = (id: string, content: unknown[]): unknown => ({
            type: 'bullet_list',
            attrs: { entryId: id },
            content,
        })
        const handle = mount({
            document: {
                type: 'doc',
                content: [list('outer', [
                    item('protected', [list('inner', [
                        item('parent', [list('children', [item('child')])]),
                        item('sibling'),
                    ])]),
                ])],
            },
            filterTransaction: transaction =>
                transaction.doc.childCount === 1
                && transaction.doc.firstChild?.childCount === 1
                && transaction.doc.firstChild?.firstChild?.attrs.entryId === 'protected',
        })
        const editor = handle.view.dom
        const outer = editor.firstElementChild as HTMLElement
        const sibling = dom(handle, 'sibling')
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(editor)
        vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 300))
        vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 190))

        pointer(dom(handle, 'child'), 'pointerdown', 10, 100)
        pointer(document, 'pointermove', 10, 250)
        expect(dom(handle, 'protected').hasAttribute('data-nested-list-drop')).toBe(false)
        expect(sibling.dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 10, 250)

        expect(findNestedListEntry(handle.view.state.doc, 'protected')!.node.lastChild?.lastChild?.attrs.entryId).toBe('child')
        expect(findNestedListEntry(handle.view.state.doc, 'parent')!.node.childCount).toBe(1)
    })

    it('does not preview an invisible child boundary below a collapsed item', () => {
        const row = (id: string, content: unknown[] = []): unknown => ({
            type: 'list_item',
            attrs: {
                entryId: id,
                itemType: 'text',
                data: null,
                tagIds: [],
            },
            content: [{
                type: 'paragraph',
                attrs: { entryId: `${id}-label` },
                content: [{
                    type: 'text',
                    text: id,
                }],
            }, ...content],
        })
        const guard = vi.fn(() => false)
        const handle = mount({
            document: {
                type: 'doc',
                content: [{
                    type: 'bullet_list',
                    attrs: { entryId: 'outer' },
                    content: [
                        row('source'),
                        row('parent', [{
                            type: 'bullet_list',
                            attrs: { entryId: 'children' },
                            content: [row('hidden-child')],
                        }]),
                    ],
                }],
            },
            collapsed: ['parent'],
            filterTransaction: guard,
        })
        const editor = handle.view.dom
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(editor)
        vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 300))
        vi.spyOn(editor.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 190))

        pointer(dom(handle, 'source'), 'pointerdown', 10, 100)
        pointer(document, 'pointermove', 10, 250)
        expect(guard).toHaveBeenCalledOnce()
        expect(dom(handle, 'parent').hasAttribute('data-nested-list-drop')).toBe(false)
        expect(dom(handle, 'hidden-child').hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 10, 250)
    })

    it('drags through non-interactive SVG descendants of custom rows', () => {
        const handle = mount()
        const icon = (row: HTMLElement): SVGPathElement => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            svg.append(path)
            row.append(svg)

            return path
        }
        const source = dom(handle, 'a')
        const target = dom(handle, 'b')
        const sourceIcon = icon(source)
        const targetIcon = icon(target)
        vi.spyOn(document, 'elementFromPoint').mockReturnValue(targetIcon)
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 40))
        vi.spyOn(dom(handle, 'b-label'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 40))

        pointer(sourceIcon, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        expect(target.dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.child(1).firstChild?.attrs.entryId).toBe('b')
        expect(handle.view.state.doc.child(1).lastChild?.attrs.entryId).toBe('a')
    })

    it('ignores interactive row controls and all read-only drags', () => {
        const handle = mount()
        const control = document.createElement('button')
        dom(handle, 'a').appendChild(control)
        dropAt(dom(handle, 'tail'))
        pointer(control, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.mode).toBe('view')
        const readOnly = mount({ readOnly: true })
        pointer(dom(readOnly, 'a-label'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        pointer(document, 'pointerup', 10, 135)
        expect(readOnly.mode).toBe('view')
        expect(readOnly.view.dom.parentElement?.querySelector('.nested-list-block-trigger')).toBeNull()
    })

    it('cancels an active drag and exits editing on Escape', () => {
        const handle = mount()
        const before = handle.view.state.doc
        const sourceRow = dom(handle, 'a')
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(sourceRow, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        handle.view.focus()
        const key = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        })
        handle.view.dom.dispatchEvent(key)

        expect(key.defaultPrevented).toBe(true)
        expect(handle.mode).toBe('view')
        expect(document.activeElement).not.toBe(handle.view.dom)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(sourceRow.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        expect(handle.view.dom.closest('.nested-list')?.hasAttribute('data-nested-list-dragging')).toBe(false)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })

    it('removes the lifted clone and source marker when the editor is destroyed', () => {
        const handle = mount()
        const source = dom(handle, 'a')
        dropAt(dom(handle, 'tail'))
        pointer(source, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        const preview = document.querySelector<HTMLElement>('.nested-list-drag-preview')!
        expect(preview).not.toBeNull()
        expect(source.dataset.nestedListDragSource).toBe('true')
        mounted.splice(mounted.indexOf(handle), 1)
        handle.destroy()
        expect(preview.isConnected).toBe(false)
        expect(source.hasAttribute('data-nested-list-drag-source')).toBe(false)
    })

    it('cleans up a drag on window blur and lets native text dragging continue', () => {
        const handle = mount()
        const before = handle.view.state.doc
        const sourceRow = dom(handle, 'a')
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(sourceRow, 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        const preview = document.querySelector<HTMLElement>('.nested-list-drag-preview')!
        expect(preview).not.toBeNull()
        window.dispatchEvent(new Event('blur'))
        expect(preview.isConnected).toBe(false)
        expect(sourceRow.hasAttribute('data-nested-list-drag-source')).toBe(false)
        expect(sourceRow.hasAttribute('data-nested-list-source')).toBe(false)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        expect(handle.view.dom.closest('.nested-list')?.hasAttribute('data-nested-list-dragging')).toBe(false)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)

        handle.enterEdit()
        const range = document.createRange()
        vi.spyOn(document, 'createRange').mockReturnValue(range)
        vi.spyOn(range, 'getClientRects').mockReturnValue([
            {
                left: 0,
                right: 80,
                top: 0,
                bottom: 30,
            },
        ] as unknown as DOMRectList)
        const label = dom(handle, 'a-label')
        pointer(label, 'pointerdown', 10, 10)
        const native = new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
        })
        label.dispatchEvent(native)
        expect(native.defaultPrevented).toBe(false)
        pointer(document, 'pointermove', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })

    it('blocks native drag handlers after the custom row gesture starts', () => {
        const handle = mount()
        const competing = vi.fn()
        handle.view.dom.addEventListener('dragstart', competing)
        dropAt(dom(handle, 'tail'))
        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        const native = new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
        })
        dom(handle, 'a-label').dispatchEvent(native)

        expect(native.defaultPrevented).toBe(true)
        expect(competing).not.toHaveBeenCalled()
        pointer(document, 'pointercancel', 10, 135)
    })

    it('cleans up the active gesture on cancellation and destruction', () => {
        const handle = mount()
        const before = handle.view.state.doc
        const target = dom(handle, 'tail')
        dropAt(target)
        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        pointer(document, 'pointercancel', 10, 135)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 10, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        pointer(dom(handle, 'a'), 'pointerdown', 10, 10)
        pointer(document, 'pointermove', 10, 135)
        handle.destroy()
        mounted.splice(mounted.indexOf(handle), 1)
        expect(target.hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 10, 135)
    })
})

describe('nested-list drop geometry', () => {
    it.each([
        ['lead', 60, 'view'], ['tail', 250, 'view'], ['a', 110, 'view'],
        ['lead', 60, 'edit'], ['tail', 250, 'edit'], ['a', 110, 'edit'],
    ] as Array<[string, number, 'view' | 'edit']>)('keeps %s in place after a small drag at %i in %s mode', (entryId, y, mode) => {
        const onChange = vi.fn()
        const handle = sectionScene({ onChange })

        if (mode === 'edit')
            handle.enterEdit()

        const before = handle.view.state.doc
        const source = dom(handle, entryId)
        pointer(source, 'pointerdown', 40, y)
        pointer(document, 'pointermove', 44, y + 4)
        expect(document.querySelector('.nested-list-drag-preview')).not.toBeNull()
        expect(source.dataset.nestedListDragSource).toBe('true')
        expect(handle.view.dom.querySelector('[data-nested-list-drop]')).toBeNull()
        pointer(document, 'pointerup', 44, y + 4)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(handle.mode).toBe(mode)
        expect(onChange).not.toHaveBeenCalled()
        expect(source.hasAttribute('data-nested-list-drag-source')).toBe(false)
    })

    it.each([2, 10])('keeps a nested row in place after its left drag handle moves to x=%i', x => {
        const handle = sectionScene()
        handle.enterEdit()
        const source = dom(handle, 'child')
        vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(48, 140, 152, 30))
        const before = handle.view.state.doc
        pointer(source, 'pointermove', 60, 150)
        const drag = handle.view.dom.parentElement!.querySelector<HTMLElement>('.nested-list-block-drag-handle')!
        pointer(drag, 'pointerdown', 6, 150)
        pointer(document, 'pointermove', x, 154)
        expect(source.dataset.nestedListDragSource).toBe('true')
        expect(handle.view.dom.querySelector('[data-nested-list-drop]')).toBeNull()
        pointer(document, 'pointerup', x, 154)
        expect(handle.view.state.doc.eq(before)).toBe(true)
        expect(handle.mode).toBe('edit')
    })

    it('does not target an enclosing section through the hidden source subtree', () => {
        const handle = sectionScene()
        const before = handle.view.state.doc
        pointer(dom(handle, 'a'), 'pointerdown', 40, 110)
        pointer(document, 'pointermove', 44, 150)
        expect(handle.view.dom.querySelector('[data-nested-list-drop]')).toBeNull()
        pointer(document, 'pointerup', 44, 150)
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })

    it('clears a distant preview when release returns to the source placeholder', () => {
        const handle = sectionScene()
        const before = handle.view.state.doc
        pointer(dom(handle, 'a'), 'pointerdown', 40, 110)
        pointer(document, 'pointermove', 40, 265)
        expect(dom(handle, 'tail').dataset.nestedListDrop).toBe('after')
        pointer(document, 'pointerup', 44, 114)
        expect(handle.view.dom.querySelector('[data-nested-list-drop]')).toBeNull()
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })

    it('uses the child boundary under the pointer instead of the end of its ancestor subtree', () => {
        const handle = sectionScene()
        pointer(dom(handle, 'b'), 'pointerdown', 40, 200)
        pointer(document, 'pointermove', 40, 135)
        expect(dom(handle, 'child').dataset.nestedListDrop).toBe('before')
        expect(dom(handle, 'a').hasAttribute('data-nested-list-drop')).toBe(false)
        expect(dom(handle, 'section').hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 40, 135)
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.lastChild!.firstChild!.attrs.entryId).toBe('b')
    })

    it('places a standalone block at the local gap beside a complete list', () => {
        const handle = sectionScene()
        pointer(dom(handle, 'lead'), 'pointerdown', 40, 60)
        pointer(document, 'pointermove', 40, 230)
        expect(dom(handle, 'tail').dataset.nestedListDrop).toBe('before')
        expect(dom(handle, 'section').hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 40, 230)
        const section = findNestedListEntry(handle.view.state.doc, 'section')!.node
        expect(section.child(1).type.name).toBe('bullet_list')
        expect(section.child(2).attrs.entryId).toBe('lead')
        expect(section.child(3).attrs.entryId).toBe('tail')
    })

    it('uses the full row width with only the label height when hovering right-side chrome', () => {
        const handle = sectionScene()
        vi.spyOn(dom(handle, 'a-label'), 'getBoundingClientRect').mockReturnValue(new DOMRect(24, 100, 100, 30))
        pointer(dom(handle, 'b'), 'pointerdown', 40, 200)
        pointer(document, 'pointermove', 180, 115)
        expect(dom(handle, 'a').dataset.nestedListDrop).toBe('inside')
        expect(dom(handle, 'section').hasAttribute('data-nested-list-drop')).toBe(false)
        pointer(document, 'pointerup', 180, 115)
        expect(findNestedListEntry(handle.view.state.doc, 'a')!.node.lastChild!.lastChild!.attrs.entryId).toBe('b')
    })

    it('does not search for a distant destination after the local boundary is rejected', () => {
        const guard = vi.fn(() => false)
        const handle = sectionScene({ filterTransaction: guard })
        const before = handle.view.state.doc
        pointer(dom(handle, 'b'), 'pointerdown', 40, 200)
        pointer(document, 'pointermove', 40, 135)
        expect(guard).toHaveBeenCalledOnce()
        expect(handle.view.dom.querySelector('[data-nested-list-drop]')).toBeNull()
        pointer(document, 'pointerup', 40, 135)
        expect(handle.view.state.doc.eq(before)).toBe(true)
    })
})

describe('nested-list keyboard block conversion', () => {
    it('preserves each selected block identity and bold while keeping item labels as paragraphs', () => {
        const handle = mount()
        handle.enterEdit()
        const tail = findNestedListEntry(handle.view.state.doc, 'tail')!
        handle.view.dispatch(handle.view.state.tr.setSelection(TextSelection.create(
            handle.view.state.doc,
            1,
            tail.pos + 2,
        )))
        handle.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: '1',
            code: 'Digit1',
            ctrlKey: true,
            altKey: true,
        }))
        expect(findNestedListEntry(handle.view.state.doc, 'lead')?.node.attrs).toMatchObject({
            entryId: 'lead',
            bold: true,
            level: 1,
        })
        expect(findNestedListEntry(handle.view.state.doc, 'tail')?.node.attrs).toMatchObject({
            entryId: 'tail',
            bold: false,
            level: 1,
        })
        expect(findNestedListEntry(handle.view.state.doc, 'a-label')?.node.type.name).toBe('paragraph')
    })
})
