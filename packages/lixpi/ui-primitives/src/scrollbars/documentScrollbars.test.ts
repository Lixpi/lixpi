// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const library = vi.hoisted(() => ({
    measured: false,
    depth: 0,
    created: [] as HTMLElement[],
}))

// Behaves like OverlayScrollbars 2.17: the first call of any kind, a lookup
// included, measures the browser by focusing a hidden scrolling probe before
// that measurement exists.
vi.mock('overlayscrollbars', () => {
    const instances = new WeakMap<HTMLElement, { destroy: () => void }>()
    const measure = (): void => {
        if (library.measured)
            return

        library.depth += 1

        if (library.depth > 3)
            throw new RangeError('Maximum call stack size exceeded.')

        const probe = document.createElement('div')
        probe.style.overflow = 'scroll'
        probe.tabIndex = -1
        document.body.append(probe)
        probe.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        probe.remove()
        library.depth -= 1
        library.measured = true
    }
    const OverlayScrollbars = (target: HTMLElement | { target: HTMLElement }, options?: object) => {
        measure()

        if (options === undefined)
            return instances.get(target as HTMLElement)

        const element = 'target' in target ? target.target : target
        const instance = { destroy: () => instances.delete(element) }
        instances.set(element, instance)
        library.created.push(element)

        return instance
    }
    OverlayScrollbars.plugin = () => {}

    return {
        ClickScrollPlugin: {},
        OverlayScrollbars,
    }
})

const { acquireDocumentScrollbars } = await import('./documentScrollbars.ts')

const createScroller = (): HTMLElement => {
    const element = document.createElement('div')
    element.style.display = 'block'
    element.style.overflowX = 'hidden'
    element.style.overflowY = 'auto'
    element.style.padding = '6px 20px'
    document.body.append(element)

    return element
}

describe('acquireDocumentScrollbars', () => {
    afterEach(() => {
        document.body.replaceChildren()
        library.measured = false
        library.depth = 0
        library.created = []
    })

    it('ignores the focus the library fires while measuring, so the first scroller attaches instead of recursing', () => {
        const lease = acquireDocumentScrollbars(document)
        const scroller = createScroller()

        expect(() => scroller.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))).not.toThrow()
        expect(library.created).toEqual([scroller])
        lease.release()
    })

    it('places the scrollbars from where the slot actually sits inside the container', () => {
        const lease = acquireDocumentScrollbars(document)
        const scroller = createScroller()
        const rect = (left: number, top: number) => ({
            left,
            top,
            right: left,
            bottom: top,
            x: left,
            y: top,
            width: 0,
            height: 0,
            toJSON: () => ({}),
        })
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(480, 40))
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this === scroller ? rect(480, 40) : rect(520, 52)
        })

        scroller.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        const slot = scroller.firstElementChild as HTMLElement

        expect(slot.className).toBe('lixpi-scrollbar-slot')
        expect(slot.style.getPropertyValue('--lixpi-scrollbar-slot-offset-top')).toBe('12px')
        expect(slot.style.getPropertyValue('--lixpi-scrollbar-slot-offset-left')).toBe('40px')
        vi.restoreAllMocks()
        lease.release()
    })
})
