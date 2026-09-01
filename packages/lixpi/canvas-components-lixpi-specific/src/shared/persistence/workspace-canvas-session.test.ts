import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
} from '@lixpi/constants'
import { WorkspaceCanvasSessionHub } from './workspace-canvas-session.ts'
import {
    type CanvasPersistencePorts,
    type CanvasWriteResult,
} from './canvas-persistence-controller.ts'

const state = (): CanvasState => ({ viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] })

function setup() {
    const save = vi.fn<CanvasPersistencePorts['save']>(async request => ({ status: 'saved', workspaceId: request.workspaceId, version: { canvasStateUpdatedAt: 2 } }))
    const createPorts = vi.fn((): CanvasPersistencePorts => ({
        read: () => ({ canvasState: state(), version: { canvasStateUpdatedAt: 1 } }),
        save,
        fetch: async () => ({ canvasState: state(), version: { canvasStateUpdatedAt: 2 } }),
        publish: vi.fn(),
        reportError: vi.fn(),
    }))
    return { hub: new WorkspaceCanvasSessionHub(createPorts), save, createPorts }
}

describe('WorkspaceCanvasSessionHub', () => {
    it('shares one queue between views of the same workspace', async () => {
        const { hub, save, createPorts } = setup()
        const first = hub.acquire('one')
        const second = hub.acquire('one')
        expect(first.session).toBe(second.session)
        expect(createPorts).toHaveBeenCalledTimes(1)
        expect(first.session.viewCount).toBe(2)
        const write = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(write.promise)
        first.session.persistence.update(state())
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        second.session.persistence.update(state())
        first.release()
        first.release()
        second.release()
        expect(first.session.viewCount).toBe(0)
        write.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 2 } })
        await hub.drain()
        expect(save).toHaveBeenCalledTimes(2)
        expect(hub.acquire('one').session).toBe(first.session)
    })

    it('keeps different workspace versions and write queues independent', async () => {
        const { hub, save } = setup()
        hub.get('one').persistence.update(state())
        hub.get('two').persistence.update(state())
        await hub.drain()
        expect(save.mock.calls.map(([request]) => request.workspaceId).sort()).toEqual(['one', 'two'])
        expect(hub.get('one')).not.toBe(hub.get('two'))
    })

    it('drains accepted writes even when a view flush fails', async () => {
        const { hub, save } = setup()
        const session = hub.get('one')
        const write = Promise.withResolvers<CanvasWriteResult>()
        save.mockReturnValueOnce(write.promise)
        session.registerFlush(() => {
            throw new Error('view flush failed')
        })
        session.persistence.update({ viewport: { x: 1, y: 0, zoom: 1 }, nodes: [], edges: [] })
        const closing = session.close()
        write.resolve({ status: 'saved', workspaceId: 'one', version: { canvasStateUpdatedAt: 2 } })
        await expect(closing).rejects.toThrow('Canvas view close failed')
        expect(session.persistence.read()?.version.canvasStateUpdatedAt).toBe(2)
    })

    it('waits for every session to close even when one has an unresolved failure', async () => {
        const { hub, save } = setup()
        const write = Promise.withResolvers<CanvasWriteResult>()
        save.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(write.promise)
        const first = hub.get('one')
        const second = hub.get('two')
        first.persistence.update(state())
        second.persistence.update(state())
        const closing = hub.close()
        expect(() => hub.acquire('three')).toThrow('closing')
        expect(() => first.acquire()).toThrow('closing')
        let settled = false
        const observation = (async () => {
            try {
                await closing
            } catch {
                settled = true
            }
        })()
        await Promise.resolve()
        expect(settled).toBe(false)
        write.resolve({ status: 'saved', workspaceId: 'two', version: { canvasStateUpdatedAt: 2 } })
        await expect(closing).rejects.toThrow('Canvas session close failed')
        await observation
        expect(second.persistence.read()?.version.canvasStateUpdatedAt).toBe(2)
    })
})
