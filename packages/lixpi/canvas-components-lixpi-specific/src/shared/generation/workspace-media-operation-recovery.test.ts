import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasState,
    MediaGenerationRequest,
    MediaGenerationRequestEvent,
    OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceMediaOperationRecovery,
    type CanvasMediaRecoveryEnvelope,
    type WorkspaceMediaOperationRecoveryPorts,
} from './workspace-media-operation-recovery.ts'

const node = (requestId = 'request'): OperationStatusCanvasNode => ({
    nodeId: 'operation',
    type: 'operationStatus',
    operation: 'media-generation',
    status: 'in-progress',
    generationRequestId: requestId,
    generationRun: 0,
    title: 'Generating',
    message: 'Waiting',
    position: { x: 0, y: 0 },
    dimensions: { width: 300, height: 100 },
    createdAt: 1,
    updatedAt: 1,
})
const request = (revision = 1, requestId = 'request'): MediaGenerationRequest => ({
    generationRequestId: requestId,
    workspaceId: 'workspace',
    organizationId: 'org',
    userId: 'user',
    conversationAssetId: 'conversation',
    status: 'running',
    checkpointBlobHash: 'hash',
    checkpointSchemaVersion: '1',
    bindings: [],
    unresolvedBindings: [],
    resolvedReferences: [],
    runs: [],
    plannedCanvasNodeIds: [],
    revision,
    createdAt: 1,
    updatedAt: 1,
    statusUpdatedAt: 1,
})
const envelope = (sequence: number, revision = sequence, requestId = 'request'): Required<CanvasMediaRecoveryEnvelope> => ({
    streamSequence: sequence,
    event: { eventId: `event-${sequence}`, generationRequestId: requestId, sequence, requestRevision: revision, status: 'MEDIA_GENERATION_PROGRESS', payload: {}, createdAt: 1 },
})
function setup(overrides: Partial<WorkspaceMediaOperationRecoveryPorts> = {}) {
    let scope = { workspaceId: 'workspace', sceneKey: 'scene' }
    const state: CanvasState = { nodes: [node()], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const listeners: Array<{ receive: (event: CanvasMediaRecoveryEnvelope) => void; unsubscribe: ReturnType<typeof vi.fn> }> = []
    const ports: WorkspaceMediaOperationRecoveryPorts = {
        readScope: () => scope,
        readCanvasState: () => state,
        fetch: vi.fn(async () => ({ request: request(), liveSubject: 'subject' })),
        replay: vi.fn(async () => ({ request: request(), replay: { events: [], hasMore: false } })),
        subscribe: vi.fn((_subject, receive) => {
            const unsubscribe = vi.fn()
            listeners.push({ receive, unsubscribe })
            return unsubscribe
        }),
        apply: vi.fn(),
        reportError: vi.fn(),
        ...overrides,
    }
    const owner = new WorkspaceMediaOperationRecovery(ports)
    return {
        owner,
        ports,
        listeners,
        setScene: (sceneKey: string) => {
            scope = { ...scope, sceneKey }
        },
    }
}

describe('workspace media operation recovery', () => {
    it('shares in-flight recovery and subscribes before replay, deduplicating live and replay events', async () => {
        const fixture = setup()
        fixture.ports.replay = vi.fn(async () => {
            expect(fixture.listeners).toHaveLength(1)
            fixture.listeners[0].receive(envelope(4, 4))
            return { request: request(2), replay: { events: [envelope(4, 4), envelope(5, 5)], hasMore: false } }
        })
        const first = fixture.owner.ensure(node())
        expect(fixture.owner.ensure(node())).toBe(first)
        await first
        expect(fixture.ports.fetch).toHaveBeenCalledTimes(1)
        expect(fixture.ports.apply).toHaveBeenCalledTimes(3)
        expect(fixture.ports.apply).toHaveBeenLastCalledWith(expect.any(Object), true)
        expect(fixture.owner.revision('request')).toBe(5)
        fixture.owner.destroy()
    })

    it('continues replay pages using their highest stream sequence without skipping ahead to live events', async () => {
        const fixture = setup()
        let page = 0
        fixture.ports.replay = vi.fn(async query => {
            page += 1
            if (page === 1) {
                fixture.listeners[0].receive(envelope(100, 1))
                expect(query.startStreamSequence).toBeUndefined()
                return { request: request(), replay: { events: [envelope(3, 1)], hasMore: true } }
            }
            expect(query.startStreamSequence).toBe(4)
            return { request: request(), replay: { events: [envelope(7, 1)], hasMore: false } }
        })
        await fixture.owner.ensure(node())
        expect(fixture.ports.replay).toHaveBeenCalledTimes(2)
        expect(fixture.ports.reportError).not.toHaveBeenCalled()
        fixture.owner.destroy()
    })

    it('ignores events for another request and stale revisions', async () => {
        const fixture = setup()
        await fixture.owner.ensure(node())
        vi.mocked(fixture.ports.apply).mockClear()
        fixture.listeners[0].receive(envelope(10, 50, 'other'))
        fixture.listeners[0].receive(envelope(10, 3))
        fixture.listeners[0].receive(envelope(11, 2))
        expect(fixture.owner.revision('request')).toBe(3)
        expect(fixture.ports.apply).toHaveBeenCalledTimes(1)
        fixture.owner.destroy()
    })

    it('does not publish, subscribe or replay a fetch completed after scene replacement', async () => {
        const fetched = Promise.withResolvers<Awaited<ReturnType<WorkspaceMediaOperationRecoveryPorts['fetch']>>>()
        const fixture = setup({ fetch: () => fetched.promise })
        const pending = fixture.owner.ensure(node())
        await Promise.resolve()
        fixture.setScene('replacement')
        fixture.owner.clear()
        fetched.resolve({ request: request(), liveSubject: 'old' })
        await pending
        expect(fixture.ports.apply).not.toHaveBeenCalled()
        expect(fixture.ports.subscribe).not.toHaveBeenCalled()
        expect(fixture.ports.replay).not.toHaveBeenCalled()
        fixture.owner.destroy()
    })

    it('keeps a new request alive when an old replay rejects', async () => {
        const replayed = Promise.withResolvers<Awaited<ReturnType<WorkspaceMediaOperationRecoveryPorts['replay']>>>()
        const fixture = setup({ replay: () => replayed.promise })
        const first = fixture.owner.ensure(node())
        await Promise.resolve()
        await Promise.resolve()
        fixture.owner.clear()
        fixture.ports.replay = vi.fn(async () => ({ request: request(8), replay: { events: [], hasMore: false } }))
        await fixture.owner.ensure(node())
        replayed.reject(new Error('obsolete'))
        await first
        expect(fixture.owner.revision('request')).toBe(8)
        expect(fixture.listeners[0].unsubscribe).toHaveBeenCalledTimes(1)
        expect(fixture.listeners[1].unsubscribe).not.toHaveBeenCalled()
        expect(fixture.ports.reportError).not.toHaveBeenCalled()
        fixture.owner.destroy()
    })

    it('rejects fetched identities outside the requested workspace or request', async () => {
        const fixture = setup({ fetch: async () => ({ request: { ...request(), workspaceId: 'other' }, liveSubject: 'other' }) })
        await fixture.owner.ensure(node())
        expect(fixture.ports.apply).not.toHaveBeenCalled()
        expect(fixture.ports.subscribe).not.toHaveBeenCalled()
        expect(fixture.ports.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Canvas media recovery returned another workspace or request' }))
        fixture.owner.destroy()
    })

    it('releases a subscription and allows retry after a replay failure', async () => {
        const fixture = setup({
            replay: async () => {
                throw new Error('offline')
            },
        })
        await fixture.owner.ensure(node())
        expect(fixture.listeners[0].unsubscribe).toHaveBeenCalledTimes(1)
        fixture.ports.replay = async () => ({ request: request(), replay: { events: [], hasMore: false } })
        await fixture.owner.ensure(node())
        expect(fixture.ports.fetch).toHaveBeenCalledTimes(2)
        fixture.owner.destroy()
    })

    it('stops a replay that claims another page but cannot advance', async () => {
        const fixture = setup({ replay: vi.fn(async () => ({ request: request(), replay: { events: [], hasMore: true } })) })
        await fixture.owner.ensure(node())
        expect(fixture.ports.replay).toHaveBeenCalledTimes(1)
        expect(fixture.ports.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Canvas media replay made no progress' }))
        fixture.owner.destroy()
    })

    it('owns only its subscriptions when two canvases recover the same request', async () => {
        const first = setup()
        const second = setup()
        await Promise.all([first.owner.ensure(node()), second.owner.ensure(node())])
        first.owner.destroy()
        expect(first.listeners[0].unsubscribe).toHaveBeenCalledTimes(1)
        expect(second.listeners[0].unsubscribe).not.toHaveBeenCalled()
        second.listeners[0].receive(envelope(8))
        expect(second.owner.revision('request')).toBe(8)
        second.owner.destroy()
    })

    it('attempts all cleanup and suppresses late live callbacks even when an unsubscribe fails', async () => {
        const fixture = setup({
            fetch: async query => ({ request: request(1, query.generationRequestId), liveSubject: 'subject' }),
            replay: async query => ({ request: request(1, query.generationRequestId), replay: { events: [], hasMore: false } }),
        })
        await Promise.all([fixture.owner.ensure(node()), fixture.owner.ensure(node('request-two'))])
        fixture.listeners[0].unsubscribe.mockImplementation(() => {
            throw new Error('cleanup failed')
        })
        expect(() => fixture.owner.destroy()).toThrow('Canvas recovery subscription cleanup failed')
        expect(fixture.listeners[1].unsubscribe).toHaveBeenCalledTimes(1)
        vi.mocked(fixture.ports.apply).mockClear()
        fixture.listeners[0].receive(envelope(10))
        expect(fixture.ports.apply).not.toHaveBeenCalled()
        await fixture.owner.ensure(node('new'))
        expect(fixture.listeners).toHaveLength(2)
    })

    it('releases a subscription returned after synchronous scene disposal', async () => {
        const fixture = setup()
        const unsubscribe = vi.fn()
        fixture.ports.subscribe = () => {
            fixture.owner.clear()
            return unsubscribe
        }
        await fixture.owner.ensure(node())
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        expect(fixture.ports.replay).not.toHaveBeenCalled()
        fixture.owner.destroy()
    })
})
