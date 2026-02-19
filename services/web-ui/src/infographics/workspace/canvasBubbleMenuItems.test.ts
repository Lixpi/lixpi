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
        onAskAi: vi.fn(),
        onDownloadImage: vi.fn(),
        onTriggerConnection: vi.fn(),
        onHide: vi.fn(),
    }

    it('returns exactly 4 items', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items).toHaveLength(4)
    })

    it('all items have canvasImage context', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        for (const item of items) {
            expect(item.context).toEqual([CANVAS_IMAGE_CONTEXT])
        }
    })

    it('first item is Ask AI button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[0].element.getAttribute('title')).toBe('Ask AI')
    })

    it('second item is Download button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[1].element.getAttribute('title')).toBe('Download image')
    })

    it('third item is Connect button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[2].element.getAttribute('title')).toBe('Connect to node')
    })

    it('fourth item is Delete button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[3].element.getAttribute('title')).toBe('Delete image')
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
        onAskAi: vi.fn(),
        onDownloadImage: vi.fn(),
        onTriggerConnection: vi.fn(),
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
    it('Ask AI fires onAskAi + onHide with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-1')

        items[0].element.click()

        expect(callbacks.onAskAi).toHaveBeenCalledWith('img-1')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Ask AI does nothing when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[0].element.click()

        expect(callbacks.onAskAi).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Download fires onDownloadImage + onHide with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-3')

        items[1].element.click()

        expect(callbacks.onDownloadImage).toHaveBeenCalledWith('img-3')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Download does nothing when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[1].element.click()

        expect(callbacks.onDownloadImage).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Connect fires onTriggerConnection + onHide on click with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-5')

        items[2].element.click()

        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onTriggerConnection).toHaveBeenCalledWith('img-5')
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Connect calls onHide before onTriggerConnection', () => {
        const callOrder: string[] = []
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(() => callOrder.push('triggerConnection')),
            onHide: vi.fn(() => callOrder.push('hide')),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-5')

        items[2].element.click()

        expect(callOrder).toEqual(['hide', 'triggerConnection'])
    })

    it('Connect does nothing on click when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[2].element.click()

        expect(callbacks.onTriggerConnection).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Delete fires onDeleteNode + onHide with active node', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-2')

        items[3].element.click()

        expect(callbacks.onDeleteNode).toHaveBeenCalledWith('img-2')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
    })

    it('Delete does nothing when no activeNodeId', () => {
        const callbacks = {
            onDeleteNode: vi.fn(),
            onAskAi: vi.fn(),
            onDownloadImage: vi.fn(),
            onTriggerConnection: vi.fn(),
            onHide: vi.fn(),
        }
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[3].element.click()

        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })
})
