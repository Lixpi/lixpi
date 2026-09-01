import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import {
    doc,
    p,
    img,
    createStateWithNodeSelection,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
    createMockImageWrapper,
    createMockEditorView,
} from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'
import { BubbleMenuView } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/bubbleMenuPlugin.ts'

function findNodeSelectionPos(document: any, nodeType: string): number {
    for (let position = 0; position < document.content.size; position += 1) {
        const candidate = document.resolve(position).nodeAfter
        if (candidate?.type.name === nodeType) {
            return position
        }
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
    createBubbleMenuMock,
    bubbleMenuMockState,
    getSelectionContextMock,
    buildBubbleMenuItemsMock,
    updateImageButtonStatesMock,
    updateMenuItemMock,
} = vi.hoisted(
    (): {
        createBubbleMenuMock: typeof vi.fn
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
        const createBubbleMenuMock = vi.fn(function(opts: any) {
            const bubbleMenu = {
                element: document.createElement('div'),
                isVisible: false,
                preventHide: false,
                show: vi.fn(),
                hide: vi.fn(() => {
                    bubbleMenu.isVisible = false
                    if (opts.onHide) {
                        opts.onHide()
                    }
                }),
                reposition: vi.fn(),
                updateContext: vi.fn(),
                forceHide: vi.fn(),
                destroy: vi.fn(),
            }

            const showSpy = bubbleMenu.show
            bubbleMenu.show = vi.fn((context: string, position: unknown) => {
                bubbleMenu.isVisible = true
                showSpy(context, position)
            })

            const textButton = document.createElement('button')
            textButton.className = 'bubble-menu-button'
            textButton.classList.add('is-active')
            textButton.dataset.update = 'true'
            textButton.dataset.markType = 'strong'
            bubbleMenu.element.appendChild(textButton)

            for (const item of opts.items) {
                bubbleMenu.element.appendChild(item.element)
            }

            state.push({
                show: bubbleMenu.show as ReturnType<typeof vi.fn>,
                hide: bubbleMenu.hide,
                reposition: bubbleMenu.reposition,
                updateContext: bubbleMenu.updateContext,
                forceHide: bubbleMenu.forceHide,
                destroy: bubbleMenu.destroy,
            })

            return bubbleMenu as any
        })

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
            createBubbleMenuMock,
            bubbleMenuMockState: state,
            getSelectionContextMock,
            buildBubbleMenuItemsMock,
            updateImageButtonStatesMock,
            updateMenuItemMock,
        }
    },
)

vi.mock('@lixpi/ui-kit/components/bubble-menu', () => ({
    BubbleMenu: createBubbleMenuMock,
}))

vi.mock('$src/components/proseMirror/plugins/bubbleMenuPlugin/bubbleMenuItems.ts', () => {
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
