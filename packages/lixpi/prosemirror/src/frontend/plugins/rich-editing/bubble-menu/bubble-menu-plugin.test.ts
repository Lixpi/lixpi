// @vitest-environment happy-dom
import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'

import {
    doc,
    p,
    img,
    createStateWithNodeSelection,
    createMockImageWrapper,
    createMockEditorView
} from '@lixpi/prosemirror/test-helpers'
import { BubbleMenuView } from './bubble-menu-plugin.ts'

const findNodeSelectionPos = (document: any, nodeType: string): number => {
    for (let position = 0; position < document.content.size; position += 1) {
        const candidate = document.resolve(position).nodeAfter

        if (candidate?.type.name === nodeType)
            return position
    }

    throw new Error(`No node of type ${nodeType} found`)
}

type BubbleMenuMockState = {
    show: ReturnType<typeof vi.fn>
    hide: ReturnType<typeof vi.fn>
    reposition: ReturnType<typeof vi.fn>
    updateContext: ReturnType<typeof vi.fn>
    forceHide: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}

const {
    bubbleMenuMockState,
    getSelectionContextMock,
    buildBubbleMenuItemsMock,
    updateImageButtonStatesMock,
    updateMenuItemMock,
} = vi.hoisted(
    (): {
        bubbleMenuMockState: BubbleMenuMockState[]
        getSelectionContextMock: ReturnType<typeof vi.fn>
        buildBubbleMenuItemsMock: ReturnType<typeof vi.fn>
        updateImageButtonStatesMock: ReturnType<typeof vi.fn>
        updateMenuItemMock: ReturnType<typeof vi.fn>
    } => {
        const state: BubbleMenuMockState[] = []
        const updateMenuItemMock = vi.fn()
        const getSelectionContextMock = vi.fn(() => 'none' as const)
        const updateImageButtonStatesMock = vi.fn()

        const buildBubbleMenuItemsMock = vi.fn(() => ({
            items: [
                {
                    element: document.createElement('button'),
                    context: ['text'],
                    update: updateMenuItemMock,
                },
            ],
            linkInputPanel: document.createElement('div'),
        }))

        return {
            bubbleMenuMockState: state,
            getSelectionContextMock,
            buildBubbleMenuItemsMock,
            updateImageButtonStatesMock,
            updateMenuItemMock,
        }
    },
)

vi.mock('@lixpi/ui-kit/components/bubble-menu', () => ({
    BubbleMenu: function BubbleMenuMock(this: any, opts: any) {
        this.element = document.createElement('div')
        this.isVisible = false
        this.preventHide = false
        this.show = vi.fn()
        this.hide = vi.fn(() => {
            this.isVisible = false

            if (opts.onHide)
                opts.onHide()
        })
        this.reposition = vi.fn()
        this.updateContext = vi.fn()
        this.forceHide = vi.fn()
        this.destroy = vi.fn()

        const showSpy = this.show
        this.show = vi.fn((context: string, position: unknown) => {
            this.isVisible = true
            showSpy(context, position)
        })

        const textButton = document.createElement('button')
        textButton.className = 'bubble-menu-button'
        textButton.classList.add('is-active')
        textButton.dataset.update = 'true'
        textButton.dataset.markType = 'strong'
        this.element.appendChild(textButton)

        for (const item of opts.items) {
            this.element.appendChild(item.element)
        }

        bubbleMenuMockState.push({
            show: this.show,
            hide: this.hide,
            reposition: this.reposition,
            updateContext: this.updateContext,
            forceHide: this.forceHide,
            destroy: this.destroy,
        })
    },
}))

vi.mock('./bubble-menu-items.ts', () => {
    const mockTextButton = document.createElement('button')
    mockTextButton.className = 'bubble-menu-button'
    mockTextButton.dataset.update = 'true'
    mockTextButton.dataset.markType = 'strong'

    return {
        buildBubbleMenuItems: buildBubbleMenuItemsMock.mockReturnValue({
            items: [
                {
                    element: mockTextButton,
                    context: ['text'],
                    update: updateMenuItemMock,
                },
            ],
            linkInputPanel: document.createElement('div'),
        }),
        getSelectionContext: getSelectionContextMock,
        updateImageButtonStates: updateImageButtonStatesMock,
        MenuItemElement: {} as any,
        SelectionContext: {} as any,
    }
})

describe('BubbleMenuView', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        bubbleMenuMockState.length = 0
        getSelectionContextMock.mockReset().mockReturnValue('none')
    })

    it('shows text context menu when update is called while visible state is false', () => {
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        const menu = new BubbleMenuView({ view })
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'above',
        }))

        menu.update()

        const bubbleMenu = bubbleMenuMockState.at(-1)
        expect(bubbleMenu?.show).toHaveBeenCalled()
        expect(updateMenuItemMock).toHaveBeenCalled()
        expect(bubbleMenu?.reposition).not.toHaveBeenCalled()
    })

    it('closes when focus moves elsewhere on the page, but not into the menu or to another window', () => {
        vi.useFakeTimers()
        const hasFocus = vi.fn(() => false)
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
            hasFocus,
        })
        const menu = new BubbleMenuView({ view })
        const bubbleMenu = bubbleMenuMockState.at(-1)!
        const insideMenu = document.createElement('input')
        ;(menu as any).bubbleMenu.element.appendChild(insideMenu)
        const pageFocus = vi.spyOn(document, 'hasFocus')

        view.dom.dispatchEvent(new FocusEvent('focusout', { relatedTarget: insideMenu }))
        vi.runAllTimers()
        expect(bubbleMenu.hide).not.toHaveBeenCalled()

        // Another window took focus: the page itself has none.
        pageFocus.mockReturnValue(false)
        view.dom.dispatchEvent(new FocusEvent('focusout'))
        vi.runAllTimers()
        expect(bubbleMenu.hide).not.toHaveBeenCalled()

        pageFocus.mockReturnValue(true)
        view.dom.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }))
        vi.runAllTimers()
        expect(bubbleMenu.hide).toHaveBeenCalledTimes(1)

        pageFocus.mockRestore()
        vi.useRealTimers()
    })

    it('stays closed after a press outside the editor, even when the editor updates and keeps focus', () => {
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        ;(view as any).hasFocus = () => true
        ;(view as any).editable = true
        const menu = new BubbleMenuView({ view })
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'below',
        }))
        const bubbleMenu = bubbleMenuMockState.at(-1)!
        const canvas = document.createElement('div')
        document.body.appendChild(canvas)

        menu.update()
        expect(bubbleMenu.show).toHaveBeenCalledTimes(1)

        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        menu.update()

        expect(bubbleMenu.hide).toHaveBeenCalled()
        expect(bubbleMenu.show).toHaveBeenCalledTimes(1)

        // Selecting text again brings it back.
        const text = document.createElement('p')
        view.dom.appendChild(text)
        ;(view as any).posAtDOM = () => 1
        text.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        }))
        document.dispatchEvent(new MouseEvent('mouseup'))
        menu.update()

        expect(bubbleMenu.show).toHaveBeenCalledTimes(2)
        canvas.remove()
    })

    it('stays closed after a press on the editor\'s empty space', () => {
        vi.useFakeTimers()
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        ;(view as any).editable = true
        const menu = new BubbleMenuView({ view })
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'below',
        }))
        const bubbleMenu = bubbleMenuMockState.at(-1)!

        view.dom.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        }))
        document.dispatchEvent(new MouseEvent('mouseup'))
        vi.advanceTimersByTime(50)
        menu.update()

        expect(bubbleMenu.show).not.toHaveBeenCalled()
        vi.useRealTimers()
    })

    it('does not reopen after a press that a feature consumed', () => {
        vi.useFakeTimers()
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        const menu = new BubbleMenuView({ view })
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'above',
        }))
        const bubbleMenu = bubbleMenuMockState.at(-1)!
        const consumed = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        })
        consumed.preventDefault()

        view.dom.dispatchEvent(consumed)
        document.dispatchEvent(new MouseEvent('mouseup'))
        vi.advanceTimersByTime(50)

        menu.update()

        expect(bubbleMenu.hide).toHaveBeenCalled()
        expect(bubbleMenu.show).not.toHaveBeenCalled()
        vi.useRealTimers()
    })

    it('updates image menu states and marks the active image wrapper', () => {
        getSelectionContextMock.mockReturnValue('image')
        const wrapper = createMockImageWrapper()
        const imageDoc = doc(p(img({ src: 'https://example.com/image.png' })))
        const imageState = createStateWithNodeSelection(imageDoc, findNodeSelectionPos(imageDoc, 'image'))
        const view = createMockEditorView({
            state: imageState,
            nodeDOM: () => wrapper,
        })
        const menu = new BubbleMenuView({ view })
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'below',
        }))

        menu.update()

        expect(updateImageButtonStatesMock).toHaveBeenCalledWith(expect.any(Array), view)
        expect(wrapper.classList.contains('pm-image-menu-active')).toBe(true)
    })

    it('does nothing while link input is active in update()', () => {
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        const menu = new BubbleMenuView({ view })

        menu.showLinkInput()
        ;(menu as any).getPositionRequest = vi.fn(() => ({
            targetRect: new DOMRect(10, 20, 30, 40),
            placement: 'above',
        }))

        menu.update()

        const bubbleMenu = bubbleMenuMockState.at(-1)
        expect(bubbleMenu?.show).not.toHaveBeenCalled()
        expect(updateImageButtonStatesMock).not.toHaveBeenCalled()
    })

    it('destroys listeners and bubble menu instance on destroy()', () => {
        getSelectionContextMock.mockReturnValue('text')
        const view = createMockEditorView({
            state: createStateWithNodeSelection(doc(p('hello')), 1),
        })
        const documentRemoveMouseUp = vi.spyOn(document, 'removeEventListener')
        const domRemoveMouseDown = vi.spyOn(view.dom, 'removeEventListener')

        const menu = new BubbleMenuView({ view })
        menu.destroy()

        expect(domRemoveMouseDown).toHaveBeenCalledWith('mousedown', expect.any(Function))
        expect(domRemoveMouseDown).toHaveBeenCalledWith('touchstart', expect.any(Function))
        expect(documentRemoveMouseUp).toHaveBeenCalledWith('mouseup', expect.any(Function))
        expect(documentRemoveMouseUp).toHaveBeenCalledWith('touchend', expect.any(Function))

        const bubbleMenu = bubbleMenuMockState.at(-1)
        expect(bubbleMenu?.destroy).toHaveBeenCalled()
    })
})
