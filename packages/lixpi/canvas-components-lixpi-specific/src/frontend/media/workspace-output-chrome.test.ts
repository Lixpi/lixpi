// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    MEDIA_DESCRIPTOR_VERSION,
    type Asset,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type CapabilityArtifactCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceOutputChrome,
    type WorkspaceOutputChromePorts,
} from './workspace-output-chrome.ts'

const owners: WorkspaceOutputChrome[] = []
const image = (nodeId = 'image'): ImageCanvasNode => ({ nodeId, type: 'image', assetId: nodeId, position: { x: 100, y: 200 }, dimensions: { width: 400, height: 240 } })
const asset = (assetId = 'image'): Asset => ({ assetId, revision: 1, title: assetId, states: { provenance: 'sealed' }, documents: {}, media: { renditions: { original: { status: 'ready' } } } } as Asset)

function fixture(nodes: CanvasState['nodes'] = [image()]) {
    const state = { nodes, edges: [], viewport: { x: 10, y: 20, zoom: 1 } } as CanvasState
    const assets = new Map(nodes.map(node => [node.nodeId, asset(node.nodeId)]))
    const pending = new Set<string>()
    const frames = new Map<number, FrameRequestCallback>()
    const titles = new Map<HTMLElement, ReturnType<typeof vi.fn>>()
    let frameId = 0
    const ports: WorkspaceOutputChromePorts = {
        document,
        settings: { gap: 8, zoomScaling: { minZoom: 0.4 } },
        getState: () => state,
        getViewport: () => state.viewport,
        getBounds: node => ({ ...node.position, ...node.dimensions }),
        getPendingBounds: () => null,
        getPendingNodeIds: () => pending,
        getAsset: id => assets.get(id),
        getDocumentVersion: () => 1,
        getDescriptor: () => undefined,
        getTraceStatus: () => 'running',
        isProgressActive: () => false,
        isSelected: () => false,
        getVideo: () => undefined,
        video: { sync: vi.fn(), update: vi.fn(), outsideOffsetScreen: () => 0 },
        createModelBadge: vi.fn(() => document.createElement('div')),
        mountTitle: vi.fn((_node, host) => {
            const dispose = vi.fn()
            titles.set(host, dispose)
            return dispose
        }),
        queueAnalysis: vi.fn(),
        onOpenDetails: vi.fn(),
        onAccept: vi.fn(),
        onReject: vi.fn(),
        onRegenerate: vi.fn(),
        requestFrame: vi.fn(callback => {
            frames.set(++frameId, callback)
            return frameId
        }),
        cancelFrame: vi.fn(),
        onError: vi.fn(),
    }
    const owner = new WorkspaceOutputChrome(ports)
    document.body.append(owner.element, owner.pendingElement)
    owners.push(owner)
    return { owner, ports, state, assets, pending, frames, titles }
}

afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('WorkspaceOutputChrome', () => {
    it('shows media attribution from progress before Asset hydration', () => {
        const node = { ...image(), generationProgress: { mediaModelId: 'fixture:model', mediaModelProvider: 'fixture' } } as ImageCanvasNode
        const f = fixture([node])
        f.assets.clear()
        f.owner.sync()
        expect(f.owner.element.childElementCount).toBe(1)
        expect(f.ports.createModelBadge).toHaveBeenCalledWith({ modelId: 'fixture:model', modelProvider: 'fixture', iconOnly: false })
    })

    it('projects images, playable videos and Artifacts with canonical output identities', () => {
        const video = { ...image('video'), type: 'video' } as VideoCanvasNode
        const artifact = { ...image('artifact'), type: 'capabilityArtifact', artifactTypeId: 'fixture' } as CapabilityArtifactCanvasNode
        const f = fixture([image(), video, artifact])
        f.owner.sync()
        expect(f.owner.element.children).toHaveLength(3)
        expect(f.ports.video.sync).toHaveBeenCalledWith([video])
        f.owner.element.querySelectorAll<HTMLButtonElement>('.canvas-node-footer-info-button').forEach(button => button.click())
        expect(f.ports.onOpenDetails).toHaveBeenNthCalledWith(1, 'image')
        expect(f.ports.onOpenDetails).toHaveBeenNthCalledWith(2, 'video')
        expect(f.ports.onOpenDetails).toHaveBeenNthCalledWith(3, 'artifact')
    })

    it('updates progress, selection and geometry without remounting titles', () => {
        const f = fixture()
        f.owner.sync()
        const child = f.owner.element.firstElementChild as HTMLElement
        f.ports.isProgressActive = () => true
        f.ports.isSelected = () => true
        f.state.nodes[0].position.x = 160
        f.owner.sync()
        expect(f.owner.element.firstElementChild).toBe(child)
        expect(child.style.left).toBe('170px')
        expect(child.querySelector<HTMLButtonElement>('.canvas-node-footer-progress-button')?.hidden).toBe(false)
        expect(child.querySelector('.canvas-node-footer-info-button')?.getAttribute('aria-expanded')).toBe('true')
        expect(f.ports.mountTitle).toHaveBeenCalledOnce()
        expect(f.ports.video.sync).toHaveBeenCalledOnce()
    })

    it('releases replaced title editors and listeners when an Asset revision changes', () => {
        const f = fixture()
        f.owner.sync()
        const previous = f.owner.element.firstElementChild!
        const button = previous.querySelector<HTMLButtonElement>('.canvas-node-footer-info-button')!
        f.assets.set('image', { ...asset(), revision: 2 })
        f.owner.sync()
        expect(f.owner.element.firstElementChild).not.toBe(previous)
        expect([...f.titles.values()][0]).toHaveBeenCalledOnce()
        button.click()
        expect(f.ports.onOpenDetails).not.toHaveBeenCalled()
        expect(f.ports.mountTitle).toHaveBeenCalledTimes(2)
    })

    it('refreshes Artifact and provenance revisions independently', () => {
        const f = fixture([{ ...image(), type: 'capabilityArtifact', artifactTypeId: 'fixture' } as CapabilityArtifactCanvasNode])
        f.owner.sync()
        f.ports.getDocumentVersion = (_id, role) => role === 'capabilityArtifact' ? 2 : 1
        f.owner.sync()
        f.ports.getDocumentVersion = () => 2
        f.owner.sync()
        expect(f.ports.mountTitle).toHaveBeenCalledTimes(3)
    })

    it('places pending icons at node centers and footers below the pending circle', () => {
        const f = fixture()
        f.pending.add('image')
        f.ports.getPendingBounds = () => ({ x: 240, y: 260, width: 120, height: 120 })
        f.owner.sync()
        const icon = f.owner.pendingElement.firstElementChild as HTMLElement
        const footer = f.owner.element.firstElementChild as HTMLElement
        expect(icon.style.left).toBe('310px')
        expect(icon.style.top).toBe('340px')
        expect(footer.style.left).toBe('250px')
        expect(parseFloat(footer.style.top)).toBeGreaterThanOrEqual(400)
        expect(f.ports.createModelBadge).toHaveBeenCalledWith(expect.objectContaining({ iconOnly: true }))
        expect(f.ports.createModelBadge).toHaveBeenCalledOnce()
        f.pending.clear()
        f.owner.sync()
        expect(f.owner.pendingElement.childElementCount).toBe(0)
        expect(f.ports.createModelBadge).toHaveBeenCalledWith(expect.objectContaining({ iconOnly: false }))
    })

    it('requests analysis only for ready descriptors with an obsolete version', () => {
        const f = fixture()
        f.ports.getDescriptor = () => ({ status: 'ready', version: MEDIA_DESCRIPTOR_VERSION - 1 } as ReturnType<WorkspaceOutputChromePorts['getDescriptor']>)
        f.owner.sync()
        expect(f.ports.queueAnalysis).toHaveBeenCalledWith(f.state.nodes[0])
        f.ports.getDescriptor = () => ({ status: 'ready', version: MEDIA_DESCRIPTOR_VERSION } as ReturnType<WorkspaceOutputChromePorts['getDescriptor']>)
        f.owner.sync()
        expect(f.ports.queueAnalysis).toHaveBeenCalledOnce()
    })

    it('coalesces frames, cancels cleared work and suppresses callbacks after disposal', () => {
        const f = fixture()
        f.owner.schedule()
        f.owner.schedule()
        expect(f.frames.size).toBe(1)
        f.owner.clear()
        expect(f.ports.cancelFrame).toHaveBeenCalledWith(1)
        f.owner.schedule()
        f.frames.get(1)!(0)
        expect(f.owner.element.childElementCount).toBe(0)
        f.frames.get(2)!(0)
        expect(f.owner.element.childElementCount).toBe(1)
        f.owner.schedule()
        f.owner.destroy()
        f.frames.get(3)!(0)
        f.owner.sync()
        f.owner.schedule()
        expect(f.ports.mountTitle).toHaveBeenCalledOnce()
        expect(f.ports.cancelFrame).toHaveBeenCalledWith(3)
        expect(f.owner.element.isConnected).toBe(false)
    })

    it('cleans partial mounts and permits a later explicit retry', () => {
        const f = fixture([image('first'), image('second')])
        const normalMount = f.ports.mountTitle
        f.ports.mountTitle = vi.fn((node, host) => {
            if (node.nodeId === 'second') throw new Error('editor unavailable')
            return normalMount(node, host)
        })
        expect(() => f.owner.sync()).toThrow('editor unavailable')
        expect([...f.titles.values()][0]).toHaveBeenCalledOnce()
        expect(f.owner.element.childElementCount).toBe(0)
        f.ports.mountTitle = normalMount
        f.owner.sync()
        expect(f.owner.element.childElementCount).toBe(2)
    })

    it('disposes every child after one cleanup fails without affecting another canvas', () => {
        const first = fixture([image('first'), image('second')])
        const second = fixture()
        first.owner.sync()
        second.owner.sync()
        const cleanups = [...first.titles.values()]
        cleanups[1].mockImplementationOnce(() => {
            throw new Error('release failed')
        })
        expect(() => first.owner.destroy()).toThrow()
        expect(cleanups[0]).toHaveBeenCalledOnce()
        expect(cleanups[1]).toHaveBeenCalledOnce()
        expect(first.owner.element.isConnected).toBe(false)
        expect(first.owner.pendingElement.isConnected).toBe(false)
        expect(second.owner.element.childElementCount).toBe(1)
        expect([...second.titles.values()][0]).not.toHaveBeenCalled()
    })
})
