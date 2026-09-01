import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasState } from '@lixpi/constants'
import { WorkspaceCanvasSession } from './workspace-canvas-session.ts'
import {
    WorkspaceViewportPersistence,
    type WorkspaceViewportPersistencePorts,
} from './workspace-viewport-persistence.ts'
import type {
    CanvasPersistencePorts,
    CanvasWriteResult,
} from './canvas-persistence-controller.ts'
import {
    encodeStashedViewport,
    getStashedViewportStorageKey,
} from './workspace-viewport-stash.ts'

function setup(workspaceId = 'one') {
    let canvas: CanvasState = { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }
    const save = vi.fn<CanvasPersistencePorts['save']>().mockResolvedValue({ status: 'saved', workspaceId, version: { canvasStateUpdatedAt: 2 } })
    const persistencePorts: CanvasPersistencePorts = {
        read: () => ({ canvasState: canvas, version: { canvasStateUpdatedAt: 1 } }),
        save,
        fetch: async () => ({ canvasState: canvas, version: { canvasStateUpdatedAt: 2 } }),
        publish: publication => {
            if (publication.canvasState) canvas = publication.canvasState
        },
        reportError: vi.fn(),
    }
    const session = new WorkspaceCanvasSession(workspaceId, persistencePorts)
    const storage = new Map<string, string>()
    const timers: Array<{ callback: () => void; cancel: ReturnType<typeof vi.fn> }> = []
    const ports: WorkspaceViewportPersistencePorts = {
        readCanvasState: () => canvas,
        restoreViewport: vi.fn(),
        storage: {
            get: key => storage.get(key) ?? null,
            set: (key, value) => {
                storage.set(key, value)
            },
            remove: key => {
                storage.delete(key)
            },
        },
        setTimer: (callback, delay) => {
            expect(delay).toBe(1000)
            const timer = { callback, cancel: vi.fn() }
            timers.push(timer)
            return timer.cancel
        },
    }
    const viewport = new WorkspaceViewportPersistence(session, ports)
    return { viewport, session, ports, persistencePorts, save, storage, timers }
}

const moved = (x: number) => ({ x, y: 20, zoom: 0.5 })

describe('WorkspaceViewportPersistence', () => {
    it('submits the leading viewport and only the latest trailing viewport', async () => {
        const { viewport, session, save, timers } = setup()
        viewport.change(moved(1))
        await session.drain()
        viewport.change(moved(2))
        viewport.change(moved(3))
        expect(save).toHaveBeenCalledTimes(1)
        timers[0].callback()
        timers[1].callback()
        expect(save).toHaveBeenCalledTimes(1)
        timers[2].callback()
        await session.drain()
        expect(save).toHaveBeenCalledTimes(2)
        expect(save.mock.calls[1][0]).toMatchObject({ persistViewport: true, canvasState: { viewport: moved(3) } })
        viewport.destroy()
    })

    it('flushes pending work and releases the view without closing its session', async () => {
        const { viewport, session, save, ports, timers } = setup()
        viewport.change(moved(1))
        await session.drain()
        viewport.change(moved(2))
        ports.readCanvasState = () => null
        viewport.destroy()
        viewport.destroy()
        await session.drain()
        expect(save.mock.calls[1][0].canvasState.viewport).toEqual(moved(2))
        expect(session.viewCount).toBe(0)
        timers.at(-1)!.callback()
        viewport.change(moved(3))
        expect(save).toHaveBeenCalledTimes(2)
        session.acquire().release()
    })

    it('lets the session flush pending viewport work before it closes', async () => {
        const { viewport, session, save } = setup()
        viewport.change(moved(1))
        await session.drain()
        viewport.change(moved(2))
        await session.close()
        expect(save).toHaveBeenCalledTimes(2)
        expect(save.mock.calls[1][0].canvasState.viewport).toEqual(moved(2))
        viewport.destroy()
    })

    it('stashes a submitted viewport while its first network write is still pending', async () => {
        const { viewport, session, save, storage } = setup()
        const result = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(result.promise)
        viewport.change(moved(1))
        viewport.stashForUnload()
        expect(storage.get(getStashedViewportStorageKey('one'))).toBe(encodeStashedViewport(moved(1)))
        result.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 2 } })
        await session.drain()
        viewport.destroy()
    })

    it('restores once and persists the restored viewport without replaying obsolete stored state', async () => {
        const { viewport, session, storage, ports, save } = setup()
        const key = getStashedViewportStorageKey('one')
        storage.set(key, encodeStashedViewport(moved(10)))
        viewport.restore({ x: 0, y: 0, zoom: 1 })
        viewport.restore({ x: 0, y: 0, zoom: 1 })
        await session.drain()
        expect(ports.restoreViewport).toHaveBeenCalledExactlyOnceWith(moved(10))
        expect(save).toHaveBeenCalledTimes(1)
        expect(storage.has(key)).toBe(false)
        viewport.destroy()
    })

    it('still flushes when local storage is unavailable', async () => {
        const { viewport, session, ports, save } = setup()
        viewport.change(moved(1))
        await session.drain()
        viewport.change(moved(2))
        ports.storage.set = () => {
            throw new Error('storage denied')
        }
        viewport.stashForUnload()
        await session.drain()
        expect(save).toHaveBeenCalledTimes(2)
        viewport.destroy()
    })

    it('does not install a timer if publishing the leading write destroys the view', async () => {
        const { viewport, session, persistencePorts, timers, save } = setup()
        persistencePorts.publish = () => viewport.destroy()
        viewport.change(moved(1))
        await session.drain()
        expect(timers).toHaveLength(0)
        expect(session.viewCount).toBe(0)
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('keeps timers and pending viewport writes separate between workspaces', async () => {
        const one = setup('one')
        const two = setup('two')
        one.viewport.change(moved(1))
        two.viewport.change(moved(2))
        one.viewport.destroy()
        await one.session.drain()
        await two.session.drain()
        expect(two.session.viewCount).toBe(1)
        expect(two.timers[0].cancel).not.toHaveBeenCalled()
        expect(two.save.mock.calls[0][0]).toMatchObject({ workspaceId: 'two', canvasState: { viewport: moved(2) } })
        two.viewport.destroy()
    })

    it('rejects non-finite viewports without scheduling or publishing', () => {
        const { viewport, timers, save } = setup()
        viewport.change(moved(NaN))
        expect(timers).toHaveLength(0)
        expect(save).not.toHaveBeenCalled()
        viewport.destroy()
    })
})
