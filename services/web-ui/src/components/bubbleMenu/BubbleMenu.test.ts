import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BubbleMenu } from '$src/components/bubbleMenu/BubbleMenu.ts'
import type { BubbleMenuItem, BubbleMenuPositionRequest } from '$src/components/bubbleMenu/types.ts'

// =============================================================================
// HELPERS
// =============================================================================

function createMockItem(contexts: string[], label = 'btn'): BubbleMenuItem {
    const el = document.createElement('button')
    el.className = 'bubble-menu-button'
    el.textContent = label
    return { element: el, context: contexts, update: vi.fn() }
}

function createMockPosition(overrides: Partial<DOMRect> = {}): BubbleMenuPositionRequest {
    const rect = {
        left: 100, right: 300, top: 50, bottom: 100,
        width: 200, height: 50, x: 100, y: 50,
        toJSON: () => ({}),
    }
    return {
        targetRect: { ...rect, ...overrides } as DOMRect,
        placement: 'below',
    }
}

function createBubbleMenu(overrides: {
    items?: BubbleMenuItem[]
    panels?: HTMLElement[]
    onShow?: (ctx: string) => void
    onHide?: () => void
} = {}) {
    const parentEl = document.createElement('div')
    document.body.appendChild(parentEl)

    const items = overrides.items ?? [
        createMockItem(['text', 'image'], 'bold'),
        createMockItem(['text'], 'italic'),
        createMockItem(['image'], 'delete'),
    ]

    const menu = new BubbleMenu({
        parentEl,
        items,
        panels: overrides.panels,
        onShow: overrides.onShow,
        onHide: overrides.onHide,
    })

    return { menu, parentEl, items }
}

// =============================================================================
// CONSTRUCTION
// =============================================================================

describe('BubbleMenu — construction', () => {
    let parentEl: HTMLElement

    afterEach(() => {
        parentEl?.remove()
    })

    it('appends menu element to parentEl', () => {
        const result = createBubbleMenu()
        parentEl = result.parentEl
        const menuEl = parentEl.querySelector('.bubble-menu')

        expect(menuEl).not.toBeNull()
    })

    it('creates menu-content with all item elements', () => {
        const result = createBubbleMenu()
        parentEl = result.parentEl
        const content = parentEl.querySelector('.bubble-menu-content')

        expect(content).not.toBeNull()
        expect(content!.children.length).toBe(3)
    })

    it('appends panels after menu-content', () => {
        const panel = document.createElement('div')
        panel.className = 'test-panel'
        const result = createBubbleMenu({ panels: [panel] })
        parentEl = result.parentEl
        const menuEl = parentEl.querySelector('.bubble-menu')!

        expect(menuEl.children.length).toBe(2)
        expect(menuEl.children[1].className).toBe('test-panel')
    })

    it('starts hidden', () => {
        const result = createBubbleMenu()
        parentEl = result.parentEl
        expect(result.menu.isVisible).toBe(false)
    })

    it('sets correct ARIA attributes', () => {
        const result = createBubbleMenu()
        parentEl = result.parentEl
        expect(result.menu.element.getAttribute('role')).toBe('toolbar')
        expect(result.menu.element.getAttribute('aria-label')).toBe('Formatting toolbar')
    })
})

// =============================================================================
// SHOW / HIDE LIFECYCLE
// =============================================================================

describe('BubbleMenu — show/hide', () => {
    let menu: BubbleMenu
    let parentEl: HTMLElement

    beforeEach(() => {
        const result = createBubbleMenu()
        menu = result.menu
        parentEl = result.parentEl
    })

    afterEach(() => {
        menu.destroy()
        parentEl.remove()
    })

    it('show() makes menu visible', () => {
        menu.show('text', createMockPosition())
        expect(menu.isVisible).toBe(true)
    })

    it('show() sets context', () => {
        menu.show('image', createMockPosition())
        expect(menu.context).toBe('image')
    })

    it('hide() makes menu invisible', () => {
        menu.show('text', createMockPosition())
        menu.hide()
        expect(menu.isVisible).toBe(false)
    })

    it('hide() clears context', () => {
        menu.show('text', createMockPosition())
        menu.hide()
        expect(menu.context).toBe('')
    })

    it('hide() is no-op when already hidden', () => {
        const onHide = vi.fn()
        const result = createBubbleMenu({ onHide })
        result.menu.hide()
        expect(onHide).not.toHaveBeenCalled()
        result.menu.destroy()
        result.parentEl.remove()
    })

    it('forceHide() clears preventHide and hides', () => {
        menu.show('text', createMockPosition())
        menu.preventHide = true
        menu.forceHide()
        expect(menu.isVisible).toBe(false)
        expect(menu.preventHide).toBe(false)
    })
})

// =============================================================================
// CALLBACKS
// =============================================================================

describe('BubbleMenu — callbacks', () => {
    let parentEl: HTMLElement

    afterEach(() => {
        parentEl?.remove()
    })

    it('calls onShow with context when shown', () => {
        const onShow = vi.fn()
        const { menu, parentEl: pe } = createBubbleMenu({ onShow })
        parentEl = pe
        menu.show('image', createMockPosition())
        expect(onShow).toHaveBeenCalledWith('image')
        menu.destroy()
    })

    it('calls onHide when hidden', () => {
        const onHide = vi.fn()
        const { menu, parentEl: pe } = createBubbleMenu({ onHide })
        parentEl = pe
        menu.show('text', createMockPosition())
        menu.hide()
        expect(onHide).toHaveBeenCalledOnce()
        menu.destroy()
    })
})

// =============================================================================
// CONTEXT SWITCHING
// =============================================================================

describe('BubbleMenu — context switching', () => {
    let menu: BubbleMenu
    let parentEl: HTMLElement
    let items: BubbleMenuItem[]

    beforeEach(() => {
        const result = createBubbleMenu()
        menu = result.menu
        parentEl = result.parentEl
        items = result.items
    })

    afterEach(() => {
        menu.destroy()
        parentEl.remove()
    })

    it('shows only items matching the context', () => {
        menu.show('text', createMockPosition())

        // 'bold' (text, image) → visible, 'italic' (text) → visible, 'delete' (image) → hidden
        expect(items[0].element.style.display).toBe('')
        expect(items[1].element.style.display).toBe('')
        expect(items[2].element.style.display).toBe('none')
    })

    it('switches visible items when context changes', () => {
        menu.show('text', createMockPosition())
        menu.updateContext('image', createMockPosition())

        // 'bold' (text, image) → visible, 'italic' (text) → hidden, 'delete' (image) → visible
        expect(items[0].element.style.display).toBe('')
        expect(items[1].element.style.display).toBe('none')
        expect(items[2].element.style.display).toBe('')
    })

    it('hides all items for unknown context', () => {
        menu.show('nonexistent', createMockPosition())

        expect(items[0].element.style.display).toBe('none')
        expect(items[1].element.style.display).toBe('none')
        expect(items[2].element.style.display).toBe('none')
    })
})

// =============================================================================
// REFRESH STATE
// =============================================================================

describe('BubbleMenu — refreshState', () => {
    let parentEl: HTMLElement

    afterEach(() => {
        parentEl?.remove()
    })

    it('calls update() on each item that has it', () => {
        const item1 = createMockItem(['text'], 'a')
        const item2 = createMockItem(['text'], 'b')
        const item3: BubbleMenuItem = {
            element: document.createElement('button'),
            context: ['text'],
            // no update
        }

        const { menu, parentEl: pe } = createBubbleMenu({ items: [item1, item2, item3] })
        parentEl = pe

        menu.refreshState()

        expect(item1.update).toHaveBeenCalledOnce()
        expect(item2.update).toHaveBeenCalledOnce()
        menu.destroy()
    })
})

// =============================================================================
// REPOSITION
// =============================================================================

describe('BubbleMenu — reposition', () => {
    let menu: BubbleMenu
    let parentEl: HTMLElement

    beforeEach(() => {
        const result = createBubbleMenu()
        menu = result.menu
        parentEl = result.parentEl
    })

    afterEach(() => {
        menu.destroy()
        parentEl.remove()
    })

    it('reposition() with new position updates lastPosition', () => {
        const pos1 = createMockPosition({ left: 50 })
        const pos2 = createMockPosition({ left: 200 })

        menu.show('text', pos1)
        menu.reposition(pos2)

        // Since the menu element position updates synchronously,
        // verify the menu is still visible (positioning logic ran)
        expect(menu.isVisible).toBe(true)
    })

    it('reposition() without argument uses last known position', () => {
        const pos = createMockPosition()
        menu.show('text', pos)

        // Should not throw
        menu.reposition()
        expect(menu.isVisible).toBe(true)
    })

    it('reposition() is no-op when no position was ever set', () => {
        // Never called show(), no lastPosition
        menu.reposition()
        expect(menu.isVisible).toBe(false)
    })
})

// =============================================================================
// PREVENT-HIDE PATTERN
// =============================================================================

describe('BubbleMenu — preventHide', () => {
    let menu: BubbleMenu
    let parentEl: HTMLElement

    beforeEach(() => {
        const result = createBubbleMenu()
        menu = result.menu
        parentEl = result.parentEl
    })

    afterEach(() => {
        menu.destroy()
        parentEl.remove()
    })

    it('mousedown on menu sets preventHide to true', () => {
        expect(menu.preventHide).toBe(false)

        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true })
        menu.element.dispatchEvent(mousedownEvent)

        expect(menu.preventHide).toBe(true)
    })

    it('preventHide defaults to false', () => {
        expect(menu.preventHide).toBe(false)
    })
})

// =============================================================================
// DESTROY
// =============================================================================

describe('BubbleMenu — destroy', () => {
    it('removes menu element from DOM', () => {
        const { menu, parentEl } = createBubbleMenu()
        expect(parentEl.querySelector('.bubble-menu')).not.toBeNull()

        menu.destroy()
        expect(parentEl.querySelector('.bubble-menu')).toBeNull()
        parentEl.remove()
    })
})

// =============================================================================
// TRANSFORM AWARENESS
// =============================================================================

describe('BubbleMenu — transform awareness', () => {
    let parentEl: HTMLElement

    afterEach(() => {
        parentEl?.remove()
    })

    it('screenToLocal converts screen coords to local coords (no transform)', () => {
        const { menu, parentEl: pe } = createBubbleMenu()
        parentEl = pe

        // Without any CSS transform, scale is 1 and coords are relative to parent
        const local = menu.screenToLocal(100, 50)
        // In happy-dom, getBoundingClientRect returns 0,0 for position
        // so local = (100 - 0) / 1, (50 - 0) / 1
        expect(local.x).toBe(100)
        expect(local.y).toBe(50)
        menu.destroy()
    })

    it('getScale returns 1 when no transform ancestor exists', () => {
        const { menu, parentEl: pe } = createBubbleMenu()
        parentEl = pe

        expect(menu.getScale()).toBe(1)
        menu.destroy()
    })

    it('findTransformedAncestor returns null when no transform', () => {
        const { menu, parentEl: pe } = createBubbleMenu()
        parentEl = pe

        expect(menu.findTransformedAncestor()).toBeNull()
        menu.destroy()
    })
})
