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
    setVisible: ReturnType<typeof vi.fn>
    setErrorMessage: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}>)
vi.mock('./loading-overlay.ts', () => ({
    LoadingOverlay: class {
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

    it('skips a renderer for completed work and can initialize for a later request', async () => {
        const layer = createLayer()
        const completed = layer.acquire({ visible: true })
        completed.destroy()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(instances).toHaveLength(0)
        expect(layer.dom.isConnected).toBe(false)

        const pending = layer.acquire({ visible: true })
        await vi.waitFor(() => expect(instances).toHaveLength(1))
        expect(layer.dom.isConnected).toBe(true)
        expect(instances[0].setVisible).toHaveBeenLastCalledWith(true)
        pending.destroy()
        expect(layer.dom.isConnected).toBe(false)
    })

    it('cannot mount a late renderer after application disposal', async () => {
        const layer = createLayer()
        const request = layer.acquire({ visible: true })
        layer.destroy()
        request.setVisible(true)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(instances).toHaveLength(0)
        expect(layer.dom.isConnected).toBe(false)
        expect(() => layer.acquire()).toThrow('disposed')
    })
})
