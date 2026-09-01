// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    Asset,
    CanvasNode,
    CanvasState,
    ImageCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceGenerationVisuals,
    type WorkspaceGenerationVisualsPorts,
} from './workspace-generation-visuals.ts'
import {
    setGeneratedMediaTracker,
    type PendingGeneratedMediaTracker,
} from '../../shared/generation/workspace-media-trackers.ts'

const owners: WorkspaceGenerationVisuals[] = []
const image = (nodeId: string, overrides: Partial<ImageCanvasNode> = {}): ImageCanvasNode => ({ nodeId, assetId: `asset-${nodeId}`, type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 200 }, ...overrides })
const tracker = (nodeId: string, hasReceivedFrame = false): PendingGeneratedMediaTracker => ({ nodeId, assetId: `asset-${nodeId}`, placementKey: 'placement', hasReceivedFrame })
function fixture(nodes: CanvasNode[] = []) {
    let state = { nodes, edges: [] } as unknown as CanvasState
    let alwaysOn = false
    const assets = new Map<string, Asset>()
    const timers = new Map<number, () => void>()
    const cancelled = new Set<number>()
    const ports: WorkspaceGenerationVisualsPorts = {
        getState: () => state,
        getAsset: id => assets.get(id),
        images: new Map(),
        videos: new Map(),
        alwaysOn: () => alwaysOn,
        setTargets: vi.fn(),
        onFinalized: vi.fn(),
        getPendingInset: () => ({ x: 110, y: 60, size: 80 }),
        completionTimeoutMs: 30000,
        setTimer: vi.fn(callback => {
            const id = timers.size + 1
            timers.set(id, callback)
            return id
        }),
        clearTimer: vi.fn(id => {
            cancelled.add(id)
        }),
    }
    const view = new WorkspaceGenerationVisuals(ports)
    owners.push(view)
    return {
        view,
        ports,
        timers,
        cancelled,
        assets,
        setAlwaysOn: () => {
            alwaysOn = true
        },
        setState: (nodes: CanvasNode[]) => {
            state = { ...state, nodes }
        },
    }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    vi.restoreAllMocks()
})

describe('WorkspaceGenerationVisuals', () => {
    it('projects generated pixels clockwise and references counterclockwise without overriding outputs', () => {
        const f = fixture()
        f.ports.images.set('image-run', tracker('image', true))
        f.ports.videos.set('video-run', tracker('video'))
        f.view.setReferences('thread', ['reference', 'image'])
        f.view.sync()
        expect(f.ports.setTargets).toHaveBeenCalledWith(
            new Map([
                ['image', { direction: 'clockwise', shape: 'node' }],
                ['video', { direction: 'clockwise', shape: 'preFrameCircle' }],
                ['reference', { direction: 'counterclockwise' }],
            ]),
        )
        expect(f.view.pendingNodeIds()).toEqual(new Set(['video']))
        expect(f.view.removeReferences('thread')).toBe(true)
        expect(f.view.removeReferences('thread')).toBe(false)
    })

    it('restores persisted pending outputs but excludes terminal progress and decoded images', () => {
        const pending = image('pending', { mediaGenerationPhase: 'pending-before-first-frame' })
        const decoded = image('decoded', { mediaGenerationPhase: 'pending-before-first-frame' })
        const failed = image('failed', { generationProgress: { status: 'failed' } as ImageCanvasNode['generationProgress'] })
        const f = fixture([pending, decoded, failed])
        f.ports.images.set('failed-run', tracker('failed'))
        f.view.markFrameDecoded(decoded.nodeId)
        expect(f.view.pendingNodeIds()).toEqual(new Set(['pending']))
        expect(f.view.isPending('failed')).toBe(false)
        expect(f.view.isWaitingForFrame(decoded)).toBe(false)
        f.view.forgetDecodedFrame(decoded.nodeId)
        expect(f.view.isWaitingForFrame(decoded)).toBe(true)
    })

    it('uses Asset readiness only when no explicit canvas phase exists', () => {
        const node = image('one', { generatedBy: { conversationAssetId: 'thread' } as ImageCanvasNode['generatedBy'] })
        const f = fixture([node])
        expect(f.view.isPending(node.nodeId)).toBe(true)
        f.assets.set(node.assetId, { media: { renditions: { original: { status: 'ready' } } } } as Asset)
        expect(f.view.isPending(node.nodeId)).toBe(false)
        expect(f.view.isWaitingForFrame({ ...node, mediaGenerationPhase: 'pending-before-first-frame' })).toBe(true)
    })

    it('keeps a completion circle on the original rendition until finalization', () => {
        const f = fixture([image('one')])
        f.view.keepCompletion('run', tracker('temporary', true), { nodeId: 'one', assetId: 'final' })
        expect(f.ports.images.get('run')).toMatchObject({ nodeId: 'one', assetId: 'final', hasReceivedFrame: false })
        expect(f.ports.setTargets).toHaveBeenLastCalledWith(new Map([['one', { direction: 'clockwise', shape: 'preFrameCircle', sourceRendition: 'original' }]]))
        expect(f.ports.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000)
        f.view.clearCompletion('one')
        f.view.clearCompletion('one')
        expect(f.ports.images.size).toBe(0)
        expect(f.ports.onFinalized).toHaveBeenCalledExactlyOnceWith('one')
        expect(f.cancelled).toEqual(new Set([1]))
    })

    it('ignores a cancelled completion callback after a newer run takes the same node', () => {
        const f = fixture()
        f.view.keepCompletion('first', tracker('one'), image('one'))
        const stale = f.timers.get(1)!
        f.view.keepCompletion('second', tracker('one'), image('one'))
        vi.mocked(f.ports.onFinalized).mockClear()
        stale()
        expect(f.view.isFinalizing('one')).toBe(true)
        expect(f.ports.images.get('second')?.nodeId).toBe('one')
        expect(f.ports.onFinalized).not.toHaveBeenCalled()
        f.timers.get(2)!()
        expect(f.view.isFinalizing('one')).toBe(false)
        expect(f.ports.onFinalized).toHaveBeenCalledExactlyOnceWith('one')
    })

    it('retires a temporary node when the same run is assigned its final node', () => {
        const f = fixture()
        f.view.keepCompletion('run', tracker('temporary'), image('temporary'))
        f.view.keepCompletion('run', tracker('temporary'), image('final'))
        f.timers.get(1)!()
        expect(f.view.isFinalizing('temporary')).toBe(false)
        expect(f.view.isFinalizing('final')).toBe(true)
        expect(f.ports.images.get('run')?.nodeId).toBe('final')
    })

    it('does not delete a tracker reassigned to a different node before completion', () => {
        const f = fixture()
        f.view.keepCompletion('run', tracker('one'), image('one'))
        f.ports.images.set('run', tracker('two'))
        f.view.clearCompletion('one')
        expect(f.ports.images.get('run')?.nodeId).toBe('two')
    })

    it('removes aliases for one node while retaining unrelated runs', () => {
        const values = new Map([['alias', tracker('one')], ['other', tracker('two')]])
        setGeneratedMediaTracker(values, 'canonical', tracker('one', true))
        expect([...values.keys()]).toEqual(['other', 'canonical'])
        expect(values.get('canonical')?.hasReceivedFrame).toBe(true)
    })

    it('clears view state across scene replacement and rejects delayed callbacks', () => {
        const f = fixture()
        f.view.keepCompletion('run', tracker('one'), image('one'))
        f.view.markFrameDecoded('one')
        f.view.setReferences('thread', ['reference'])
        f.view.clear()
        f.timers.get(1)!()
        expect(f.ports.onFinalized).not.toHaveBeenCalled()
        expect(f.view.hasDecodedFrame('one')).toBe(false)
        expect(f.view.removeReferences('thread')).toBe(false)
        expect(f.view.isFinalizing('one')).toBe(false)
        f.ports.images.clear()
        f.view.keepCompletion('new-run', tracker('new'), image('new'))
        expect(f.view.isFinalizing('new')).toBe(true)
    })

    it('releases every timer if one cancellation fails and blocks new work after destruction', () => {
        const f = fixture()
        f.view.keepCompletion('first', tracker('one'), image('one'))
        f.view.keepCompletion('second', tracker('two'), image('two'))
        vi.mocked(f.ports.clearTimer).mockImplementationOnce(() => {
            throw new Error('cancel failed')
        })
        expect(() => f.view.destroy()).toThrow()
        expect(f.ports.clearTimer).toHaveBeenCalledTimes(2)
        for (const callback of f.timers.values()) callback()
        expect(f.ports.onFinalized).not.toHaveBeenCalled()
        f.view.keepCompletion('late', tracker('late'), image('late'))
        f.view.markFrameDecoded('late')
        f.view.setReferences('late', ['late'])
        expect(f.ports.setTimer).toHaveBeenCalledTimes(2)
        expect(f.view.hasDecodedFrame('late')).toBe(false)
        expect(f.view.pendingNodeIds().size).toBe(0)
    })

    it('cleans up a failed timer allocation', () => {
        const f = fixture()
        vi.mocked(f.ports.setTimer).mockImplementationOnce(() => {
            throw new Error('timer failed')
        })
        expect(() => f.view.keepCompletion('run', tracker('one'), image('one'))).toThrow('timer failed')
        expect(f.view.isFinalizing('one')).toBe(false)
        expect(f.ports.images.has('run')).toBe(false)
    })

    it('keeps two canvas instances independent even when node IDs match', () => {
        const first = fixture()
        const second = fixture()
        first.view.keepCompletion('run', tracker('one'), image('one'))
        second.view.keepCompletion('run', tracker('one'), image('one'))
        first.view.destroy()
        first.timers.get(1)!()
        expect(second.view.isFinalizing('one')).toBe(true)
        expect(second.cancelled.size).toBe(0)
    })

    it('preserves the development outline override and pending hit-area properties', () => {
        const pending = image('pending', { mediaGenerationPhase: 'pending-before-first-frame' })
        const f = fixture([pending, image('ready')])
        f.setAlwaysOn()
        f.view.sync()
        expect(f.ports.setTargets).toHaveBeenLastCalledWith(
            new Map([
                ['pending', { direction: 'clockwise', shape: 'preFrameCircle' }],
                ['ready', { direction: 'counterclockwise', shape: 'node' }],
            ]),
        )
        const element = document.createElement('div')
        f.view.updateHitArea(element, 'pending')
        expect(element.classList.contains('is-pending-generated-media-before-frame')).toBe(true)
        expect(element.style.getPropertyValue('--workspace-pending-media-hit-size')).toBe('80px')
        f.setState([image('pending', { mediaGenerationPhase: 'ready' })])
        f.view.updateHitArea(element, 'pending')
        expect(element.classList.contains('is-pending-generated-media-before-frame')).toBe(false)
    })
})
