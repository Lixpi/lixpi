// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'
import { WorkspaceConversationLayout } from './workspace-conversation-layout.ts'

type LayoutStorage = ConstructorParameters<typeof WorkspaceConversationLayout>[0]['storage']
type PointerAction = 'pointerdown' | 'pointermove' | 'pointerup'

const storageKey = 'lixpi:conversation-layout'
const fixtures: {
    layout: WorkspaceConversationLayout
    pane: HTMLElement
}[] = []

const createFixture = (storage: LayoutStorage = window.localStorage) => {
    const pane = document.createElement('main')
    const composer = document.createElement('section')
    composer.style.width = '42rem'
    composer.style.transformOrigin = 'bottom right'
    const railHost = document.createElement('aside')
    const leading = document.createElement('div')
    const leftRail = document.createElement('nav')
    const rightRail = document.createElement('nav')
    const trailing = document.createElement('div')
    railHost.append(
        leading,
        leftRail,
        rightRail,
        trailing,
    )
    const transcript = document.createElement('div')
    const input = document.createElement('textarea')
    composer.append(
        transcript,
        input,
    )
    pane.append(
        railHost,
        composer,
    )
    document.body.append(pane)

    let paneHeight = 900
    let viewport: ViewportSnapshot = {
        x: 20,
        y: 40,
        zoom: 2,
    }
    Object.defineProperties(pane, {
        clientWidth: { value: 1200 },
        clientHeight: { get: () => paneHeight },
    })
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(25, 50, 1200, 900))
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue(new DOMRect(205, 350, 760, 576))

    const layout = new WorkspaceConversationLayout({
        pane,
        element: composer,
        controls: {
            left: leftRail,
            right: rightRail,
        },
        storage,
        settings: {
            dimensions: {
                minWidth: 320,
                maxPaneMargin: 48,
            },
            resizeHandle: {
                offset: 4,
                grabWidth: 20,
            },
        },
        getViewport: () => viewport,
    })
    fixtures.push({
        layout,
        pane,
    })

    const dropdown = composer.querySelector<HTMLElement>('.bubble-menu-inline .bubble-menu-dropdown')!
    const trigger = dropdown.querySelector<HTMLButtonElement>('.bubble-menu-dropdown-toggle')!
    vi.spyOn(dropdown, 'getBoundingClientRect').mockReturnValue(new DOMRect(880, 350, 38, 28))

    return {
        layout,
        pane,
        composer,
        transcript,
        input,
        railHost,
        originalRailOrder: [leading, leftRail, rightRail, trailing],
        rails: [leftRail, rightRail],
        trigger,
        menu: dropdown.querySelector<HTMLElement>('.bubble-menu-vertical[role="menu"]')!,
        options: [...dropdown.querySelectorAll<HTMLButtonElement>('.bubble-menu-dropdown-item')],
        moveHandle: composer.querySelector<HTMLButtonElement>('[aria-label="Move chat"]')!,
        leftResize: composer.querySelector<HTMLElement>('.workspace-conversation-layout-resize.side-panel-resize-handle-right')!,
        rightResize: composer.querySelector<HTMLElement>('.workspace-conversation-layout-resize.side-panel-resize-handle-left')!,
        setViewport: (next: ViewportSnapshot) => {
            viewport = next
            layout.updateViewport()
        },
        setPaneHeight: (height: number) => {
            paneHeight = height
            layout.refresh()
        },
    }
}

const pointer = (
    target: EventTarget,
    type: PointerAction,
    clientX: number,
    clientY = 0,
    pointerId = 1,
): void => {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId,
        clientX,
        clientY,
    }))
}

const keydown = (
    target: HTMLElement,
    key: string,
): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
    }))
}

const dragResize = (
    handle: HTMLElement,
    from: number,
    to: number,
): void => {
    pointer(handle, 'pointerdown', from)
    pointer(document, 'pointermove', to)
    pointer(document, 'pointerup', to)
}

const storeDetachedLayout = (): void => {
    window.localStorage.setItem(storageKey, JSON.stringify({
        mode: 'detached',
        width: 760,
        position: {
            x: 100,
            y: 120,
        },
    }))
}

afterEach(() => {
    for (const {
        layout,
        pane,
    } of fixtures.splice(0).reverse()) {
        layout.destroy()
        pane.remove()
    }

    window.localStorage.clear()
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
    vi.restoreAllMocks()
})

// =============================================================================
// GEOMETRY AND GESTURES
// =============================================================================

describe('WorkspaceConversationLayout geometry', () => {
    it('uses both shared resize handles and grows a centered chat equally on both sides', () => {
        const {
            composer,
            leftResize,
            rightResize,
        } = createFixture()

        expect(composer.dataset.conversationLayout).toBe('center')
        expect(composer.style.width).toBe('760px')
        expect(leftResize.classList.contains('side-panel-resize-handle')).toBe(true)
        expect(rightResize.classList.contains('side-panel-resize-handle')).toBe(true)
        expect(leftResize.hidden).toBe(false)
        expect(rightResize.hidden).toBe(false)

        dragResize(rightResize, 980, 1020)
        expect(composer.style.width).toBe('840px')
        dragResize(leftResize, 180, 160)
        expect(composer.style.width).toBe('880px')
        expect(composer.style.left).toBe('50%')
        expect(composer.style.transform).toBe('translateX(-50%)')
        expect(composer.style.bottom).toBe('24px')
    })

    it('pins a docked chat to either screen edge and exposes the same opposite resize handle', () => {
        const {
            layout,
            composer,
            leftResize,
            rightResize,
            moveHandle,
        } = createFixture()

        layout.setMode('left')
        expect(composer.style.left).toBe('0px')
        expect(composer.style.right).toBe('auto')
        expect(composer.style.transform).toBe('none')
        expect(leftResize.hidden).toBe(true)
        expect(rightResize.hidden).toBe(false)
        expect(moveHandle.hidden).toBe(true)

        dragResize(rightResize, 760, 800)
        expect(composer.style.width).toBe('800px')

        layout.setMode('right')
        expect(composer.style.left).toBe('auto')
        expect(composer.style.right).toBe('0px')
        expect(composer.style.transform).toBe('none')
        expect(leftResize.hidden).toBe(false)
        expect(rightResize.hidden).toBe(true)
        expect(moveHandle.hidden).toBe(true)

        dragResize(leftResize, 400, 380)
        expect(composer.style.width).toBe('820px')
    })

    it('detaches at the existing pane-relative position and scales the same transcript and input', () => {
        const {
            layout,
            pane,
            composer,
            transcript,
            input,
            moveHandle,
            leftResize,
            rightResize,
            setViewport,
            setPaneHeight,
        } = createFixture()
        const attachedMaxHeight = composer.style.maxHeight
        const originalPaneHeight = pane.clientHeight
        input.value = 'Unsent draft'
        input.focus()

        layout.setMode('detached')
        expect(composer.style.transform).toBe('translate(180px, 300px) scale(2)')
        expect(composer.style.transformOrigin).toBe('top left')
        expect(composer.style.width).toBe('760px')
        expect(composer.style.maxHeight).toBe(attachedMaxHeight)
        expect(moveHandle.hidden).toBe(false)
        expect(leftResize.hidden).toBe(false)
        expect(rightResize.hidden).toBe(false)

        setViewport({
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(composer.style.transform).toBe('translate(80px, 130px) scale(1)')
        setViewport({
            x: 45,
            y: -20,
            zoom: 0.5,
        })
        expect(composer.style.transform).toBe('translate(85px, 45px) scale(0.5)')
        expect(composer.style.maxHeight).toBe(attachedMaxHeight)
        setPaneHeight(620)
        expect(Number.parseFloat(composer.style.maxHeight)).toBe(
            Number.parseFloat(attachedMaxHeight) + pane.clientHeight - originalPaneHeight,
        )
        expect(transcript.parentElement).toBe(composer)
        expect(transcript.nextElementSibling).toBe(input)
        expect(document.activeElement).toBe(input)
        expect(input.value).toBe('Unsent draft')
    })

    it('converts a detached drag into world coordinates at the current zoom', () => {
        storeDetachedLayout()
        const {
            composer,
            moveHandle,
            setViewport,
        } = createFixture()

        pointer(moveHandle, 'pointerdown', 100, 80)
        pointer(document, 'pointermove', 300, 400, 2)
        expect(composer.style.transform).toBe('translate(220px, 280px) scale(2)')
        pointer(document, 'pointermove', 160, 40)
        expect(composer.style.transform).toBe('translate(280px, 240px) scale(2)')
        pointer(document, 'pointerup', 160, 40)

        setViewport({
            x: 10,
            y: 20,
            zoom: 1,
        })
        expect(composer.style.transform).toBe('translate(140px, 120px) scale(1)')
    })

    it('ends a detached drag and restores body styles when the window loses focus', () => {
        storeDetachedLayout()
        const {
            composer,
            moveHandle,
        } = createFixture()
        document.body.style.cursor = 'crosshair'

        pointer(moveHandle, 'pointerdown', 100, 80)
        pointer(document, 'pointermove', 140, 100)
        expect(composer.style.transform).toBe('translate(260px, 300px) scale(2)')
        expect(document.body.style.cursor).toBe('grabbing')

        window.dispatchEvent(new Event('blur'))
        expect(document.body.style.cursor).toBe('crosshair')
        expect(document.body.style.userSelect).toBe('')
        pointer(document, 'pointermove', 160, 140)
        expect(composer.style.transform).toBe('translate(260px, 300px) scale(2)')

        const reopened = createFixture()
        expect(reopened.composer.style.transform).toBe('translate(260px, 300px) scale(2)')
    })


    it('keeps the opposite edge fixed through multiple moves during a detached left resize', () => {
        storeDetachedLayout()
        const {
            composer,
            leftResize,
            setViewport,
        } = createFixture()

        pointer(leftResize, 'pointerdown', 220)
        pointer(document, 'pointermove', 140)
        expect(composer.style.width).toBe('800px')
        expect(composer.style.transform).toBe('translate(140px, 280px) scale(2)')
        pointer(document, 'pointermove', 100)
        expect(composer.style.width).toBe('820px')
        expect(composer.style.transform).toBe('translate(100px, 280px) scale(2)')
        pointer(document, 'pointerup', 100)

        setViewport({
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(composer.style.transform).toBe('translate(40px, 120px) scale(1)')
    })
})

// =============================================================================
// PREFERENCES, CONTROLS AND TEARDOWN
// =============================================================================

describe('WorkspaceConversationLayout preferences and controls', () => {
    it('shares mode, width and world position with live and newly mounted workspaces', () => {
        const first = createFixture()
        const second = createFixture()

        first.layout.setMode('right')
        expect(second.composer.dataset.conversationLayout).toBe('right')
        dragResize(first.leftResize, 440, 400)
        expect(second.composer.style.width).toBe('800px')

        first.layout.setMode('detached')
        pointer(first.moveHandle, 'pointerdown', 180, 300)
        pointer(document, 'pointermove', 220, 320)
        pointer(document, 'pointerup', 220, 320)
        expect(second.composer.dataset.conversationLayout).toBe('detached')
        expect(second.composer.style.transform).toBe('translate(220px, 320px) scale(2)')
        first.layout.destroy()
        second.layout.destroy()

        const reopened = createFixture()
        reopened.setViewport({
            x: 0,
            y: 0,
            zoom: 1,
        })
        expect(reopened.composer.dataset.conversationLayout).toBe('detached')
        expect(reopened.composer.style.width).toBe('800px')
        expect(reopened.composer.style.transform).toBe('translate(100px, 140px) scale(1)')
    })

    it('falls back to the centered default when the stored preference is malformed', () => {
        window.localStorage.setItem(storageKey, '{invalid')
        const { composer } = createFixture()
        expect(composer.dataset.conversationLayout).toBe('center')
        expect(composer.style.width).toBe('760px')
    })

    it('falls back to usable geometry when stored width and world position are invalid', () => {
        window.localStorage.setItem(storageKey, JSON.stringify({
            mode: 'detached',
            width: -1,
            position: {
                x: 100,
                y: 'invalid',
            },
        }))
        const { composer } = createFixture()
        expect(composer.dataset.conversationLayout).toBe('detached')
        expect(composer.style.width).toBe('760px')
        expect(composer.style.transform).toBe('translate(-160px, 24px) scale(2)')
    })

    it('allows layout changes when storage reads and writes fail', () => {
        const unavailable = () => {
            throw new DOMException('Storage is unavailable', 'SecurityError')
        }
        const {
            layout,
            composer,
        } = createFixture({
            getItem: unavailable,
            setItem: unavailable,
        })

        expect(composer.dataset.conversationLayout).toBe('center')
        layout.setMode('left')
        expect(composer.dataset.conversationLayout).toBe('left')
        expect(composer.style.left).toBe('0px')
    })

    it('navigates the shared icon dropdown with the keyboard and returns focus to its trigger', () => {
        const {
            composer,
            trigger,
            menu,
            options,
        } = createFixture()
        const [center, left, right, detached] = options
        expect(trigger.getAttribute('aria-label')).toBe('Chat layout')
        expect(options.map(option => option.getAttribute('aria-label'))).toEqual(['Center', 'Left', 'Right', 'Detached'])
        expect(options.every(option => option.querySelector('svg') && !option.textContent?.trim())).toBe(true)
        trigger.focus()

        keydown(trigger, 'ArrowDown')
        expect(menu.classList.contains('bubble-menu')).toBe(true)
        expect(trigger.ariaExpanded).toBe('true')
        expect(document.activeElement).toBe(center)
        expect(center.ariaChecked).toBe('true')
        expect(center.classList.contains('is-active')).toBe(true)

        keydown(center, 'ArrowUp')
        expect(document.activeElement).toBe(detached)
        keydown(detached, 'Home')
        expect(document.activeElement).toBe(center)
        keydown(center, 'ArrowDown')
        expect(document.activeElement).toBe(left)
        keydown(left, 'End')
        expect(document.activeElement).toBe(detached)
        detached.click()

        expect(composer.dataset.conversationLayout).toBe('detached')
        expect(options.filter(option => option.ariaChecked === 'true')).toEqual([detached])
        expect(options.filter(option => option.classList.contains('is-active'))).toEqual([detached])
        expect(trigger.querySelector('.dropdown-label')?.innerHTML).toBe(detached.innerHTML)
        expect(trigger.ariaExpanded).toBe('false')
        expect(document.activeElement).toBe(trigger)

        keydown(trigger, 'ArrowDown')
        expect(document.activeElement).toBe(detached)
        keydown(detached, 'ArrowUp')
        expect(document.activeElement).toBe(right)
        keydown(right, 'Escape')
        expect(trigger.ariaExpanded).toBe('false')
        expect(document.activeElement).toBe(trigger)

        trigger.click()
        expect(trigger.ariaExpanded).toBe('true')
        pointer(document.body, 'pointerdown', 0)
        expect(trigger.ariaExpanded).toBe('false')
    })

    it('restores the borrowed rails in order and releases gesture and storage listeners on destroy', () => {
        const getItem = vi.fn((key: string) => window.localStorage.getItem(key))
        const setItem = vi.fn((
            key: string,
            value: string,
        ) => window.localStorage.setItem(key, value))
        const {
            layout,
            composer,
            pane,
            railHost,
            originalRailOrder,
            rails,
            moveHandle,
        } = createFixture({
            getItem,
            setItem,
        })
        const onPanePointerDown = vi.fn()
        pane.addEventListener('pointerdown', onPanePointerDown)

        layout.setMode('left')
        expect(rails.every(rail => composer.contains(rail))).toBe(true)
        layout.setMode('right')
        expect(rails.every(rail => composer.contains(rail))).toBe(true)
        layout.setMode('detached')
        expect(rails.every(rail => composer.contains(rail))).toBe(true)
        document.body.style.cursor = 'crosshair'
        pointer(moveHandle, 'pointerdown', 180, 300)
        expect(document.body.style.cursor).toBe('grabbing')
        expect(onPanePointerDown).not.toHaveBeenCalled()

        getItem.mockClear()
        setItem.mockClear()
        layout.destroy()

        expect(railHost.children).toHaveLength(originalRailOrder.length)

        for (const [index, rail] of originalRailOrder.entries())
            expect(railHost.children[index]).toBe(rail)

        expect(composer.querySelector('.side-panel-resize-handle')).toBeNull()
        expect(composer.style.width).toBe('42rem')
        expect(composer.style.transformOrigin).toBe('bottom right')
        expect(composer.style.transform).toBe('')
        expect(composer.style.maxHeight).toBe('')
        expect(composer.querySelector('.bubble-menu-inline')).toBeNull()
        expect(composer.querySelector('.bubble-menu-dropdown')).toBeNull()
        expect(document.body.style.cursor).toBe('crosshair')
        expect(document.body.style.userSelect).toBe('')

        pointer(composer, 'pointerdown', 0)
        pointer(document, 'pointermove', 220, 320)
        pointer(document, 'pointerup', 220, 320)
        expect(onPanePointerDown).toHaveBeenCalledOnce()
        expect(setItem).not.toHaveBeenCalled()

        window.dispatchEvent(new StorageEvent('storage', { key: storageKey }))
        expect(getItem).not.toHaveBeenCalled()
    })
})
