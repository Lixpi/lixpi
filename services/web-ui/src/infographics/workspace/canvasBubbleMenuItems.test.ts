import { describe, it, expect, vi } from 'vitest'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT, CANVAS_EDGE_CONTEXT } from './canvasBubbleMenuItems.ts'

// =============================================================================
// HELPERS
// =============================================================================

function createCallbacks() {
    return {
        onDeleteNode: vi.fn(),
        onDeleteEdge: vi.fn(),
        onChangeConnectorCurve: vi.fn(),
        onDownloadMedia: vi.fn(),
        onReplaceMedia: vi.fn(),
        onOpenAsset: vi.fn(),
        onTriggerConnection: vi.fn(),
        onHide: vi.fn(),
    }
}

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
    const callbacks = createCallbacks()

    it('returns 9 items total (image, video, document/audio, and edge contexts)', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items).toHaveLength(9)
    })

    it('first 5 items expose the canvasImage context', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        for (let i = 0; i < 5; i++) {
            expect(items[i].context).toContain(CANVAS_IMAGE_CONTEXT)
        }
    })

    it('the Connect button is shared across all media contexts', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[3].context).toEqual([CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT])
    })

    it('the Asset details button is shared across all media contexts', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[2].context).toEqual([CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT])
    })

    it('Replace is image+video, Download is shared across all media contexts', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[0].context).toEqual([CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT])
        expect(items[1].context).toEqual([CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT])
    })

    it('the per-kind delete items follow the shared items (image, video, document/audio)', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[4].context).toEqual([CANVAS_IMAGE_CONTEXT])
        expect(items[5].context).toEqual([CANVAS_VIDEO_CONTEXT])
        expect(items[6].context).toEqual([CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT])
        expect(items[6].element.getAttribute('aria-label')).toBe('Delete file')
    })

    it('the last 2 items are edge-context only', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[7].context).toEqual([CANVAS_EDGE_CONTEXT])
        expect(items[8].context).toEqual([CANVAS_EDGE_CONTEXT])
    })

    it('first item is Replace media button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[0].element.getAttribute('aria-label')).toBe('Replace media')
    })

    it('second item is Download media button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[1].element.getAttribute('aria-label')).toBe('Download media')
    })

    it('third item is Open Asset details button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[2].element.getAttribute('aria-label')).toBe('Open Asset details')
    })

    it('fifth item is Connect button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[3].element.getAttribute('aria-label')).toBe('Connect to node')
    })

    it('sixth item is Delete button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[4].element.getAttribute('aria-label')).toBe('Delete image')
    })

    it('seventh item is Delete video button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[5].element.getAttribute('aria-label')).toBe('Delete video')
    })

    it('ninth item is Change connector curve button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[7].element.getAttribute('aria-label')).toBe('Change connector curve')
    })

    it('tenth item is Delete connection button', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        expect(items[8].element.getAttribute('aria-label')).toBe('Delete connection')
    })

    it('items are HTMLButtonElement instances with bubble-menu-button class', () => {
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        for (const item of items) {
            expect(item.element.tagName).toBe('BUTTON')
            expect(item.element.classList.contains('bubble-menu-button')).toBe(true)
            expect(item.element.getAttribute('data-help-tooltip')).toBe('aria-label')
            expect(item.element.getAttribute('title')).toBeNull()
        }
    })
})

// =============================================================================
// buildCanvasBubbleMenuItems — ACTIVE NODE ID
// =============================================================================

describe('buildCanvasBubbleMenuItems — activeNodeId', () => {
    const callbacks = createCallbacks()

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
    it('Download fires onDownloadMedia + onHide with active node', () => {
        const callbacks = createCallbacks()
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-3')

        items[1].element.click()

        expect(callbacks.onDownloadMedia).toHaveBeenCalledWith('img-3')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Download does nothing when no activeNodeId', () => {
        const callbacks = createCallbacks()
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[1].element.click()

        expect(callbacks.onDownloadMedia).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Replace fires onReplaceMedia + onHide with active node', () => {
        const callbacks = createCallbacks()
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('media-3')

        items[0].element.click()

        expect(callbacks.onReplaceMedia).toHaveBeenCalledWith('media-3')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
    })

    it('Video context keeps Replace and Download visible', () => {
        const callbacks = createCallbacks()
        const { items } = buildCanvasBubbleMenuItems(callbacks)
        const videoItems = items.filter((item) => item.context.includes(CANVAS_VIDEO_CONTEXT))
        const labels = videoItems.map((item) => item.element.getAttribute('aria-label'))

        expect(labels).toContain('Replace media')
        expect(labels).toContain('Download media')
    })

    it('Connect fires onTriggerConnection + onHide on click with active node', () => {
        const callbacks = createCallbacks()
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-5')

        items[3].element.click()

        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onTriggerConnection).toHaveBeenCalledWith('img-5')
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Connect calls onHide before onTriggerConnection', () => {
        const callOrder: string[] = []
        const callbacks = createCallbacks()
        callbacks.onTriggerConnection = vi.fn(() => callOrder.push('triggerConnection'))
        callbacks.onHide = vi.fn(() => callOrder.push('hide'))

        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-5')

        items[3].element.click()

        expect(callOrder).toEqual(['hide', 'triggerConnection'])
    })

    it('Connect does nothing on click when no activeNodeId', () => {
        const callbacks = createCallbacks()
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[3].element.click()

        expect(callbacks.onTriggerConnection).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Delete fires onDeleteNode + onHide with active node', () => {
        const callbacks = createCallbacks()
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-2')

        items[4].element.click()

        expect(callbacks.onDeleteNode).toHaveBeenCalledWith('img-2')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
    })

    it('Delete does nothing when no activeNodeId', () => {
        const callbacks = createCallbacks()
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[4].element.click()

        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })

    it('Open Asset details fires its callback and hides with an active node', () => {
        const callbacks = createCallbacks()
        const { items, setActiveNodeId } = buildCanvasBubbleMenuItems(callbacks)
        setActiveNodeId('img-library')

        items[2].element.click()

        expect(callbacks.onOpenAsset).toHaveBeenCalledWith('img-library')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
    })
})

// =============================================================================
// buildCanvasBubbleMenuItems — EDGE CALLBACKS
// =============================================================================

describe('buildCanvasBubbleMenuItems — edge callbacks', () => {
    it('getActiveEdgeId starts as null', () => {
        const callbacks = createCallbacks()
        const { getActiveEdgeId } = buildCanvasBubbleMenuItems(callbacks)

        expect(getActiveEdgeId()).toBeNull()
    })

    it('setActiveEdgeId updates and clears the value', () => {
        const callbacks = createCallbacks()
        const { getActiveEdgeId, setActiveEdgeId } = buildCanvasBubbleMenuItems(callbacks)

        setActiveEdgeId('edge-1')
        expect(getActiveEdgeId()).toBe('edge-1')

        setActiveEdgeId(null)
        expect(getActiveEdgeId()).toBeNull()
    })

    it('Change connector curve uses active edge id and hides menu', () => {
        const callbacks = createCallbacks()
        const { items, setActiveEdgeId } = buildCanvasBubbleMenuItems(callbacks)

        setActiveEdgeId('edge-curve')
        items[7].element.click()

        expect(callbacks.onChangeConnectorCurve).toHaveBeenCalledWith('edge-curve')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteEdge).not.toHaveBeenCalled()
    })

    it('Delete edge uses active edge id and hides menu', () => {
        const callbacks = createCallbacks()
        const { items, setActiveEdgeId } = buildCanvasBubbleMenuItems(callbacks)

        setActiveEdgeId('edge-del')
        items[8].element.click()

        expect(callbacks.onDeleteEdge).toHaveBeenCalledWith('edge-del')
        expect(callbacks.onHide).toHaveBeenCalledOnce()
        expect(callbacks.onDeleteNode).not.toHaveBeenCalled()
    })

    it('Edge actions are no-ops without an active edge id', () => {
        const callbacks = createCallbacks()
        const { items } = buildCanvasBubbleMenuItems(callbacks)

        items[7].element.click()
        items[8].element.click()

        expect(callbacks.onChangeConnectorCurve).not.toHaveBeenCalled()
        expect(callbacks.onDeleteEdge).not.toHaveBeenCalled()
        expect(callbacks.onHide).not.toHaveBeenCalled()
    })
})
