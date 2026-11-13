// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NestedListAutoScroll } from './auto-scroll.ts'

afterEach(() => vi.restoreAllMocks())

describe('nested list drag edge scrolling', () => {
    it('continues bounded scrolling without pointer motion and cancels the pending frame on stop', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientHeight', { value: 100 })
        Object.defineProperty(container, 'scrollHeight', { value: 140 })
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            bottom: 100,
            left: 0,
            right: 200,
            width: 200,
            height: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        })
        let nextId = 0
        const callbacks = new Map<number, FrameRequestCallback>()
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            const id = ++nextId
            callbacks.set(id, callback)

            return id
        })
        const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => void callbacks.delete(id))
        const onScroll = vi.fn()
        const scroll = new NestedListAutoScroll(window, () => container, onScroll)
        const tick = () => {
            const [id, callback] = [...callbacks][0]
            callbacks.delete(id)
            callback(0)
        }
        scroll.update(20, 99)
        expect(callbacks.size).toBe(1)
        tick()
        expect(container.scrollTop).toBeGreaterThan(0)
        expect(container.scrollTop).toBeLessThanOrEqual(12)
        expect(onScroll).toHaveBeenCalledWith(20, 99)
        tick()
        expect(container.scrollTop).toBeGreaterThan(12)
        scroll.stop()
        expect(cancel).toHaveBeenCalled()
        expect(callbacks.size).toBe(0)

        scroll.update(20, 99)

        while (callbacks.size)
            tick()

        expect(container.scrollTop).toBe(40)
        expect(callbacks.size).toBe(0)
    })

    it('does not scroll away from the edges or outside the host width', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientHeight', { value: 100 })
        Object.defineProperty(container, 'scrollHeight', { value: 400 })
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            bottom: 100,
            left: 0,
            right: 200,
            width: 200,
            height: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        })
        const request = vi.spyOn(window, 'requestAnimationFrame')
        const scroll = new NestedListAutoScroll(window, () => container, vi.fn())
        scroll.update(20, 50)
        scroll.update(300, 99)
        expect(request).not.toHaveBeenCalled()
    })
})
