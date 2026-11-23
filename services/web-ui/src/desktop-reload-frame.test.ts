import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { mountDesktopReloadFrame } from './desktop-reload-frame.ts'

const setup = (isDesktop = true) => {
    const root = document.documentElement
    root.dataset.desktopStartup = 'loading'

    if (isDesktop)
        root.dataset.titleBar = 'overlay'

    const frame = document.createElement('div')
    frame.id = 'desktop-startup-frame'
    const showPopover = vi.fn()
    frame.showPopover = showPopover
    document.body.append(frame)

    const events = new EventTarget()
    const reload = vi.fn()
    const sessionStorage = { setItem: vi.fn() }
    const frames: FrameRequestCallback[] = []
    const win = {
        document,
        location: { reload },
        sessionStorage,
        requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
        addEventListener: events.addEventListener.bind(events),
    } as unknown as Parameters<typeof mountDesktopReloadFrame>[0]
    const settle = mountDesktopReloadFrame(win)

    return {
        root,
        frame,
        showPopover,
        frames,
        win,
        reload,
        sessionStorage,
        settle,
        events,
    }
}

afterEach(() => {
    const { dataset } = document.documentElement
    delete dataset.titleBar
    delete dataset.theme
    delete dataset.desktopStartup
    delete dataset.desktopStartupScheme
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('desktop reload cover', () => {
    it('holds an opaque top-layer frame for one rendering opportunity before reloading', () => {
        const {
            root,
            frame,
            showPopover,
            frames,
            win,
            reload,
            sessionStorage,
            settle,
        } = setup()
        root.dataset.theme = 'dark'

        settle?.()
        expect(root.dataset.desktopStartup).toBeUndefined()

        win.__lixpiReload?.()
        win.__lixpiReload?.()

        expect(root.dataset.desktopStartup).toBe('reloading')
        expect(root.dataset.desktopStartupScheme).toBe('dark')
        expect(sessionStorage.setItem).toHaveBeenCalledExactlyOnceWith('lixpi:desktop-startup-scheme', 'dark')
        expect(frame.popover).toBe('manual')
        expect(showPopover).toHaveBeenCalledOnce()
        expect(reload).not.toHaveBeenCalled()
        expect(frames).toHaveLength(1)

        frames.shift()?.(10)
        expect(reload).not.toHaveBeenCalled()
        expect(frames).toHaveLength(1)

        frames.shift()?.(26)
        expect(reload).toHaveBeenCalledOnce()
    })

    it('leaves the reload bridge uninstalled in a browser', () => {
        const {
            win,
            reload,
            settle,
            events,
            frame,
        } = setup(false)
        events.dispatchEvent(new Event('beforeunload'))

        expect(win.__lixpiReload).toBeUndefined()
        expect(settle).toBeUndefined()
        expect(reload).not.toHaveBeenCalled()
        expect(frame.popover).toBeFalsy()
    })

    it('keeps the cover while exiting and clears it when the history restores the page', () => {
        const {
            root,
            frame,
            events,
            settle,
        } = setup()

        events.dispatchEvent(new Event('beforeunload'))
        settle?.()

        expect(root.dataset.desktopStartup).toBe('reloading')
        expect(frame.popover).toBe('manual')

        const pageShow = new Event('pageshow')
        Object.defineProperty(pageShow, 'persisted', { value: true })
        events.dispatchEvent(pageShow)
        expect(root.dataset.desktopStartup).toBeUndefined()
        expect(frame.popover).toBeFalsy()
    })
})
