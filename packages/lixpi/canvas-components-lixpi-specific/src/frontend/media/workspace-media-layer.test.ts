// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    Asset,
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'
import type {
    EngineMedia,
    ImageLease,
} from '@lixpi/canvas-engine/frontend/media'
import type {
    CanvasRendererOptions,
    ResourceHandle,
    ResourceKind,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    WorkspaceMediaLayer,
    type WorkspaceMediaLayerOptions,
} from './workspace-media-layer.ts'
import { createWorkspaceConnectorSettings } from '../connectors/workspace-connector-settings.ts'

const renderers = vi.hoisted(() => [] as any[])
vi.mock('@lixpi/canvas-engine/frontend/rendering', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-engine/frontend/rendering')>()
    class Renderer {
        readonly owner = Symbol()
        private id = 0
        scopes: AbortController[] = []
        ready = Promise.resolve(true)
        imageRequests: Array<{ request: Parameters<EngineMedia['acquireImage']>[0]; resolve: (lease: ImageLease) => void }> = []
        handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ kind, id: String(++this.id), owner: this.owner })
        resources = {
            createGroup: vi.fn(() => this.handle('group')),
            createTexture: vi.fn(() => this.handle('texture')),
            createPath: vi.fn(() => this.handle('path')),
            createMesh: vi.fn(() => this.handle('mesh')),
            updateGroup: vi.fn(),
            updateTexture: vi.fn(),
            updatePath: vi.fn(),
            updateMesh: vi.fn(),
            setPaint: vi.fn(),
            setMask: vi.fn(),
            setVisible: vi.fn(),
            release: vi.fn(),
        }
        layers = { media: this.handle('layer'), connectors: this.handle('layer'), foreground: this.handle('layer') }
        constructor(private options: CanvasRendererOptions) {
            renderers.push(this)
        }
        createScope() {
            const controller = new AbortController()
            this.scopes.push(controller)
            return {
                signal: controller.signal,
                resources: this.resources,
                layers: this.layers,
                media: {
                    acquireImage: vi.fn((request: Parameters<EngineMedia['acquireImage']>[0]) => new Promise<ImageLease>(resolve => this.imageRequests.push({ request, resolve }))),
                    acquirePlayback: async (request: Parameters<EngineMedia['acquirePlayback']>[0]) => this.options.mediaResolver!.resolve(request.media, request.renditionId, request.signal),
                },
                invalidate: vi.fn(),
                requestFrame: vi.fn(() => vi.fn()),
                destroy: () => controller.abort(),
            }
        }
        setViewport = vi.fn()
        resize = vi.fn()
        invalidate = vi.fn()
        renderNow = vi.fn()
        destroy() {
            for (const scope of this.scopes) scope.abort()
        }
    }
    return { ...actual, CanvasRenderer: Renderer }
})

vi.mock('@lixpi/canvas-components/effects/glass', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-components/effects/glass')>()
    class Material {
        bake() {
            return { kind: 'pixels', size: { width: 1, height: 1 }, rgba: new Uint8Array(4) }
        }
    }
    return { ...actual, TravelingSnakeGlassMaterial: Material, ClosedGlassStripMaterial: Material }
})

function settings(): WorkspaceMediaLayerOptions['settings'] {
    return {
        mediaBranchLineage: { generatedMediaSize: 300 },
        workspaceLoadingOutline: { diameterScale: 1 },
        connector: createWorkspaceConnectorSettings({ lineDefaultColor: '#000000' }),
        mediaNode: {
            styles: { borderRadius: 12 },
            inProgressOutlineAnimation: {
                radius: 12,
                gap: 3,
                snakeWidth: 4,
                snakeTailWidthFraction: 0.2,
                snakeTailThinLengthFraction: 0.1,
                snakeWidthTaperPower: 0.86,
                snakeLengthFraction: 0.8,
                snakeHeadRoundLengthFraction: 0.5,
                animationDurationMs: 1000,
                preFrameCircleScale: 1 / 3,
                zoomScaling: { minZoom: 0.1 },
                styles: { snakeColors: ['#ffffff'], snakeTailAlpha: 0.1, glassMaterial: { edgeFeatherFraction: 0.5 } },
            },
        },
        canvasChrome: { glassBorder: { enabled: false, materialColors: ['#ffffff'], materialTailAlpha: 0.1, glassMaterial: { edgeFeatherFraction: 0.5 } } },
    } as WorkspaceMediaLayerOptions['settings']
}

function mediaNode(nodeId: string, type: 'image' | 'video' | 'audio' | 'mediaDocument' = 'image', assetId = nodeId): CanvasNode {
    return { nodeId, type, assetId, position: { x: 10, y: 20 }, dimensions: { width: 100, height: 80 } }
}

function state(nodes: CanvasNode[]): CanvasState {
    return { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } as CanvasState
}

function fixture(nodeOptions: Partial<WorkspaceMediaLayerOptions['nodes']> = {}) {
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    paneEl.appendChild(viewportEl)
    document.body.appendChild(paneEl)
    vi.spyOn(paneEl, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON() {} })
    let workspaceId = 'first'
    const assets = new Map<string, Asset>()
    for (const [id, kind, mimeType] of [['image', 'image', 'image/png'], ['video', 'video', 'video/mp4'], ['audio', 'audio', 'audio/mpeg'], ['document', 'document', 'application/pdf']]) {
        assets.set(id, {
            assetId: id,
            title: id,
            revision: 1,
            media: {
                kind,
                sourceMimeType: mimeType,
                renditions: {
                    original: { name: 'original', status: 'ready', updatedAt: 1, mimeType, width: 100, height: 80 },
                    ...(kind === 'video' || kind === 'document' ? { poster: { name: 'poster', status: 'ready', updatedAt: 1, mimeType: 'image/webp', width: 100, height: 80 } } : {}),
                },
            },
        } as Asset)
    }
    const onImageIntrinsicSize = vi.fn()
    const onError = vi.fn()
    const onEdgesChange = vi.fn()
    const releases: ReturnType<typeof vi.fn>[] = []
    const sources = {
        getAsset: (id: string) => assets.get(id),
        resolveAssetRendition: vi.fn(async ({ assetId, renditionId }: { assetId: string; renditionId: string }) => {
            const release = vi.fn()
            releases.push(release)
            return { url: `https://example.test/${assetId}/${renditionId}`, release }
        }),
        resolveTransientSource: vi.fn(async (url: string) => ({ url, release: vi.fn() })),
    }
    const layer = new WorkspaceMediaLayer({
        paneEl,
        viewportEl,
        getWorkspaceId: () => workspaceId,
        sources,
        settings: settings(),
        nodes: {
            visible: state => state.nodes,
            geometry: () => ({
                measure: node => {
                    const bounds = { ...node.position, ...node.dimensions }
                    return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
                },
                resize: { min: { width: 1, height: 1 }, preserveAspectRatio: false },
                movable: true,
            }),
            mountDom: () => ({ element: document.createElement('div'), update() {}, destroy() {} }),
            ...nodeOptions,
        },
        selectionColors: { marqueeFill: '#ffffff', marqueeStroke: '#000000', groupOverlayFill: '#ffffff', groupOverlayStroke: '#000000' },
        marker: { paths: [], width: 256, reference: { x: 48, y: 128 } },
        onImageIntrinsicSize,
        onError,
        onEdgesChange,
    })
    const renderer = renderers.at(-1)!
    const lease = (): ImageLease => ({ texture: renderer.handle('texture'), intrinsicSize: { width: 100, height: 80 }, renditionId: 'original', release: vi.fn() })
    return {
        layer,
        renderer,
        assets,
        paneEl,
        viewportEl,
        releases,
        sources,
        onError,
        onEdgesChange,
        onImageIntrinsicSize,
        lease,
        switchWorkspace: () => {
            workspaceId = 'second'
        },
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    )
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    renderers.length = 0
    document.body.replaceChildren()
})

describe('WorkspaceMediaLayer registration integration', () => {
    it('retires preflight markers and retains the planned owner and unrelated editors', () => {
        const destroyed: string[] = []
        const mounted: string[] = []
        const { layer, onError } = fixture({
            mountDom: node => {
                mounted.push(node.nodeId)
                const element = document.createElement('div')
                element.dataset.markerId = node.nodeId
                return {
                    element,
                    update() {},
                    destroy: () => {
                        destroyed.push(node.nodeId)
                    },
                }
            },
        })
        const editor: CanvasNode = { ...mediaNode('editor'), type: 'document' }
        const preflight = { ...mediaNode('preflight'), type: 'branchOrigin', conversationAssetId: 'thread' } as CanvasNode
        const planned = { ...preflight, nodeId: 'planned', position: { x: 150, y: 250 } }
        layer.sync(state([editor, preflight, planned]))
        const editorElement = layer.worldElement.querySelector('[data-marker-id="editor"]')
        const plannedElement = layer.worldElement.querySelector('[data-marker-id="planned"]')
        layer.sync(state([editor, { ...planned, position: { x: 300, y: 400 } }]))
        expect(destroyed).toEqual(['preflight'])
        expect(mounted).toEqual(['editor', 'preflight', 'planned'])
        expect(layer.worldElement.querySelector('[data-marker-id="preflight"]')).toBeNull()
        expect(layer.worldElement.querySelector('[data-marker-id="editor"]')).toBe(editorElement)
        expect(layer.worldElement.querySelector('[data-marker-id="planned"]')).toBe(plannedElement)
        expect(layer.getNodeBounds('planned')).toEqual({ x: 300, y: 400, width: 100, height: 80 })
        expect((plannedElement as HTMLElement).style.left).toBe('0px')
        layer.sync(state([editor]))
        expect(destroyed).toEqual(['preflight', 'planned'])
        expect(layer.worldElement.querySelector('[data-marker-id="planned"]')).toBeNull()
        layer.destroy()
        expect(destroyed).toEqual(['preflight', 'planned', 'editor'])
        expect(onError).not.toHaveBeenCalled()
    })

    it('preserves marquee origin while synchronizing a single selected node', () => {
        const { layer, onError } = fixture()
        layer.sync(state([{ ...mediaNode('selected'), type: 'document' }]))
        layer.canvas.setSelected(['selected'], true)
        layer.setSelectedImageNodes(layer.canvas.selection.nodeIds)
        expect(layer.canvas.selection.singleNodeId).toBe('selected')
        expect(layer.canvas.selection.fromMarquee).toBe(true)
        layer.destroy()
        expect(onError).not.toHaveBeenCalled()
    })

    it('renders registered connections and preserves hidden edges when deleting a visible edge', () => {
        const { layer, onEdgesChange, onError } = fixture({ visible: state => state.nodes.filter(node => node.nodeId !== 'hidden') })
        const scene = state([
            { ...mediaNode('source'), type: 'document' },
            { ...mediaNode('target'), type: 'document', position: { x: 400, y: 150 } },
            { ...mediaNode('hidden'), type: 'document' },
        ])
        const hidden = { edgeId: 'hidden-edge', sourceNodeId: 'hidden', targetNodeId: 'target' }
        scene.edges = [{ edgeId: 'visible-edge', sourceNodeId: 'source', targetNodeId: 'target', sourceT: 0.2, targetT: 0.8 }, hidden]
        layer.sync(scene)
        expect(layer.connections.getEdgeMidpointRect('visible-edge')).not.toBeNull()
        expect(layer.connections.getEdgeMidpointRect('hidden-edge')).toBeNull()
        layer.setSelectedImageNodes(new Set(['source', 'target']))
        expect(layer.connections.getEdgeMidpointRect('visible-edge')).not.toBeNull()
        layer.connections.selectEdge('visible-edge')
        layer.connections.deleteSelectedEdge()
        expect(onEdgesChange).toHaveBeenCalledExactlyOnceWith([hidden])
        layer.sync({ ...scene, edges: [hidden] })
        expect(layer.connections.getEdgeMidpointRect('visible-edge')).toBeNull()
        layer.destroy()
        expect(onError).not.toHaveBeenCalled()
    })

    it('mounts non-media content under the visible world root and preserves parent-relative geometry', () => {
        const destroyed: string[] = []
        const elements = new Map<string, HTMLElement>()
        const { layer, viewportEl, onError } = fixture({
            mountDom: node => {
                const element = document.createElement('div')
                elements.set(node.nodeId, element)
                return {
                    element,
                    update() {},
                    destroy: () => {
                        destroyed.push(node.nodeId)
                    },
                }
            },
        })
        const parent: CanvasNode = { ...mediaNode('parent'), type: 'document', position: { x: 100, y: 200 } }
        const child: CanvasNode = { ...mediaNode('image'), parentId: 'parent' }
        layer.sync(state([parent, child]))
        expect(viewportEl.contains(elements.get('parent')!)).toBe(true)
        expect(layer.worldElement.contains(elements.get('image')!)).toBe(true)
        expect(layer.getNodeBounds('image')).toEqual({ x: 110, y: 220, width: 100, height: 80 })
        expect(elements.get('image')!.style.left).toBe('0px')
        expect(elements.get('image')!.parentElement!.style.left).toBe('110px')
        layer.setNodeLiveTransform('parent', { x: 300, y: 400 }, parent.dimensions)
        expect(layer.getNodeBounds('image')).toMatchObject({ x: 310, y: 420 })
        layer.refreshAssets(new Set(['image']))
        expect(layer.getNodeBounds('image')).toMatchObject({ x: 310, y: 420 })
        layer.setViewport({ x: 20, y: 30, zoom: 2 })
        expect(viewportEl.style.transform).toBe('')
        expect(layer.worldElement.style.transform).toContain('scale(2)')
        layer.sync(state([parent]))
        expect(destroyed).toEqual(['image'])
        layer.destroy()
        expect(destroyed).toEqual(['image', 'parent'])
        expect(viewportEl.children).toHaveLength(0)
        expect(onError).not.toHaveBeenCalled()
    })

    it('keeps children at their world position when their parent is filtered from presentation', () => {
        const { layer } = fixture({ visible: state => state.nodes.filter(node => node.nodeId !== 'parent') })
        const parent: CanvasNode = { ...mediaNode('parent'), type: 'document', position: { x: 100, y: 200 } }
        layer.sync(state([parent, { ...mediaNode('image'), parentId: 'parent' }]))
        expect(layer.getNodeBounds('parent')).toBeUndefined()
        expect(layer.getNodeBounds('image')).toMatchObject({ x: 110, y: 220 })
        layer.destroy()
    })

    it('removes partial mounts and aborts scopes when observing the pane fails', () => {
        const observers: Array<ReturnType<typeof vi.fn>> = []
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor() {
                    observers.push(this.disconnect)
                }
                observe() {
                    throw new Error('Observer unavailable')
                }
                disconnect = vi.fn()
            },
        )
        expect(() => fixture()).toThrow('Observer unavailable')
        expect(document.body.firstElementChild?.children).toHaveLength(1)
        expect(document.querySelector('.workspace-canvas-media-layer')).toBeNull()
        expect(renderers.at(-1).scopes.every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        expect(observers.length).toBeGreaterThan(0)
        for (const disconnect of observers) expect(disconnect).toHaveBeenCalledOnce()
    })

    it('continues DOM cleanup when renderer disposal throws', () => {
        const { layer, renderer, paneEl, viewportEl, onError } = fixture()
        vi.spyOn(renderer, 'destroy').mockImplementation(() => {
            throw new Error('Renderer cleanup failed')
        })
        layer.destroy()
        expect(paneEl.children).toHaveLength(1)
        expect(paneEl.firstElementChild).toBe(viewportEl)
        expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(AggregateError))
        layer.destroy()
        expect(onError).toHaveBeenCalledOnce()
    })

    it('rejects invalid viewport updates before changing renderer state', () => {
        const { layer, renderer } = fixture()
        const calls = renderer.setViewport.mock.calls.length
        expect(() => layer.setViewport({ x: 0, y: 0, zoom: 0 })).toThrow('positive zoom')
        expect(renderer.setViewport).toHaveBeenCalledTimes(calls)
        layer.destroy()
    })

    it('mounts images, video, audio and document posters with explicit source metadata', async () => {
        const { layer, renderer, sources, onError, paneEl, viewportEl } = fixture()
        layer.sync(state([mediaNode('image'), mediaNode('video', 'video'), mediaNode('audio', 'audio'), mediaNode('document', 'mediaDocument')]))
        await Promise.resolve()
        await Promise.resolve()
        expect(renderer.imageRequests.map((entry: { request: Parameters<EngineMedia['acquireImage']>[0] }) => entry.request.media.kind)).toEqual(['image', 'video', 'document'])
        expect(layer.playback.getVideoElement('video')?.muted).toBe(true)
        expect(layer.playback.getVideoElement('video')?.loop).toBe(true)
        expect(layer.playback.getAudioElement('audio')).not.toBeNull()
        expect(sources.resolveAssetRendition).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'video', renditionId: 'original' }))
        layer.destroy()
        expect(paneEl.children).toHaveLength(1)
        expect(paneEl.firstElementChild).toBe(viewportEl)
        expect(onError).not.toHaveBeenCalled()
    })

    it('retains partial pixels until the declared final original has decoded', async () => {
        const { layer, renderer, lease, onImageIntrinsicSize } = fixture()
        layer.sync(state([]))
        const pending = { ...mediaNode('pending', 'image', ''), generatedBy: { conversationAssetId: 'conversation' } } as CanvasNode
        layer.sync(state([pending]))
        layer.setGeneratingImageNodes(new Map([['pending', { shape: 'preFrameCircle' }]]))
        expect(renderer.imageRequests).toHaveLength(0)
        layer.setTransientImageSource('pending', 'blob:partial')
        const partial = lease()
        renderer.imageRequests[0].resolve(partial)
        await Promise.resolve()
        layer.setGeneratingImageNodes(new Map([['pending', { sourceRendition: 'original' }]]))
        layer.sync(state([{ ...pending, assetId: 'image' } as CanvasNode]))
        expect(partial.release).not.toHaveBeenCalled()
        const finalRequest = renderer.imageRequests.at(-1)
        expect(finalRequest.request.media.renditions.map((rendition: { id: string }) => rendition.id)).toEqual(['original'])
        const final = lease()
        finalRequest.resolve(final)
        await Promise.resolve()
        expect(partial.release).toHaveBeenCalledOnce()
        expect(onImageIntrinsicSize).toHaveBeenLastCalledWith({ nodeId: 'pending', width: 100, height: 80, preserveNodeGeometry: true })
        layer.destroy()
        expect(final.release).toHaveBeenCalledOnce()
    })

    it('disposes a replaced workspace and ignores late image completion for reused node IDs', async () => {
        const { layer, renderer, lease, switchWorkspace, onImageIntrinsicSize } = fixture()
        const nodes = [mediaNode('image'), mediaNode('video', 'video')]
        layer.sync(state(nodes))
        const video = layer.playback.getVideoElement('video')!
        const firstRequest = renderer.imageRequests[0]
        switchWorkspace()
        layer.sync(state(nodes))
        expect(firstRequest.request.signal.aborted).toBe(true)
        expect(video.isConnected).toBe(false)
        expect(layer.playback.getVideoElement('video')).not.toBe(video)
        const stale = lease()
        firstRequest.resolve(stale)
        await Promise.resolve()
        expect(stale.release).toHaveBeenCalledOnce()
        expect(onImageIntrinsicSize).not.toHaveBeenCalled()
        layer.destroy()
    })

    it('does not reload pixels when an Asset title changes', async () => {
        const { layer, renderer, assets, lease } = fixture()
        layer.sync(state([mediaNode('image')]))
        renderer.imageRequests[0].resolve(lease())
        await Promise.resolve()
        assets.get('image')!.title = 'Renamed'
        assets.get('image')!.revision++
        layer.refreshAssets(new Set(['image']))
        expect(renderer.imageRequests).toHaveLength(1)
        layer.retryAssetTextures(new Set(['image']))
        expect(renderer.imageRequests).toHaveLength(2)
        layer.destroy()
    })
})
