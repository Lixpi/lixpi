// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { LoadingLayer } from './loading-layer.ts'
import {
    type LoadingOverlayOptions,
} from './loading-overlay.ts'

const instances = vi.hoisted(() => [] as Array<{
    options: LoadingOverlayOptions
    dom: { getAnimations: () => Animation[] }
    setVisible: ReturnType<typeof vi.fn>
    setErrorMessage: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}>)
vi.mock('./loading-overlay.ts', () => ({
    LoadingOverlay: class {
        dom = { getAnimations: (): Animation[] => [] }
        setVisible = vi.fn()
        setErrorMessage = vi.fn()
        destroy = vi.fn()
        constructor(readonly options: LoadingOverlayOptions) {
            instances.push(this)
        }
    },
}))

const layers: LoadingLayer[] = []
const createLayer = () => {
    const layer = new LoadingLayer({
        root: document.body,
        outline: {} as LoadingOverlayOptions['outline'],
        errorTitle: 'Could not load',
        retryLabel: 'Retry',
        onError: vi.fn(),
    })
    layers.push(layer)

    return layer
}

// The spinner inside the overlay never finishes, so only the overlay's
// own fade decides when the layer leaves.
const stubFade = (): () => void => {
    let finish!: () => void
    const finished = new Promise<void>(resolve => void (finish = resolve))
    instances[0].dom.getAnimations = () => [{ finished } as unknown as Animation]

    return () => {
        instances[0].dom.getAnimations = () => []
        finish()
    }
}

afterEach(() => {
    for (const layer of layers.splice(0))
        layer.destroy()

    instances.length = 0
    document.body.replaceChildren()
})

describe('application loading layer', () => {
    it('keeps one renderer and overlay until the last pending request completes', async () => {
        const layer = createLayer()
        const startup = layer.acquire({
            visible: true,
            label: 'Loading Lixpi',
        })
        const canvas = layer.acquire({ visible: true })
        await vi.waitFor(() => expect(instances).toHaveLength(1))
        expect(document.querySelectorAll('.canvas-loading-layer')).toHaveLength(1)
        expect(layer.dom.getAttribute('aria-label')).toBe('Loading Lixpi')
        startup.destroy()
        expect(layer.dom.isConnected).toBe(true)
        canvas.setVisible(false)
        expect(layer.dom.isConnected).toBe(false)
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(false)
        canvas.setVisible(true)
        expect(instances).toHaveLength(1)
        expect(layer.dom.isConnected).toBe(true)
        canvas.destroy()
        canvas.setVisible(true)
        expect(layer.dom.isConnected).toBe(false)
    })

    it('routes retry to the failed request and resumes other pending work afterward', async () => {
        const layer = createLayer()
        const retry = vi.fn()
        const canvas = layer.acquire({
            visible: true,
            onRetry: retry,
        })
        const documentLoad = layer.acquire({ visible: true })
        canvas.setErrorMessage('Workspace unavailable')
        await vi.waitFor(() => expect(instances).toHaveLength(1))
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(false)
        expect(instances[0].setErrorMessage).toHaveBeenLastCalledWith('Workspace unavailable')
        instances[0].options.onRetry?.()
        expect(retry).toHaveBeenCalledOnce()
        canvas.destroy()
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(true)
        expect(instances[0].setErrorMessage).toHaveBeenLastCalledWith(null)
        documentLoad.destroy()
        expect(layer.dom.isConnected).toBe(false)
    })

    it('paints the first request synchronously and retains the renderer for later work', () => {
        const layer = createLayer()
        const completed = layer.acquire({ visible: true })
        expect(instances).toHaveLength(1)
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(true)
        completed.destroy()
        expect(layer.dom.isConnected).toBe(false)

        const pending = layer.acquire({ visible: true })
        expect(instances).toHaveLength(1)
        expect(layer.dom.isConnected).toBe(true)
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(true)
        pending.destroy()
        expect(layer.dom.isConnected).toBe(false)
    })

    it('disposes the renderer and ignores requests after application disposal', () => {
        const layer = createLayer()
        const request = layer.acquire({ visible: true })
        layer.destroy()
        request.setVisible(true)
        expect(instances[0].destroy).toHaveBeenCalledOnce()
        expect(layer.dom.isConnected).toBe(false)
        expect(() => layer.acquire()).toThrow('disposed')
    })
})

describe('loading layer fade-out', () => {
    it('stays mounted and lets pointer input through until the overlay finishes fading out', async () => {
        const layer = createLayer()
        const load = layer.acquire({ visible: true })
        const finishFade = stubFade()

        load.destroy()

        expect(instances[0].setVisible).toHaveBeenLastCalledWith(false)
        expect(layer.dom.isConnected).toBe(true)
        expect(layer.dom.classList.contains('is-idle')).toBe(true)

        finishFade()

        await vi.waitFor(() => expect(layer.dom.isConnected).toBe(false))
    })

    it('keeps the layer for work that starts while the previous overlay is still fading out', async () => {
        const layer = createLayer()
        const first = layer.acquire({ visible: true })
        const finishFade = stubFade()
        first.destroy()

        const second = layer.acquire({ visible: true })

        expect(layer.dom.classList.contains('is-idle')).toBe(false)
        finishFade()
        await Promise.resolve()
        await Promise.resolve()
        expect(layer.dom.isConnected).toBe(true)
        second.destroy()
        expect(layer.dom.isConnected).toBe(false)
    })
})

describe('contained loading layer', () => {
    it('keeps a window-wide spinner in place until it fades out and mounts the next load in the contained area', () => {
        const layer = createLayer()
        const pane = document.createElement('div')
        document.body.append(pane)
        const startup = layer.acquire({ visible: true })

        layer.contain(pane)

        expect(layer.dom.parentElement).toBe(document.body)
        expect(layer.dom.classList.contains('is-contained')).toBe(false)

        const workspace = layer.acquire({ visible: true })
        startup.destroy()

        expect(layer.dom.parentElement).toBe(document.body)

        workspace.destroy()
        const next = layer.acquire({ visible: true })

        expect(layer.dom.parentElement).toBe(pane)
        expect(layer.dom.classList.contains('is-contained')).toBe(true)
        next.destroy()
    })

    it('stays where it is while a new load starts during the fade-out', async () => {
        const layer = createLayer()
        const pane = document.createElement('div')
        document.body.append(pane)
        const startup = layer.acquire({ visible: true })
        const finishFade = stubFade()
        layer.contain(pane)
        startup.destroy()

        const workspace = layer.acquire({ visible: true })
        finishFade()
        await Promise.resolve()
        await Promise.resolve()

        expect(layer.dom.parentElement).toBe(document.body)
        workspace.destroy()
        expect(layer.dom.isConnected).toBe(false)
    })

    it('returns to the window once the containment is released', () => {
        const layer = createLayer()
        const pane = document.createElement('div')
        document.body.append(pane)
        const release = layer.contain(pane)
        const load = layer.acquire({ visible: true })

        release()

        expect(layer.dom.parentElement).toBe(pane)
        load.destroy()

        const next = layer.acquire({ visible: true })

        expect(layer.dom.parentElement).toBe(document.body)
        expect(layer.dom.classList.contains('is-contained')).toBe(false)
        next.destroy()
    })

    it('leaves a newer containment in place when an older one is released', () => {
        const layer = createLayer()
        const firstPane = document.createElement('div')
        const secondPane = document.createElement('div')
        document.body.append(firstPane, secondPane)
        const releaseFirst = layer.contain(firstPane)
        layer.contain(secondPane)

        releaseFirst()
        const load = layer.acquire({ visible: true })

        expect(layer.dom.parentElement).toBe(secondPane)
        load.destroy()
    })
})
