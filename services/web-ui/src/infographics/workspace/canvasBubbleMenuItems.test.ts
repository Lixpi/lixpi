import { describe, it, expect, vi } from 'vitest'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT } from './canvasBubbleMenuItems.ts'

// =============================================================================
// CANVAS_IMAGE_CONTEXT
// =============================================================================

describe('CANVAS_IMAGE_CONTEXT', () => {
    it('equals "canvasImage"', () => {
        expect(CANVAS_IMAGE_CONTEXT).toBe('canvasImage')
    })
})

// =============================================================================
// buildCanvasBubbleMenuItems — STRUCTURE
// =============================================================================

describe('buildCanvasBubbleMenuItems — structure', () => {
    const callbacks = {
        onDeleteNode: vi.fn(),
        onCreateVariant: vi.fn(),
        onHide: vi.fn(),
    }

    it('returns exactly 2 items', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items).toHaveLength(2)
    })

    it('all items have canvasImage context', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        for (const item of items) {
            expect(item.context).toEqual([CANVAS_IMAGE_CONTEXT])
        }
    })

    it('first item is Create Variant button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[0].element.getAttribute('title')).toBe('Create variant')
    })

    it('second item is Delete button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[1].element.getAttribute('title')).toBe('Delete image')
    })

    it('items are HTMLButtonElement instances with bubble-menu-button class', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        for (const item of items) {
            expect(item.element.tagName).toBe('BUTTON')
            expect(item.element.classList.contains('bubble-menu-button')).toBe(true)
        }
    })
})

// =============================================================================
// buildCanvasBubbleMenuItems — ACTIVE NODE ID
// =============================================================================

describe('buildCanvasBubbleMenuItems — activeNodeId', () => {
    const callbacks = {
        onDeleteNode: vi.fn(),
        onCreateVariant: vi.fn(),
        onHide: vi.fn(),
    }

    it('getActiveNodeId starts as null', () => {
        const { getActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        expect(getActiveNodeId()).toBeNull()
    })

    it('setActiveNodeId updates the value', () => {
        const { getActiveNodeId, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('node-42')
        expect(getActiveNodeId()).toBe('node-42')
    })

    it('setActiveNodeId(null) clears the value', () => {
        const { getActiveNodeId, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('node-42')
        setActiveNodeId(null)
        expect(getActiveNodeId()).toBeNull()
    })
})

// =============================================================================
// buildCanvasBubbleMenuItems — CLICK BEHAVIOR
// =============================================================================

describe('buildCanvasBubbleMenuItems — click behavior', () => {
    it('Create Variant fires onCreateVariant + onHide with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onCreateVariant: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-1')

        items[0].element.click()

        expect(callbacks.onCreateVariant).toHaveBeenCalledWith('img-1')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Delete fires onDeleteNode + onHide with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onCreateVariant: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-2')

        items[1].element.click()

        expect(callbacks.onDeleteNode).toHaveBeenCalledWith('img-2')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onCreateVariant).not.toHaveBeenCalled()
    })

    it('Create Variant does nothing when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onCreateVariant: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        // activeNodeId is null by default

        items[0].element.click()

        expect(callbacks.onCreateVariant).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Delete does nothing when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onCreateVariant: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[1].element.click()

        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })
})
