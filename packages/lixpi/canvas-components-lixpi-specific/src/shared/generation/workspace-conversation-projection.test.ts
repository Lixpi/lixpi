import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceConversationProjection,
    type CanvasConversationProjectionRecord,
    type WorkspaceConversationProjectionPorts,
} from './workspace-conversation-projection.ts'

type Thread = CanvasConversationProjectionRecord & { title?: string }
const record = (overrides: Partial<Thread> = {}): Thread => ({
    threadId: 'thread',
    workspaceId: 'workspace',
    proseMirrorVersion: 3,
    updatedAt: 10,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'persisted' }] }] },
    ...overrides,
})
const marker = (): CanvasNode => ({
    nodeId: 'marker',
    type: 'branchOrigin',
    branchId: 'branch',
    conversationAssetId: 'thread',
    generationRequestId: 'request',
    temporary: true,
    position: { x: 0, y: 0 },
    dimensions: { width: 300, height: 100 },
})
function setup(overrides: Partial<WorkspaceConversationProjectionPorts<Thread>> = {}) {
    let threads = [record()]
    let sceneKey = 'scene'
    const timers: Array<{ callback: () => void; delay: number; cancel: ReturnType<typeof vi.fn> }> = []
    const ports: WorkspaceConversationProjectionPorts<Thread> = {
        readScope: () => ({ workspaceId: 'workspace', sceneKey }),
        getThreads: () => threads,
        setThreads: values => {
            threads = values
        },
        getNodes: () => [],
        retainedThreadIds: () => [],
        canUseLatestTurnFallback: () => true,
        fetchThread: vi.fn(async () => record({ proseMirrorVersion: 4, content: { durable: true } })),
        refreshProjection: vi.fn(),
        now: () => 20,
        reportError: vi.fn(),
        setTimer: (callback, delay) => {
            const cancel = vi.fn()
            timers.push({ callback, delay, cancel })
            return cancel
        },
        ...overrides,
    }
    const owner = new WorkspaceConversationProjection(ports)
    const fire = async (index = timers.length - 1) => {
        timers[index].callback()
        await Promise.resolve()
        await Promise.resolve()
    }
    return {
        owner,
        ports,
        timers,
        fire,
        setThreads: (values: Thread[]) => {
            threads = values
        },
        setScene: (value: string) => {
            sceneKey = value
        },
        get threads() {
            return threads
        },
    }
}

describe('workspace conversation projection', () => {
    it('awaits an immediate refresh and replaces a queued retry', async () => {
        const fetched = Promise.withResolvers<Thread | null>()
        const fixture = setup({ fetchThread: () => fetched.promise })
        fixture.owner.schedule('thread')
        const refreshing = fixture.owner.refresh('thread')
        expect(fixture.timers[0].cancel).toHaveBeenCalledOnce()
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(3)
        fetched.resolve(record({ proseMirrorVersion: 8 }))
        await refreshing
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(8)
        expect(fixture.ports.refreshProjection).toHaveBeenCalledOnce()
        expect(fixture.timers).toHaveLength(1)
        fixture.owner.destroy()
    })

    it('rejects an immediate refresh response after the scene changes', async () => {
        const fetched = Promise.withResolvers<Thread | null>()
        const fixture = setup({ fetchThread: () => fetched.promise })
        const refreshing = fixture.owner.refresh('thread')
        fixture.setScene('replacement')
        fetched.resolve(record({ proseMirrorVersion: 8 }))
        await refreshing
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(3)
        expect(fixture.ports.refreshProjection).not.toHaveBeenCalled()
        expect(fixture.timers).toHaveLength(0)
        fixture.owner.destroy()
    })

    it('projects streamed content locally until an authoritative complete snapshot arrives', async () => {
        const fixture = setup()
        fixture.owner.rememberContent('thread', { streamed: true }, true)
        expect(fixture.owner.content('thread')).toEqual({ streamed: true })
        expect(fixture.threads[0].updatedAt).toBe(20)
        fixture.owner.schedule('thread')
        expect(fixture.timers[0].delay).toBe(400)
        await fixture.fire()
        expect(fixture.owner.content('thread')).toEqual({ durable: true })
        expect([...fixture.owner.liveIds()]).toEqual([])
        expect(fixture.ports.refreshProjection).toHaveBeenCalledWith('thread')
        expect(fixture.timers).toHaveLength(1)
        fixture.owner.destroy()
    })

    it('clears a streaming override on a normal editor change', () => {
        const fixture = setup()
        fixture.owner.rememberContent('thread', { streamed: true }, true)
        fixture.owner.rememberContent('thread', { saved: true }, false)
        expect([...fixture.owner.liveIds()]).toEqual([])
        expect(fixture.owner.content('thread')).toEqual({ saved: true })
        fixture.owner.destroy()
    })

    it('preserves fresher and more complete local content while accepting incoming metadata', () => {
        const fixture = setup()
        const state: CanvasState = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
        const local = record({ title: 'old', proseMirrorVersion: 7 })
        fixture.setThreads([local])
        const incoming = record({ title: 'new', proseMirrorVersion: 6, content: { type: 'doc' }, updatedAt: 5 })
        expect(fixture.owner.merge([incoming], state, false)[0]).toEqual({ ...incoming, content: local.content, proseMirrorVersion: 7, updatedAt: 10 })
        incoming.proseMirrorVersion = 7
        expect(fixture.owner.merge([incoming], state, false)[0].content).toEqual(local.content)
        incoming.proseMirrorVersion = 8
        expect(fixture.owner.merge([incoming], state, false)[0]).toEqual(incoming)
        expect(fixture.owner.merge([incoming], state, true)).toEqual([incoming])
        fixture.owner.destroy()
    })

    it('retains referenced, active and streaming conversations but drops unrelated missing records', () => {
        const fixture = setup({ retainedThreadIds: () => ['active'] })
        fixture.setThreads([record(), record({ threadId: 'active' }), record({ threadId: 'streaming' }), record({ threadId: 'obsolete' })])
        fixture.owner.rememberContent('streaming', { streaming: true }, true)
        const state: CanvasState = { nodes: [marker()], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
        expect(fixture.owner.merge([], state, false).map(thread => thread.threadId)).toEqual(['thread', 'active', 'streaming'])
        expect(fixture.owner.merge([], state, true)).toEqual([])
        fixture.owner.destroy()
    })

    it('bounds retries for incomplete snapshots and preserves the live override', async () => {
        const fixture = setup({ getNodes: () => [marker()], fetchThread: async () => record({ proseMirrorVersion: 4 }) })
        fixture.owner.rememberContent('thread', { streaming: true }, true)
        fixture.owner.schedule('thread')
        for (let index = 0; index < 4; index += 1) await fixture.fire(index)
        expect(fixture.timers.map(timer => timer.delay)).toEqual([400, 1000, 1600, 3000])
        expect(fixture.owner.content('thread')).toEqual({ streaming: true })
        fixture.owner.destroy()
    })

    it('rejects older persisted versions without replacing local content', async () => {
        const fixture = setup({ fetchThread: async () => record({ proseMirrorVersion: 2, content: { stale: true } }) })
        fixture.owner.schedule('thread')
        await fixture.fire()
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(3)
        expect(fixture.ports.refreshProjection).not.toHaveBeenCalled()
        expect(fixture.timers).toHaveLength(2)
        fixture.owner.destroy()
    })

    it('ignores an old response after replacement and cannot evict a newer refresh', async () => {
        const first = Promise.withResolvers<Thread | null>()
        const fixture = setup({ fetchThread: vi.fn(() => first.promise) })
        fixture.owner.schedule('thread')
        await fixture.fire()
        fixture.owner.schedule('thread')
        fixture.ports.fetchThread = vi.fn(async () => record({ proseMirrorVersion: 10 }))
        first.resolve(record({ proseMirrorVersion: 5 }))
        await Promise.resolve()
        await fixture.fire()
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(10)
        expect(fixture.ports.refreshProjection).toHaveBeenCalledTimes(1)
        fixture.owner.destroy()
    })

    it('does not publish a fetch after the workspace scene changes', async () => {
        const fetched = Promise.withResolvers<Thread | null>()
        const fixture = setup({ fetchThread: () => fetched.promise })
        fixture.owner.schedule('thread')
        await fixture.fire()
        fixture.setScene('replacement')
        fetched.resolve(record({ proseMirrorVersion: 100 }))
        await Promise.resolve()
        await Promise.resolve()
        expect(fixture.owner.get('thread')!.proseMirrorVersion).toBe(3)
        expect(fixture.ports.refreshProjection).not.toHaveBeenCalled()
        expect(fixture.timers).toHaveLength(1)
        fixture.owner.destroy()
    })

    it('validates the returned conversation identity and retries a failed read', async () => {
        const fixture = setup({ fetchThread: async () => record({ workspaceId: 'other' }) })
        fixture.owner.schedule('thread')
        await fixture.fire()
        expect(fixture.ports.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Conversation refresh returned another workspace or thread' }), 'thread')
        expect(fixture.owner.get('thread')!.workspaceId).toBe('workspace')
        fixture.ports.fetchThread = async () => {
            throw new Error('offline')
        }
        await fixture.fire()
        expect(fixture.ports.reportError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'offline' }), 'thread')
        fixture.owner.destroy()
    })

    it('cancels timers and ignores cancelled callbacks on scene clear or final disposal', async () => {
        const fixture = setup()
        fixture.owner.schedule('thread')
        fixture.owner.clear()
        expect(fixture.timers[0].cancel).toHaveBeenCalledTimes(1)
        await fixture.fire(0)
        expect(fixture.ports.fetchThread).not.toHaveBeenCalled()
        fixture.owner.schedule('thread')
        fixture.owner.destroy()
        fixture.owner.schedule('thread')
        await fixture.fire(1)
        expect(fixture.timers).toHaveLength(2)
        expect(fixture.ports.fetchThread).not.toHaveBeenCalled()
    })
})
