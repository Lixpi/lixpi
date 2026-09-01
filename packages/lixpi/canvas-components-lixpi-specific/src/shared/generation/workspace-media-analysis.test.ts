import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    Asset,
    ImageCanvasNode,
    MediaDescriptor,
    VideoCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceMediaAnalysis,
    type WorkspaceMediaAnalysisPorts,
} from './workspace-media-analysis.ts'

const node = (assetId = 'asset'): ImageCanvasNode => ({ type: 'image', nodeId: 'node', assetId, position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } } as ImageCanvasNode)
const asset = (sealed = true): Asset => ({ assetId: 'asset', states: { provenance: sealed ? 'sealed' : 'pending' } } as Asset)

function setup(overrides: Partial<WorkspaceMediaAnalysisPorts> = {}) {
    vi.useFakeTimers()
    let currentNode: ImageCanvasNode | VideoCanvasNode | undefined = node()
    let scope = { workspaceId: 'workspace', sceneKey: 'scene' }
    const descriptors: MediaDescriptor[] = []
    const ports: WorkspaceMediaAnalysisPorts = {
        readScope: () => scope,
        readNode: () => currentNode,
        describe: vi.fn(async () => ({ summary: 'pixel description', title: 'title', entityTags: ['subject'] })),
        patchDescriptor: vi.fn((_id, descriptor) => {
            descriptors.push(descriptor)
        }),
        refreshAsset: vi.fn(async () => asset()),
        loadWorkspaceAssets: vi.fn(async () => {}),
        refreshVideo: vi.fn(),
        refreshChrome: vi.fn(),
        refreshMarkers: vi.fn(),
        refreshContext: vi.fn(),
        setTimer: (callback, delay) => {
            const timer = setTimeout(callback, delay)
            return () => clearTimeout(timer)
        },
        now: () => 123,
        reportError: vi.fn(),
        ...overrides,
    }
    const owner = new WorkspaceMediaAnalysis(ports)
    return {
        owner,
        ports,
        descriptors,
        setNode: (value: typeof currentNode) => {
            currentNode = value
        },
        setScope: (value: typeof scope) => {
            scope = value
        },
    }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('workspace media analysis', () => {
    it('coalesces requests and publishes only the returned pixel description', async () => {
        const { owner, ports, descriptors } = setup()
        owner.queue('node', 'asset')
        owner.queue('node', 'asset')
        await vi.advanceTimersByTimeAsync(0)
        expect(ports.describe).toHaveBeenCalledOnce()
        expect(ports.describe).toHaveBeenCalledWith({ workspaceId: 'workspace', assetId: 'asset' })
        expect(descriptors).toEqual([expect.objectContaining({ status: 'ready', summary: 'pixel description', entityTags: ['subject'], styleTags: [], source: 'analysis', updatedAt: 123 })])
    })

    it('waits for node insertion without fetching before the node exists', async () => {
        const fixture = setup()
        fixture.setNode(undefined)
        fixture.owner.queue('node', 'asset')
        await vi.advanceTimersByTimeAsync(50)
        expect(fixture.ports.describe).not.toHaveBeenCalled()
        fixture.setNode(node())
        await vi.advanceTimersByTimeAsync(50)
        expect(fixture.ports.describe).toHaveBeenCalledOnce()
    })

    it('bounds missing-node polling and cancels it on disposal', async () => {
        const fixture = setup()
        fixture.setNode(undefined)
        fixture.owner.queue('node', 'asset')
        await vi.runAllTimersAsync()
        expect(fixture.ports.describe).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
        fixture.owner.queue('node', 'asset')
        fixture.owner.destroy()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('retries failures on the existing schedule and finally marks the descriptor failed', async () => {
        const { owner, ports, descriptors } = setup({ describe: vi.fn(async () => ({ error: 'unavailable' })) })
        owner.queue('node', 'asset')
        await vi.advanceTimersByTimeAsync(0)
        expect(descriptors).toEqual([])
        await vi.advanceTimersByTimeAsync(999)
        expect(ports.describe).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(ports.describe).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(3000)
        expect(ports.describe).toHaveBeenCalledTimes(3)
        await vi.advanceTimersByTimeAsync(8000)
        expect(ports.describe).toHaveBeenCalledTimes(4)
        expect(descriptors).toEqual([expect.objectContaining({ status: 'failed', summary: '' })])
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['scene', 'asset', 'clear', 'destroy'])('ignores a late analysis after %s changes', async change => {
        let complete!: (value: { summary: string }) => void
        const fixture = setup({
            describe: () =>
                new Promise(resolve => {
                    complete = resolve
                }),
        })
        fixture.owner.queue('node', 'asset')
        if (change === 'scene') fixture.setScope({ workspaceId: 'workspace', sceneKey: 'replacement' })
        if (change === 'asset') fixture.setNode(node('replacement'))
        if (change === 'clear') fixture.owner.clear()
        if (change === 'destroy') fixture.owner.destroy()
        complete({ summary: 'late' })
        await vi.advanceTimersByTimeAsync(0)
        expect(fixture.ports.patchDescriptor).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('allows a new owner of the same node while an old request is still pending', async () => {
        let completeOld!: (value: { summary: string }) => void
        const fixture = setup({
            describe: vi.fn().mockImplementationOnce(() =>
                new Promise(resolve => {
                    completeOld = resolve
                })
            ).mockResolvedValue({ summary: 'new' }),
        })
        fixture.owner.queue('node', 'asset')
        fixture.owner.clear()
        fixture.owner.queue('node', 'asset')
        completeOld({ summary: 'old' })
        await vi.advanceTimersByTimeAsync(0)
        expect(fixture.descriptors.map(value => value.summary)).toEqual(['new'])
    })

    it('refreshes a completed video once and waits for sealed provenance with bounded retries', async () => {
        const fixture = setup({ refreshAsset: vi.fn(async () => asset(false)) })
        fixture.setNode({ ...node(), type: 'video' } as VideoCanvasNode)
        await fixture.owner.refreshCompleted(fixture.ports.readNode('node')!)
        await vi.runAllTimersAsync()
        expect(fixture.ports.refreshAsset).toHaveBeenCalledTimes(6)
        expect(fixture.ports.refreshVideo).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('does not refresh chrome or enqueue analysis after a completed-Asset reply arrives late', async () => {
        let complete!: (value: Asset) => void
        const fixture = setup({
            refreshAsset: () =>
                new Promise(resolve => {
                    complete = resolve
                }),
        })
        const pending = fixture.owner.refreshCompleted(node())
        vi.mocked(fixture.ports.refreshChrome).mockClear()
        fixture.owner.clear()
        complete(asset(false))
        await pending
        expect(fixture.ports.refreshChrome).not.toHaveBeenCalled()
        expect(fixture.ports.describe).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps workspace descriptor reloads scoped and reports active failures', async () => {
        let complete!: () => void
        const fixture = setup({
            loadWorkspaceAssets: vi.fn(() =>
                new Promise(resolve => {
                    complete = resolve
                })
            ),
        })
        const pending = fixture.owner.refreshWorkspaceDescriptors({ asset: {} as MediaDescriptor })
        fixture.setScope({ workspaceId: 'other', sceneKey: 'other' })
        complete()
        await pending
        expect(fixture.ports.loadWorkspaceAssets).toHaveBeenCalledWith('workspace')
        expect(fixture.ports.refreshContext).not.toHaveBeenCalled()
        fixture.ports.loadWorkspaceAssets = vi.fn(async () => {
            throw new Error('offline')
        })
        await fixture.owner.refreshWorkspaceDescriptors({ asset: {} as MediaDescriptor })
        expect(fixture.ports.reportError).toHaveBeenCalledOnce()
    })
})
