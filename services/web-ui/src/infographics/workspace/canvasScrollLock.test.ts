import { describe, it, expect } from 'vitest'
import { lockCanvasScrollLayers } from '$src/infographics/workspace/canvasScrollLock.ts'

function createScrollableLayer(): HTMLElement {
    const layer = document.createElement('div')
    document.body.appendChild(layer)
    return layer
}

describe('lockCanvasScrollLayers', () => {
    it('resets a locked layer scroll offset to zero when the browser scrolls it', () => {
        const layer = createScrollableLayer()
        lockCanvasScrollLayers([layer])

        layer.scrollLeft = 240
        layer.scrollTop = 3600
        layer.dispatchEvent(new Event('scroll'))

        expect(layer.scrollLeft).toBe(0)
        expect(layer.scrollTop).toBe(0)
    })

    it('locks every provided layer independently', () => {
        const paneEl = createScrollableLayer()
        const viewportEl = createScrollableLayer()
        lockCanvasScrollLayers([paneEl, viewportEl])

        paneEl.scrollTop = 100
        paneEl.dispatchEvent(new Event('scroll'))
        viewportEl.scrollLeft = 55
        viewportEl.dispatchEvent(new Event('scroll'))

        expect(paneEl.scrollTop).toBe(0)
        expect(viewportEl.scrollLeft).toBe(0)
    })

    it('ignores null and undefined layers', () => {
        const layer = createScrollableLayer()
        expect(() => lockCanvasScrollLayers([null, undefined, layer])).not.toThrow()

        layer.scrollTop = 10
        layer.dispatchEvent(new Event('scroll'))
        expect(layer.scrollTop).toBe(0)
    })

    it('stops resetting after cleanup', () => {
        const layer = createScrollableLayer()
        const unlock = lockCanvasScrollLayers([layer])
        unlock()

        layer.scrollTop = 42
        layer.dispatchEvent(new Event('scroll'))

        expect(layer.scrollTop).toBe(42)
    })

    it('leaves descendant scrollers untouched', () => {
        const layer = createScrollableLayer()
        const innerScroller = document.createElement('div')
        layer.appendChild(innerScroller)
        lockCanvasScrollLayers([layer])

        innerScroller.scrollTop = 300
        innerScroller.dispatchEvent(new Event('scroll'))

        expect(innerScroller.scrollTop).toBe(300)
    })
})
