import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { CanvasRenderer } from './canvas-renderer.ts'

const applications = vi.hoisted(() => [] as any[])

vi.mock('pixi.js', async importOriginal => {
    const actual = await importOriginal<typeof import('pixi.js')>()
    class FakeApplication {
        stage = new actual.Container()
        canvas = { style: {}, remove: vi.fn() }
        ticker = { stop: vi.fn() }
        renderer = { resize: vi.fn(), render: vi.fn(), gpu: { device: { queue: { onSubmittedWorkDone: vi.fn(async () => {}) } } } }
        render = vi.fn()
        destroy = vi.fn()
        finish!: () => void
        fail!: (error: Error) => void
        init = vi.fn(() =>
            new Promise<void>((resolve, reject) => {
                this.finish = resolve
                this.fail = reject
            })
        )
        constructor() {
            applications.push(this)
        }
    }
    return { ...actual, Application: FakeApplication }
})

let queued: Map<number, FrameRequestCallback>

beforeEach(() => {
    applications.length = 0
    queued = new Map()
    let nextId = 0
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        queued.set(++nextId, callback)
        return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id))
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    )
})

afterEach(() => vi.unstubAllGlobals())

function root() {
    return { appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 400, height: 300 }) } as unknown as HTMLElement
}

describe('CanvasRenderer lifecycle', () => {
    it('disconnects an observer when root observation fails during construction', () => {
        const disconnect = vi.fn()
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {
                    throw new Error('observation failed')
                }
                disconnect = disconnect
            },
        )
        expect(() => new CanvasRenderer({ root: root(), onError: vi.fn() })).toThrow('observation failed')
        expect(disconnect).toHaveBeenCalledOnce()
        expect(queued.size).toBe(0)
        expect(applications[0].init).not.toHaveBeenCalled()
    })

    it('mounts the canvas after initialization and renders through its owned frame scheduler', async () => {
        const container = root()
        const renderer = new CanvasRenderer({ root: container, onError: vi.fn() })
        const app = applications[0]
        expect(container.appendChild).not.toHaveBeenCalled()
        app.finish()
        expect(await renderer.ready).toBe(true)
        expect(container.appendChild).toHaveBeenCalledWith(app.canvas)
        expect(app.renderer.resize).toHaveBeenCalledWith(400, 300)
        for (const callback of Array.from(queued.values())) callback(10)
        expect(app.render).toHaveBeenCalledOnce()
        renderer.destroy()
        await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce())
    })

    it('paints connectors behind media and keeps foreground overlays above both', async () => {
        const renderer = new CanvasRenderer({ root: root(), onError: vi.fn() })
        const app = applications[0]
        app.finish()
        await renderer.ready
        for (const [index, layer] of [renderer.layers.media, renderer.layers.foreground, renderer.layers.connectors].entries()) {
            const group = renderer.resources.createGroup({ layer, space: 'screen' })
            renderer.resources.updateGroup(group, { position: { x: index, y: 0 } })
            renderer.resources.createPath(group, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        }
        const paintedLayers = app.stage.children.filter((layer: { children: unknown[] }) => layer.children.length > 0)
        expect(paintedLayers).toHaveLength(3)
        expect(paintedLayers.map((layer: { children: Array<{ x: number }> }) => layer.children[0].x)).toEqual([2, 0, 1])
        renderer.destroy()
        await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce())
    })

    it('does not mount after disposal while initialization was pending', async () => {
        const container = root()
        const renderer = new CanvasRenderer({ root: container, onError: vi.fn() })
        renderer.destroy()
        const app = applications[0]
        app.finish()
        expect(await renderer.ready).toBe(false)
        expect(container.appendChild).not.toHaveBeenCalled()
        expect(app.destroy).toHaveBeenCalledOnce()
        expect(() => renderer.resources.createGroup({ layer: renderer.layers.media, space: 'world' })).toThrow()
    })

    it('waits for submitted GPU work before physically destroying detached resources', async () => {
        const renderer = new CanvasRenderer({ root: root(), onError: vi.fn() })
        const app = applications[0]
        app.finish()
        await renderer.ready
        let complete!: () => void
        const submitted = new Promise<void>(resolve => {
            complete = resolve
        })
        app.renderer.gpu.device.queue.onSubmittedWorkDone.mockImplementation(() => submitted)
        const group = renderer.resources.createGroup({ layer: renderer.layers.media, space: 'screen' })
        const container = app.stage.children.flatMap((layer: { children: unknown[] }) => layer.children)[0]
        renderer.resources.createPath(group, [{ path: 'M0 0 L10 0 L0 10 Z', fill: { color: '#ffffff' } }])
        renderer.resources.release(group)
        await Promise.resolve()
        expect(container.parent).toBeNull()
        expect(container.destroyed).toBe(false)
        complete()
        await vi.waitFor(() => expect(container.destroyed).toBe(true))
        renderer.destroy()
        await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce())
    })

    it('reports initialization failure and disposes partial resources', async () => {
        const onError = vi.fn()
        const renderer = new CanvasRenderer({ root: root(), onError })
        const app = applications[0]
        const error = new Error('renderer unavailable')
        app.fail(error)
        expect(await renderer.ready).toBe(false)
        expect(onError).toHaveBeenCalledWith(error)
        await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce())
        expect(queued.size).toBe(0)
    })

    it('cleans up a renderer that fails initialization after its owner was disposed', async () => {
        const onError = vi.fn()
        const renderer = new CanvasRenderer({ root: root(), onError })
        const app = applications[0]
        renderer.destroy()
        app.fail(new Error('late initialization failure'))
        expect(await renderer.ready).toBe(false)
        expect(app.destroy).toHaveBeenCalledOnce()
        expect(onError).not.toHaveBeenCalled()
    })

    it('isolates component ownership and stops only the disposed scope animation', async () => {
        const renderer = new CanvasRenderer({ root: root(), onError: vi.fn() })
        const app = applications[0]
        app.finish()
        await renderer.ready
        const first = renderer.createScope()
        const second = renderer.createScope()
        const firstGroup = first.resources.createGroup({ layer: first.layers.media, space: 'screen' })
        const secondGroup = second.resources.createGroup({ layer: second.layers.media, space: 'screen' })
        const firstFrame = vi.fn()
        const secondFrame = vi.fn()
        first.requestFrame(firstFrame)
        second.requestFrame(secondFrame)
        expect(() => second.resources.release(firstGroup)).toThrow('borrowed')
        expect(() => second.resources.updateGroup(firstGroup, { rotation: 1 })).toThrow('borrowed')
        const releaseOnAbort = vi.fn(() => first.resources.release(firstGroup))
        first.signal.addEventListener('abort', releaseOnAbort, { once: true })
        first.destroy()
        first.destroy()
        expect(first.signal.aborted).toBe(true)
        expect(releaseOnAbort).toHaveBeenCalledOnce()
        expect(() => first.resources.release(firstGroup)).not.toThrow()
        expect(second.signal.aborted).toBe(false)
        expect(() => first.resources.createGroup({ layer: first.layers.media, space: 'screen' })).toThrow('disposed')
        for (const callback of Array.from(queued.values())) callback(20)
        expect(firstFrame).not.toHaveBeenCalled()
        expect(secondFrame).toHaveBeenCalledOnce()
        expect(() => second.resources.updateGroup(secondGroup, { position: { x: 20, y: 30 } })).not.toThrow()
        renderer.destroy()
        expect(second.signal.aborted).toBe(true)
        await vi.waitFor(() => expect(app.destroy).toHaveBeenCalledOnce())
    })
})
