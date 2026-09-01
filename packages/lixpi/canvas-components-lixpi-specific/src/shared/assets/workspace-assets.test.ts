import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    Asset,
    CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceAssetProjection,
    WorkspaceAssetSynchronization,
    getWorkspaceCanvasAssetIds,
    type WorkspaceAssetProjectionPorts,
    type WorkspaceAssetSynchronizationPorts,
    type WorkspaceAssetEvent,
} from './workspace-assets.ts'

afterEach(() => vi.useRealTimers())

function asset(assetId: string, sourceAssetIds: string[] = []): Asset {
    return { assetId, organizationId: 'org', revision: 1, documents: {}, lineage: { sourceAssetIds } } as Asset
}

function canvas(assetIds: string[], active?: string): CanvasState {
    return {
        nodes: assetIds.map(assetId => ({ nodeId: assetId, type: 'image', assetId, position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } })),
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        lastActiveConversationAssetId: active,
    }
}

function projection(overrides: Partial<WorkspaceAssetProjectionPorts> = {}) {
    const ports: WorkspaceAssetProjectionPorts = {
        get: vi.fn(async id => asset(id)),
        hasDocument: vi.fn(() => false),
        resumeDocument: vi.fn(async () => null),
        publishAssets: vi.fn(),
        publishDocuments: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
        reportError: vi.fn(),
        ...overrides,
    }
    return { ports, owner: new WorkspaceAssetProjection(ports) }
}

function synchronization(overrides: Partial<WorkspaceAssetSynchronizationPorts> = {}) {
    let onEvent: (event: WorkspaceAssetEvent) => void = () => {}
    const unsubscribe = vi.fn()
    const cancelTimer = vi.fn()
    let tick = () => {}
    const ports: WorkspaceAssetSynchronizationPorts = {
        subscribe: vi.fn(listener => {
            onEvent = listener
            return unsubscribe
        }),
        setInterval: vi.fn(callback => {
            tick = callback
            return cancelTimer
        }),
        load: vi.fn(async () => {}),
        read: vi.fn(id => asset(id)),
        fetch: vi.fn(async id => asset(id)),
        publish: vi.fn(),
        hydrate: vi.fn(async () => {}),
        remove: vi.fn(),
        reportError: vi.fn(),
        ...overrides,
    }
    const owner = new WorkspaceAssetSynchronization('workspace', ports)
    return { ports, owner, event: (assetId: string, deleted = false) => onEvent({ assetId, deleted }), tick: () => tick(), unsubscribe, cancelTimer }
}

describe('getWorkspaceCanvasAssetIds', () => {
    it('returns only Assets reachable from the canvas and conversation panel', () => {
        const canvasState: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            edges: [],
            nodes: [
                {
                    nodeId: 'generated-image-node',
                    type: 'image',
                    assetId: 'generated-image-asset',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 400, height: 300 },
                    generatedBy: {
                        conversationAssetId: 'generated-image-conversation',
                        responseId: 'response-1',
                        aiModel: 'Stability:sd3.5-large',
                        revisedPrompt: 'portrait',
                    },
                },
                {
                    nodeId: 'branch-node',
                    type: 'branchLine',
                    branchId: 'branch-1',
                    generationRequestId: 'generation-request-1',
                    conversationAssetId: 'branch-conversation',
                    position: { x: 500, y: 0 },
                    dimensions: { width: 400, height: 100 },
                    temporary: true,
                },
            ],
            lastActiveConversationAssetId: 'active-conversation',
            aiChatPanel: {
                isOpen: true,
                isSessionHistoryOpen: false,
                topLevelMode: 'aiThreads',
                tabs: [{
                    tabId: 'tab-1',
                    type: 'thread',
                    refId: 'tab-conversation',
                    title: 'Conversation',
                }],
                contextChips: [],
            },
        }

        expect(getWorkspaceCanvasAssetIds(canvasState)).toEqual([
            'generated-image-asset',
            'generated-image-conversation',
            'branch-conversation',
            'tab-conversation',
            'active-conversation',
        ])
    })
})

describe('WorkspaceAssetProjection', () => {
    it('loads active conversation first and deduplicates direct and lineage references', async () => {
        const fixture = projection({ get: vi.fn(async id => asset(id, id === 'a' ? ['a', 'source', 'source'] : [])) })
        const result = await fixture.owner.load('workspace', canvas(['a', 'b'], 'b'), () => true)
        expect(fixture.ports.get).toHaveBeenNthCalledWith(1, 'b', 'workspace')
        expect(result.map(item => item.assetId)).toEqual(['b', 'a', 'source'])
        expect(fixture.ports.publishAssets).toHaveBeenCalledExactlyOnceWith('workspace', result)
    })

    it('does not publish an obsolete workspace or start queued fetches after navigation', async () => {
        let current = true
        let finish!: (value: Asset) => void
        const fixture = projection({
            get: vi.fn(() =>
                new Promise(resolve => {
                    finish = resolve
                })
            ),
        })
        const pending = fixture.owner.load('workspace', canvas(['a']), () => current)
        current = false
        finish(asset('a', ['source']))
        expect(await pending).toEqual([])
        expect(fixture.ports.get).toHaveBeenCalledTimes(1)
        expect(fixture.ports.publishAssets).not.toHaveBeenCalled()
        expect(fixture.ports.resumeDocument).not.toHaveBeenCalled()
    })

    it('admits only the latest load on the same owner', async () => {
        let finish!: (value: Asset) => void
        const fixture = projection({
            get: vi.fn(async id =>
                id === 'old'
                    ? await new Promise<Asset>(resolve => {
                        finish = resolve
                    })
                    : asset(id)
            ),
        })
        const older = fixture.owner.load('workspace', canvas(['old']), () => true)
        await fixture.owner.load('workspace', canvas(['new']), () => true)
        finish(asset('old'))
        await older
        expect(fixture.ports.publishAssets).toHaveBeenCalledTimes(1)
        expect(fixture.ports.publishAssets).toHaveBeenCalledWith('workspace', [asset('new')])
    })

    it('resumes missing conversation documents first, batches snapshots and preserves cached documents', async () => {
        const assets = Array.from({ length: 19 }, (_, index) => ({ ...asset(String(index)), documents: { provenance: {}, conversation: {} } }) as Asset)
        const fixture = projection({
            hasDocument: vi.fn((_id, role) => role === 'provenance'),
            resumeDocument: vi.fn(async coordinate => ({ ...coordinate, version: 1, doc: {} })),
        })
        await fixture.owner.hydrate(assets, () => true)
        expect(fixture.ports.resumeDocument).toHaveBeenCalledTimes(19)
        expect(vi.mocked(fixture.ports.publishDocuments).mock.calls.map(([snapshots]) => snapshots.length)).toEqual([16, 3])
        expect(vi.mocked(fixture.ports.resumeDocument).mock.calls.every(([coordinate]) => coordinate.role === 'conversation')).toBe(true)
    })

    it('drops late document snapshots and stops allocating work when disposed', async () => {
        let current = true
        let finish!: (value: null) => void
        const fixture = projection({
            resumeDocument: vi.fn(() =>
                new Promise(resolve => {
                    finish = resolve
                })
            ),
        })
        const pending = fixture.owner.hydrate([{ ...asset('a'), documents: { conversation: {} } } as Asset], () => current)
        current = false
        finish(null)
        await pending
        expect(fixture.ports.publishDocuments).not.toHaveBeenCalled()
    })

    it('retains partial Asset loads and reports transport failures without publishing invalid records', async () => {
        const fixture = projection({
            get: vi.fn(async id => {
                if (id === 'bad') throw new Error('offline')
                return asset(id)
            }),
        })
        const result = await fixture.owner.load('workspace', canvas(['good', 'bad']), () => true)
        expect(result.map(item => item.assetId)).toEqual(['good'])
        expect(fixture.ports.reportError).toHaveBeenCalledTimes(1)
    })

    it('isolates simultaneous projections', async () => {
        const first = projection(), second = projection()
        await Promise.all([first.owner.load('one', canvas(['a']), () => true), second.owner.load('two', canvas(['b']), () => true)])
        expect(first.ports.publishAssets).toHaveBeenCalledWith('one', [asset('a')])
        expect(second.ports.publishAssets).toHaveBeenCalledWith('two', [asset('b')])
    })
})

describe('WorkspaceAssetSynchronization', () => {
    it('ignores unloaded updates and stops its own listener and timer', async () => {
        const fixture = synchronization({ read: () => undefined })
        fixture.event('unloaded')
        fixture.owner.destroy()
        fixture.owner.destroy()
        fixture.event('removed', true)
        fixture.tick()
        expect(fixture.ports.fetch).not.toHaveBeenCalled()
        expect(fixture.ports.remove).not.toHaveBeenCalled()
        expect(fixture.ports.load).not.toHaveBeenCalled()
        expect(fixture.unsubscribe).toHaveBeenCalledTimes(1)
        expect(fixture.cancelTimer).toHaveBeenCalledTimes(1)
    })

    it('rejects a fetch superseded by deletion and a fetch settling after disposal', async () => {
        const pending: ((value: Asset) => void)[] = []
        const fixture = synchronization({ fetch: vi.fn(() => new Promise(resolve => pending.push(resolve))) })
        fixture.event('deleted')
        fixture.event('deleted', true)
        pending[0](asset('deleted'))
        fixture.event('closed')
        fixture.owner.destroy()
        pending[1](asset('closed'))
        await Promise.resolve()
        expect(fixture.ports.publish).not.toHaveBeenCalled()
        expect(fixture.ports.hydrate).not.toHaveBeenCalled()
        expect(fixture.ports.remove).toHaveBeenCalledExactlyOnceWith('deleted')
    })

    it('rejects older refreshes and admits the latest revision', async () => {
        const pending: ((value: Asset) => void)[] = []
        const fixture = synchronization({ fetch: vi.fn(() => new Promise(resolve => pending.push(resolve))) })
        fixture.event('a')
        fixture.event('a')
        pending[1]({ ...asset('a'), revision: 2 })
        await Promise.resolve()
        pending[0](asset('a'))
        await Promise.resolve()
        expect(fixture.ports.publish).toHaveBeenCalledExactlyOnceWith({ ...asset('a'), revision: 2 })
        fixture.owner.destroy()
    })

    it('does not overlap reconciliation and invalidates its in-flight callback on disposal', async () => {
        let finish!: () => void
        const fixture = synchronization({
            load: vi.fn(() =>
                new Promise(resolve => {
                    finish = () => resolve(undefined)
                })
            ),
        })
        fixture.tick()
        fixture.tick()
        expect(fixture.ports.load).toHaveBeenCalledTimes(1)
        const current = vi.mocked(fixture.ports.load).mock.calls[0][0]
        expect(current()).toBe(true)
        fixture.owner.destroy()
        expect(current()).toBe(false)
        finish()
        await Promise.resolve()
    })

    it('releases a partial subscription when timer allocation fails', () => {
        const release = vi.fn()
        expect(() =>
            synchronization({
                subscribe: () => release,
                setInterval: () => {
                    throw new Error('timer')
                },
            })
        ).toThrow('timer')
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('continues cleanup after a disposer fails and does not affect another owner', () => {
        const first = synchronization({
            subscribe: () => () => {
                throw new Error('unsubscribe')
            },
        })
        const second = synchronization()
        expect(() => first.owner.destroy()).toThrow('Asset synchronization cleanup failed')
        expect(first.cancelTimer).toHaveBeenCalledTimes(1)
        second.event('b', true)
        expect(second.ports.remove).toHaveBeenCalledWith('b')
        expect(second.unsubscribe).not.toHaveBeenCalled()
        second.owner.destroy()
    })
})
