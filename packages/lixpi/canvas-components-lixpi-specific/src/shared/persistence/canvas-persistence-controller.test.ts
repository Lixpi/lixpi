import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
} from '@lixpi/constants'
import {
    CanvasPersistenceController,
    type CanvasPersistencePorts,
    type CanvasWriteResult,
    type WorkspaceCanvasSnapshot,
} from './canvas-persistence-controller.ts'

function state(x = 0): CanvasState {
    return { viewport: { x, y: 0, zoom: 1 }, nodes: [], edges: [] }
}

function setup() {
    let snapshot: WorkspaceCanvasSnapshot = { canvasState: state(), version: { updatedAt: 10, canvasStateUpdatedAt: 5 } }
    const save = vi.fn<CanvasPersistencePorts['save']>().mockResolvedValue({ status: 'saved', workspaceId: 'one', version: { updatedAt: 12, canvasStateUpdatedAt: 7 } })
    const publish = vi.fn<CanvasPersistencePorts['publish']>(update => {
        snapshot = { canvasState: update.canvasState ?? snapshot.canvasState, version: { ...snapshot.version, ...update.version } }
    })
    const ports: CanvasPersistencePorts = {
        read: () => snapshot,
        save,
        fetch: vi.fn(async () => ({ canvasState: state(90), version: { updatedAt: 20, canvasStateUpdatedAt: 20 } })),
        publish,
        reportError: vi.fn(),
    }
    return { controller: new CanvasPersistenceController('one', ports), save, publish, ports }
}

describe('CanvasPersistenceController', () => {
    it('serializes and coalesces writes using acknowledged canvas versions', async () => {
        const { controller, save } = setup()
        const first = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(first.promise)
        controller.update(state(1))
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        controller.update(state(2), true)
        controller.update(state(3))
        first.resolve({ status: 'saved', workspaceId: 'one', version: { updatedAt: 11, canvasStateUpdatedAt: 6 } })
        await controller.drain()
        expect(save).toHaveBeenCalledTimes(2)
        expect(save.mock.calls[1][0]).toMatchObject({ canvasState: state(3), persistViewport: true, expectedCanvasStateUpdatedAt: 6 })
    })

    it('continues accepted writes when the host stops exposing the active workspace', async () => {
        const { controller, ports, save } = setup()
        const first = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(first.promise)
        controller.update(state(1))
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        ports.read = () => null
        controller.update(state(2))
        first.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 6 } })
        await controller.drain()
        expect(save.mock.calls[1][0]).toMatchObject({ workspaceId: 'one', expectedCanvasStateUpdatedAt: 6 })
        expect(controller.read()?.version.canvasStateUpdatedAt).toBe(7)
    })

    it('ignores an obsolete acknowledgment and preserves an in-flight explicit viewport over adoption', async () => {
        const { controller, save } = setup()
        const first = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(first.promise).mockResolvedValue({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 31 } })
        controller.update(state(45), true)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        controller.adoptAuthoritative({ canvasState: state(2), version: { canvasStateUpdatedAt: 30 } })
        first.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 6 } })
        await controller.drain()
        expect(save.mock.calls[1][0]).toMatchObject({ canvasState: state(45), persistViewport: true, expectedCanvasStateUpdatedAt: 30 })
        expect(controller.read()?.version.canvasStateUpdatedAt).toBe(31)
        expect(controller.adoptAuthoritative({ canvasState: state(), version: { canvasStateUpdatedAt: 1 } })).toBe(false)
    })

    it('bounds stale retries, refetches topology and replays the latest explicit viewport', async () => {
        const { controller, save, ports } = setup()
        save.mockResolvedValue({ status: 'stale', workspaceId: 'one', current: { canvasStateUpdatedAt: 6 } })
        for (let index = 0; index < 4; index += 1) save.mockResolvedValueOnce({ status: 'stale', workspaceId: 'one', current: { canvasStateUpdatedAt: 6 + index } })
        save.mockResolvedValueOnce({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 21 } })
        controller.update(state(40), true)
        await controller.drain()
        expect(ports.fetch).toHaveBeenCalledExactlyOnceWith('one')
        expect(save).toHaveBeenCalledTimes(5)
        expect(save.mock.calls[4][0]).toMatchObject({ canvasState: state(40), expectedCanvasStateUpdatedAt: 20, persistViewport: true })
    })

    it('reports unresolved failures through drain and retains the request for explicit retry', async () => {
        const { controller, save, publish } = setup()
        save.mockRejectedValueOnce(new Error('offline'))
        controller.update(state(4), true)
        await expect(controller.drain()).rejects.toThrow('offline')
        expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ requiresSave: true }))
        await controller.flush()
        expect(save).toHaveBeenCalledTimes(2)
        expect(save.mock.calls[1][0].canvasState).toEqual(state(4))
    })

    it('lets a newer complete snapshot settle after an earlier write fails', async () => {
        const { controller, save } = setup()
        const first = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(first.promise)
        controller.update(state(1))
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        controller.update(state(2))
        first.reject(new Error('temporary'))
        await controller.drain()
        expect(controller.read()?.canvasState).toEqual(state(2))
    })

    it('serializes membership and saves while retaining edits submitted during the mutation', async () => {
        const { controller, save } = setup()
        const mutation = Promise.withResolvers<string>()
        const operation = controller.runMembershipMutation(async () => await mutation.promise)
        controller.update(state(1))
        await Promise.resolve()
        expect(save).not.toHaveBeenCalled()
        mutation.resolve('attached')
        expect(await operation).toBe('attached')
        await controller.drain()
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('does not discard accepted saves when membership fails', async () => {
        const { controller, save } = setup()
        const mutation = Promise.withResolvers<void>()
        const operation = controller.runMembershipMutation(async () => await mutation.promise)
        controller.update(state(1))
        mutation.reject(new Error('membership denied'))
        await expect(operation).rejects.toThrow('membership denied')
        await controller.drain()
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('waits for an accepted save on close and rejects further admission', async () => {
        const { controller, save } = setup()
        const write = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(write.promise)
        controller.update(state(1))
        const closed = controller.close()
        expect(() => controller.update(state(2))).toThrow('closing')
        write.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 6 } })
        await closed
    })

    it('rejects replies for another workspace without adopting their version', async () => {
        const { controller, save } = setup()
        save.mockResolvedValueOnce({ status: 'saved', workspaceId: 'two', version: { canvasStateUpdatedAt: 99 } })
        controller.update(state())
        await expect(controller.drain()).rejects.toThrow('another workspace')
        expect(controller.read()?.version.canvasStateUpdatedAt).toBe(5)
    })
})
