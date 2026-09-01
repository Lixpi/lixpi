// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { SelectionOverlay } from './selection-overlay.ts'

describe('SelectionOverlay', () => {
    it('owns its hit target, reattaches after content replacement and removes listeners on disposal', () => {
        const root = document.createElement('div')
        const onGroupPointerDown = vi.fn()
        const overlay = new SelectionOverlay({ root, marquee: { borderColor: 'red', backgroundColor: 'transparent' }, onGroupPointerDown })
        const bounds = { x: 10, y: 20, width: 100, height: 200 }
        overlay.setGroup(bounds)
        const group = root.querySelector<HTMLElement>('.canvas-selection-group')!
        group.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
        expect(onGroupPointerDown).toHaveBeenCalledOnce()
        expect(overlay.contains(group)).toBe(true)
        overlay.setGroup(null)
        group.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
        expect(onGroupPointerDown).toHaveBeenCalledOnce()
        expect(overlay.contains(group)).toBe(false)
        root.replaceChildren()
        overlay.setGroup(bounds)
        expect(root.firstChild).toBe(group)
        overlay.setMarquee(bounds)
        expect(root.querySelector<HTMLElement>('.canvas-selection-marquee')?.style.height).toBe('200px')
        expect(() => overlay.setGroup({ ...bounds, width: -1 })).toThrow()
        expect(group.style.width).toBe('100px')
        overlay.destroy()
        group.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
        overlay.setGroup(bounds)
        expect(onGroupPointerDown).toHaveBeenCalledOnce()
        expect(root.childElementCount).toBe(0)
    })
})
