'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPixiMediaLayer } from '$src/infographics/workspace/pixiMediaLayer.ts'

function makeImageNode(nodeId: string, overrides: Record<string, any> = {}): Record<string, any> {
    return {
        nodeId,
        assetId: `${nodeId}-asset`,
        type: 'image',
        fileId: `${nodeId}-file`,
        workspaceId: 'workspace-1',
        src: `/${nodeId}.png`,
        dimensions: { width: 100, height: 70 },
        position: { x: 10, y: 20 },
        referenceId: `${nodeId}-ref`,
        ...overrides,
    }
}

function makeNonImageNode(nodeId: string, type: 'video' | 'document'): Record<string, any> {
    return {
        nodeId,
        type,
        fileId: `${nodeId}-file`,
        workspaceId: 'workspace-1',
        src: `/${nodeId}.bin`,
        dimensions: { width: 50, height: 30 },
        position: { x: 5, y: 6 },
        referenceId: `${nodeId}-ref`,
    }
}

const mediaNodeRegistryCalls: {
    dispatchSync: ReturnType<typeof vi.fn>
    dispatchRemove: ReturnType<typeof vi.fn>
    dispatchLiveTransform: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    register: ReturnType<typeof vi.fn>
} = {
    dispatchSync: vi.fn(),
    dispatchRemove: vi.fn(),
    dispatchLiveTransform: vi.fn(),
    destroy: vi.fn(),
    register: vi.fn(),
}

const outlineRendererInstances: Array<{
    sync: ReturnType<typeof vi.fn>
    updateGeometry: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}> = []
const edgeRendererInstances: Array<{
    render: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}> = []
const glassBorderRendererInstances: Array<{
    sync: ReturnType<typeof vi.fn>
    getCaptureTexture: ReturnType<typeof vi.fn>
    setCapturing: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    container: unknown
    style: unknown
}> = []
const pixiApplicationInstances: Array<{
    init: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    render: ReturnType<typeof vi.fn>
    renderer: { render: ReturnType<typeof vi.fn>; gc: { enabled: boolean; maxUnusedTime?: number } }
    stage: { addChild: ReturnType<typeof vi.fn> }
}> = []
const pixiSpriteInstances: Array<{
    label: string
    destroy: ReturnType<typeof vi.fn>
}> = []
const pixiGraphicsInstances: Array<{
    label: string
    destroy: ReturnType<typeof vi.fn>
}> = []
let glassCaptureTexture: unknown = null
const screenGlassResizeObserverInstances: FakeResizeObserver[] = []

class FakeResizeObserver {
    readonly observedElements = new Set<Element>()
    readonly observe = vi.fn((element: Element) => this.observedElements.add(element))
    readonly unobserve = vi.fn((element: Element) => this.observedElements.delete(element))
    readonly disconnect = vi.fn(() => this.observedElements.clear())

    constructor(readonly callback: ResizeObserverCallback) {
        screenGlassResizeObserverInstances.push(this)
    }
}

function notifyScreenGlassTargetResize(element: Element): void {
    for (const observer of screenGlassResizeObserverInstances) {
        if (!observer.observedElements.has(element)) continue
        observer.callback([] as ResizeObserverEntry[], observer as unknown as ResizeObserver)
    }
}

vi.mock('pixi.js', () => {
    const fakeFrameRequest = { x: 0, y: 0 }

    class FakeContainer {
        public children: any[] = []
        public parent: any = null
        public position = { set: vi.fn((x: number, y: number) => {
            fakeFrameRequest.x = x
            fakeFrameRequest.y = y
        }) }
        public label = ''
        public eventMode = ''

        constructor(public options: { label?: string } = {}) {
            if (options?.label) {
                this.label = options.label
            }
        }

        public addChild(child: any): any {
            this.children.push(child)
            child.parent = this
            return child
        }

        public removeChild(child: any): void {
            this.children = this.children.filter((candidate) => candidate !== child)
            if (child) child.parent = null
        }

        public scale = {
            set: vi.fn(),
        }
    }

    class FakeGraphics extends FakeContainer {
        public fill = vi.fn()
        public stroke = vi.fn()
        public roundRect = vi.fn()
        public clear = vi.fn()
        public destroy = vi.fn()
        public beginPath = vi.fn()
        public moveTo = vi.fn()
        public lineTo = vi.fn()

        constructor() {
            super()
            pixiGraphicsInstances.push(this)
        }
    }

    class FakeTexture {
        public width = 100
        public height = 100
        public source = { autoGenerateMipmaps: false }

        destroy = vi.fn()

        static EMPTY = new FakeTexture(0, 0)

        static from(bitmap: any): FakeTexture {
            const texture = new FakeTexture(bitmap?.width ?? 100, bitmap?.height ?? 100)
            return texture
        }
    }

    class FakeSprite extends FakeContainer {
        public texture: any
        public visible = false
        public renderable = true
        public mask: any = null

        public width = 0
        public height = 0

        constructor(texture: any = FakeTexture.EMPTY) {
            super()
            this.texture = texture
            pixiSpriteInstances.push(this)
        }

        public destroy = vi.fn()
    }

    class FakeTicker {
        stop = vi.fn()
    }

    class FakeApplication {
        public static reset() {}
        public stage = new FakeContainer()
        public world = new FakeContainer()
        public ticker = new FakeTicker()
        public canvas = document.createElement('canvas') as HTMLCanvasElement
        public init = vi.fn(async () => undefined)
        public render = vi.fn()
        public renderer = {
            render: vi.fn(),
            gc: { enabled: true },
        }
        public destroy = vi.fn()

        constructor() {
            pixiApplicationInstances.push(this)
        }
    }

    return {
        Application: FakeApplication,
        Container: FakeContainer,
        Graphics: FakeGraphics,
        Sprite: FakeSprite,
        Texture: FakeTexture,
    }
})

vi.mock('$src/utils/domTemplates.ts', () => ({
    html: (_template: unknown, ..._values: unknown[]) => document.createElement('div'),
    applyStyle: vi.fn(),
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(async () => 'test-token'),
    },
}))

vi.mock('$src/infographics/workspace/pixiImageDecoder.ts', () => ({
    decodeImageInWorker: vi.fn(async () => ({ width: 10, height: 10 } as ImageBitmap)),
    destroyPixiImageDecoder: vi.fn(),
}))

vi.mock('$src/infographics/workspace/pixiMediaLayerLogic.ts', () => ({
    addPixiLodSizeParam: (url: string, tier: string) => `${url}&tier=${tier}`,
    buildNodesById: (nodes: Array<{ nodeId: string }>) => new Map(nodes.map((node) => [node.nodeId, node] as const)),
    buildPixiImageSrc: (resolvedSrc: string, _apiBaseUrl: string, token: string | false) => `${resolvedSrc}?token=${token ?? ''}`,
    computeWorldPosition: (node: any) => node.position,
    getPixiLodTier: (zoom: number) => (zoom >= 1 ? 'full' : 'thumb-256') as const,
    getVisibleWorldRect: () => ({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }),
    isGeneratedImageNodeWaitingForFrame: (node: { generatedBy?: unknown; fileId?: string; src?: string }) =>
        Boolean(node.generatedBy) && !node.fileId && !node.src,
    makeIndexedImage: (node: { nodeId: string; dimensions: { width: number; height: number }; position: { x: number; y: number } }) => ({
        nodeId: node.nodeId,
        minX: node.position.x,
        minY: node.position.y,
        maxX: node.position.x + node.dimensions.width,
        maxY: node.position.y + node.dimensions.height,
    }),
    resolveStoredImagePath: (node: { src?: string }) => node.src ?? '',
    tierRank: (tier: string) => ({ color: 0, 'thumb-256': 1, full: 2 }[tier] ?? 0),
}))

vi.mock('$src/infographics/workspace/rendering/pixiEdgeRenderer.ts', () => ({
    createPixiEdgeRenderer: vi.fn(() => {
        const instance = { render: vi.fn(), destroy: vi.fn() }
        edgeRendererInstances.push(instance)
        return instance
    }),
}))

vi.mock('$src/infographics/workspace/rendering/mediaNodeRegistry.ts', () => ({
    createMediaNodeRegistry: () => mediaNodeRegistryCalls,
}))

vi.mock('@lixpi/canvas-engine/frontend/rendering', async () => {
    const actual = await vi.importActual<typeof import('@lixpi/canvas-engine/frontend/rendering')>(
        '@lixpi/canvas-engine/frontend/rendering'
    )

    return {
        ...actual,
        PixiGlassBorderRenderer: class FakePixiGlassBorderRenderer {
            public sync = vi.fn()
            public getCaptureTexture = vi.fn(() => glassCaptureTexture)
            public setCapturing = vi.fn()
            public destroy = vi.fn()

            public constructor(public options: { container: unknown; style: unknown }) {
                glassBorderRendererInstances.push({
                    sync: this.sync,
                    getCaptureTexture: this.getCaptureTexture,
                    setCapturing: this.setCapturing,
                    destroy: this.destroy,
                    container: options.container,
                    style: options.style,
                })
            }
        },
        PixiTravelingOutlineRenderer: class FakePixiTravelingOutlineRenderer {
            public sync = vi.fn()
            public updateGeometry = vi.fn()
            public setVisible = vi.fn()
            public destroy = vi.fn()

            public constructor() {
                outlineRendererInstances.push({
                    sync: this.sync,
                    updateGeometry: this.updateGeometry,
                    setVisible: this.setVisible,
                    destroy: this.destroy,
                })
            }
        },
    }
})

vi.mock('$src/settings.ts', () => ({
    settings: {
        mediaNode: {
            styles: {
                borderRadius: 8,
            },
            inProgressOutlineAnimation: {
                radius: 10,
                gap: 3,
                preFrameCircleScale: 1.3 / 3,
                snakeWidth: 4,
                snakeTailWidthFraction: 0.14,
                snakeTailThinLengthFraction: 0.1,
                snakeWidthTaperPower: 0.86,
                snakeLengthFraction: 0.8,
                snakeHeadRoundLengthFraction: 0.5,
                animationDurationMs: 2000,
                zoomScaling: { minZoom: 0.4 },
                developmentFlags: { alwaysOn: false },
                styles: {
                    snakeTailAlpha: 0.3,
                    snakeColors: ['#fff'],
                    glassMaterial: {},
                },
            },
            branchMarkerMediaModelCircleGlass: {
                textureSize: 128,
                translucency: 0.92,
                rimFeatherFraction: 0.07,
                glassColors: ['#6b7480'],
                glassMaterial: {},
            },
            image: {
                styles: {
                    borderRadius: 8,
                },
            },
        },
        dropdown: {
            styles: { popoverBoxShadow: '' },
        },
        connector: {
            scaling: {
                zoomScaling: { minZoom: 0.4 },
            },
        },
        canvasChrome: {
            glassBorder: {
                enabled: true,
                widthPx: 10,
                displacementScalePx: 34,
                displacementMapMaxDimensionPx: 1600,
                edgeRefractionStrength: 0.95,
                surfaceWaveStrength: 0.26,
                causticBandStrength: 0.34,
                displacementFrequencyX: 4.8,
                displacementFrequencyY: 3.9,
                bodyColor: '#ffffff',
                bodyAlpha: 0.035,
                highlightColor: '#ffffff',
                highlightAlpha: 0.2,
                shadowColor: '#415061',
                shadowAlpha: 0.1,
                materialColors: ['#ffffff', '#f7fbff'],
                materialTailAlpha: 1,
                glassMaterial: {},
            },
        },
        aiChatThread: {
            panel: {
                actions: {
                    borderWidth: 1,
                    borderColor: '#000',
                    borderStyle: 'solid',
                    borderRadius: '6px',
                    activeColor: '#000',
                    inactiveColor: '#000',
                    activeBackground: '#000',
                    disabledColor: '#000',
                    disabledBackground: '#000',
                    activeBackgroundColor: '#000',
                    sessionHistoryBackground: '#000',
                    threadListBackground: '#000',
                    threadText: '#000',
                    threadTextActive: '#000',
                    contextChipTextColor: '#000',
                    contextChipBackground: '#000',
                    contextChipRemoveBackground: '#000',
                    contextChipRemoveColor: '#000',
                },
            },
            sessionHistory: {
                styles: {
                    controlColor: '#000',
                    controlHoverColor: '#000',
                    historyToggleHoverBackground: '#000',
                    actionHoverBackground: '#000',
                    actionHoverColor: '#000',
                    deleteColor: '#000',
                    hoverBackgroundImage: '',
                    threadMarkerBackground: '#000',
                    threadMarkerBoxShadow: '#000',
                },
            },
            contextPreview: {
                styles: {
                    controlsColor: '#000',
                    chipBackground: '#000',
                    triggerBorderRadius: '4px',
                    previewBorderRadius: '4px',
                    tooltipBackground: '#000',
                    tooltipBorder: '#000',
                    tooltipBorderRadius: '4px',
                    tooltipBoxShadow: '#000',
                    tooltipColor: '#000',
                    videoBackground: '#000',
                    videoGlyphBackground: '#000',
                    videoGlyphColor: '#000',
                    documentColor: '#000',
                    documentSkeletonLineBorderRadius: '4px',
                    documentSkeletonLineBackground: '#000',
                    documentIconColor: '#000',
                    documentTextColor: '#000',
                    popoverTitleColor: '#000',
                    popoverTextColor: '#000',
                    removeButtonBackground: '#000',
                    removeButtonColor: '#000',
                    removeButtonBoxShadow: '#000',
                },
            },
        },
    },
}))

function makeCanvasState(overrides: Partial<{ nodes: unknown[]; viewport: { x: number; y: number; zoom: number }; edges: unknown[] }> = {}) {
    return {
        nodes: overrides.nodes ?? [],
        edges: overrides.edges ?? [],
        viewport: overrides.viewport ?? { x: 0, y: 0, zoom: 1 },
        sourceContext: {},
    }
}

function createTestLayer(): ReturnType<typeof createPixiMediaLayer> {
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    paneEl.appendChild(viewportEl)
    const selectionColors = {
        marqueeStroke: '#000',
        marqueeFill: '#000',
        groupOverlayStroke: '#000',
        groupOverlayFill: '#000',
    }

    return createPixiMediaLayer({
        paneEl,
        viewportEl,
        getWorkspaceId: () => 'workspace-1',
        selectionColors,
    })
}

function setElementRect(
    element: HTMLElement,
    rect: { left: number; top: number; width: number; height: number }
): void {
    Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            ...rect,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            x: rect.left,
            y: rect.top,
            toJSON: () => rect,
        }),
    })
}

type ScreenGlassTargetLayerFixture = {
    layer: ReturnType<typeof createPixiMediaLayer>
    rightControlRail: HTMLElement
    rightControlRailRect: { left: number; top: number; width: number; height: number }
}

function createLayerWithScreenGlassTargets(): ScreenGlassTargetLayerFixture {
    const rootEl = document.createElement('div')
    rootEl.className = 'workspace-canvas'
    const leftPanel = document.createElement('div')
    leftPanel.className = 'workspace-canvas-action-panel-left'
    leftPanel.style.borderRadius = '50%'
    leftPanel.style.borderTopLeftRadius = '50%'
    leftPanel.style.borderTopRightRadius = '50%'
    leftPanel.style.borderBottomRightRadius = '50%'
    leftPanel.style.borderBottomLeftRadius = '50%'
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    const composerEl = document.createElement('div')
    composerEl.className = 'workspace-canvas-global-composer'
    composerEl.style.borderRadius = '999px'
    composerEl.style.borderTopLeftRadius = '999px'
    composerEl.style.borderTopRightRadius = '999px'
    composerEl.style.borderBottomRightRadius = '999px'
    composerEl.style.borderBottomLeftRadius = '999px'
    const mediaLibraryPanel = document.createElement('div')
    mediaLibraryPanel.className = 'workspace-canvas-media-library-panel'
    mediaLibraryPanel.style.borderRadius = '50%'
    mediaLibraryPanel.style.borderTopLeftRadius = '50%'
    mediaLibraryPanel.style.borderTopRightRadius = '50%'
    mediaLibraryPanel.style.borderBottomRightRadius = '50%'
    mediaLibraryPanel.style.borderBottomLeftRadius = '50%'
    const rightControlRail = document.createElement('div')
    rightControlRail.className = 'workspace-canvas-right-control-rail'
    rightControlRail.style.borderRadius = '999px'
    rightControlRail.style.borderTopLeftRadius = '999px'
    rightControlRail.style.borderTopRightRadius = '999px'
    rightControlRail.style.borderBottomRightRadius = '999px'
    rightControlRail.style.borderBottomLeftRadius = '999px'
    const rightControlRailRect = { left: 510, top: 268, width: 298, height: 40 }

    setElementRect(paneEl, { left: 10, top: 20, width: 900, height: 300 })
    setElementRect(leftPanel, { left: 30, top: 260, width: 80, height: 56 })
    setElementRect(mediaLibraryPanel, { left: 130, top: 268, width: 40, height: 40 })
    setElementRect(composerEl, { left: 190, top: 250, width: 300, height: 64 })
    setElementRect(rightControlRail, rightControlRailRect)

    paneEl.appendChild(composerEl)
    paneEl.appendChild(viewportEl)
    rootEl.appendChild(leftPanel)
    rootEl.appendChild(mediaLibraryPanel)
    rootEl.appendChild(paneEl)
    rootEl.appendChild(rightControlRail)
    document.body.appendChild(rootEl)

    return {
        layer: createPixiMediaLayer({
            paneEl,
            viewportEl,
            getWorkspaceId: () => 'workspace-1',
            selectionColors: {
                marqueeStroke: '#000',
                marqueeFill: '#000',
                groupOverlayStroke: '#000',
                groupOverlayFill: '#000',
            },
        }),
        rightControlRail,
        rightControlRailRect,
    }
}

function getDebugDump(): {
    entries: Array<Record<string, any>>
    events: Array<{ event: string; details: Record<string, any> }>
    gpuBufferDestroys: Array<Record<string, any>>
} {
    const dump = (window as typeof window & {
        __lixpiPixiMediaDebugDump?: () => {
            entries: Array<Record<string, any>>
            events: Array<{ event: string; details: Record<string, any> }>
            gpuBufferDestroys: Array<Record<string, any>>
        }
    }).__lixpiPixiMediaDebugDump
    expect(dump, 'PIXI media debug dump should be installed').toBeTypeOf('function')
    return dump!()
}

function findLatestDebugEvent(eventName: string): { event: string; details: Record<string, any> } {
    const events = getDebugDump().events.filter((event) => event.event === eventName)
    expect(events.length, `${eventName} debug event should exist`).toBeGreaterThan(0)
    return events.at(-1)!
}

function clearMocks(): void {
    mediaNodeRegistryCalls.dispatchSync.mockReset()
    mediaNodeRegistryCalls.dispatchRemove.mockReset()
    mediaNodeRegistryCalls.dispatchLiveTransform.mockReset()
    mediaNodeRegistryCalls.destroy.mockReset()
    mediaNodeRegistryCalls.register.mockReset()
    edgeRendererInstances.length = 0
    pixiApplicationInstances.length = 0
    outlineRendererInstances.length = 0
    glassBorderRendererInstances.length = 0
    glassCaptureTexture = null
    screenGlassResizeObserverInstances.length = 0
    pixiSpriteInstances.length = 0
    pixiGraphicsInstances.length = 0
    window.localStorage.removeItem('lixpi.debug.pixiMedia')
    const debugWindow = window as typeof window & {
        __lixpiPixiMediaDebug?: boolean
        __lixpiPixiMediaDebugCollect?: boolean
        __lixpiPixiMediaDebugEvents?: unknown[]
        __lixpiPixiMediaDebugDump?: unknown
        __lixpiGpuBufferDestroyEvents?: unknown[]
        __lixpiGpuBufferDestroyDebugInstalled?: boolean
        __lixpiGpuBufferDestroyDebugVersion?: number
        __lixpiGpuBufferDestroyOriginal?: (this: unknown) => void
        __lixpiGpuBufferDestroyQueue?: unknown[]
        __lixpiGpuBufferDestroyQueued?: WeakSet<object>
        __lixpiGpuBufferDestroyRaf?: number | null
    }
    delete debugWindow.__lixpiPixiMediaDebug
    delete debugWindow.__lixpiPixiMediaDebugEvents
    delete debugWindow.__lixpiPixiMediaDebugDump
    delete debugWindow.__lixpiGpuBufferDestroyEvents
    delete debugWindow.__lixpiGpuBufferDestroyDebugInstalled
    delete debugWindow.__lixpiGpuBufferDestroyDebugVersion
    delete debugWindow.__lixpiGpuBufferDestroyOriginal
    debugWindow.__lixpiGpuBufferDestroyQueue = []
    debugWindow.__lixpiGpuBufferDestroyQueued = new WeakSet<object>()
    debugWindow.__lixpiGpuBufferDestroyRaf = null
    // Debug event collection is off in normal runs because it costs a forced
    // layout per event; the assertions below read that log, so turn it on.
    debugWindow.__lixpiPixiMediaDebugCollect = true
}

describe('createPixiMediaLayer runtime behavior', () => {
    beforeEach(() => {
        clearMocks()
        mediaNodeRegistryCalls.dispatchSync.mockReturnValue(true)
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        ;(globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
            cb(0)
            return 1
        })
        ;(globalThis as any).cancelAnimationFrame = vi.fn(() => undefined)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('initializes asynchronously and transitions health to ready', async () => {
        const layer = createTestLayer()

        expect(layer.getHealth()).toBe('initializing')

        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))
    })

    it('initializes Pixi as WebGPU with renderer GC disabled', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const app = pixiApplicationInstances.at(-1)
        expect(app?.init).toHaveBeenCalledWith(expect.objectContaining({
            preference: 'webgpu',
            gcActive: false,
            webgpu: expect.objectContaining({ powerPreference: 'high-performance' }),
        }))
        expect(app?.renderer.gc.enabled).toBe(false)
    })

    it('defers and deduplicates native GPUBuffer.destroy calls before forwarding them', async () => {
        const previousGpuBufferDescriptor = Object.getOwnPropertyDescriptor(window, 'GPUBuffer')
        const rafCallbacks: FrameRequestCallback[] = []
        const nativeDestroy = vi.fn()
        class FakeGpuBuffer {
            public destroy(): void {
                nativeDestroy(this)
            }
        }
        Object.defineProperty(window, 'GPUBuffer', {
            configurable: true,
            value: FakeGpuBuffer,
        })
        ;(globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
            rafCallbacks.push(cb)
            return rafCallbacks.length
        })

        try {
            const layer = createTestLayer()
            await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))
            rafCallbacks.length = 0

            const buffer = new FakeGpuBuffer()
            buffer.destroy()
            buffer.destroy()

            expect(nativeDestroy).not.toHaveBeenCalled()
            expect(getDebugDump().gpuBufferDestroys.map((event) => event.deferred)).toEqual([true, false])
            expect(getDebugDump().gpuBufferDestroys.map((event) => event.queueLength)).toEqual([1, 1])

            for (let frame = 1; frame <= 3; frame++) {
                const callback = rafCallbacks.shift()
                expect(callback, `deferred destroy frame ${frame} should be queued`).toBeTypeOf('function')
                callback!(frame)
                expect(nativeDestroy).not.toHaveBeenCalled()
            }

            const finalCallback = rafCallbacks.shift()
            expect(finalCallback, 'final deferred destroy frame should be queued').toBeTypeOf('function')
            finalCallback!(4)
            expect(nativeDestroy).toHaveBeenCalledTimes(1)
            expect(nativeDestroy).toHaveBeenCalledWith(buffer)
        } finally {
            if (previousGpuBufferDescriptor) {
                Object.defineProperty(window, 'GPUBuffer', previousGpuBufferDescriptor)
            } else {
                Reflect.deleteProperty(window, 'GPUBuffer')
            }
        }
    })

    it('keeps always-on debug events compact while dump snapshots still expose entry state', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        layer.sync(makeCanvasState({ nodes: [makeImageNode('debug-image')] }))

        const syncStart = findLatestDebugEvent('sync-start')
        const visibilityEnd = findLatestDebugEvent('visibility-pass-end')
        const dump = getDebugDump()

        expect(syncStart.details.imageNodes).toEqual(['debug-image'])
        expect(syncStart.details.entriesBefore).toBe(0)
        expect(visibilityEnd.details.changedCount).toBeGreaterThan(0)
        expect(visibilityEnd.details).not.toHaveProperty('entries')
        expect(visibilityEnd.details).not.toHaveProperty('changed')
        expect(dump.entries).toHaveLength(1)
        expect(dump.entries[0]).toMatchObject({
            nodeId: 'debug-image',
            assetId: 'debug-image-asset',
            worldRect: {
                minX: 10,
                minY: 20,
                maxX: 110,
                maxY: 90,
            },
            sprite: expect.objectContaining({
                renderable: true,
            }),
        })
    })

    it('does not decode sourceless generated pending image nodes before tracker setup', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))
        const decoder = await import('$src/infographics/workspace/pixiImageDecoder.ts')
        vi.mocked(decoder.decodeImageInWorker).mockClear()

        layer.sync(makeCanvasState({
            nodes: [
                makeImageNode('pending-image-api', {
                    fileId: '',
                    src: '',
                    generatedBy: {
                        aiChatThreadId: 'thread-1',
                        responseId: '',
                        aiModel: 'Anthropic:claude-sonnet-4-6',
                        revisedPrompt: 'make a mountain',
                        generationRequestId: 'request-1',
                    },
                }),
            ],
        }))

        expect(decoder.decodeImageInWorker).not.toHaveBeenCalled()
        expect(findLatestDebugEvent('ensure-texture-skip-frame-pending').details.nodeId).toBe('pending-image-api')
    })

    it('retries a failed texture only when its Asset changes and stops after the texture loads', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const decoder = await import('$src/infographics/workspace/pixiImageDecoder.ts')
        vi.mocked(decoder.decodeImageInWorker)
            .mockRejectedValueOnce(new Error('Image fetch failed with status 404'))
            .mockResolvedValue({ width: 10, height: 10 } as ImageBitmap)
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        layer.sync(makeCanvasState({
            nodes: [makeImageNode('uploaded-image', { assetId: 'uploaded-image-asset' })],
        }))
        await vi.waitFor(() => expect(decoder.decodeImageInWorker).toHaveBeenCalledTimes(1))

        layer.retryAssetTextures(new Set(['unrelated-asset']))
        await Promise.resolve()
        expect(decoder.decodeImageInWorker).toHaveBeenCalledTimes(1)

        layer.retryAssetTextures(new Set(['uploaded-image-asset']))
        await vi.waitFor(() => expect(decoder.decodeImageInWorker).toHaveBeenCalledTimes(2))

        layer.retryAssetTextures(new Set(['uploaded-image-asset']))
        await Promise.resolve()
        expect(decoder.decodeImageInWorker).toHaveBeenCalledTimes(2)
        expect(errorSpy).toHaveBeenCalledTimes(1)
    })

    it('switches a completed generated image directly from its transient frame to the original rendition', async () => {
        const decoder = await import('$src/infographics/workspace/pixiImageDecoder.ts')
        vi.mocked(decoder.decodeImageInWorker).mockClear()
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const node = makeImageNode('completed-generated-image', {
            assetId: 'final-generated-asset',
            generatedBy: {
                conversationAssetId: 'thread-1',
                generationRequestId: 'request-1',
            },
        })
        layer.setTransientImageSource(node.nodeId, '/api/transient-media/run-1/partial.png')
        layer.sync(makeCanvasState({ nodes: [node] }))
        await vi.waitFor(() => expect(decoder.decodeImageInWorker).toHaveBeenCalledTimes(1))

        layer.setGeneratingImageNodes(new Map([
            [node.nodeId, { shape: 'preFrameCircle', sourceRendition: 'original' }],
        ]))
        layer.setTransientImageSource(node.nodeId, null)

        await vi.waitFor(() => expect(
            vi.mocked(decoder.decodeImageInWorker).mock.calls.some(([url]) =>
                url.includes('/api/assets/final-generated-asset/renditions/original')),
        ).toBe(true))
        const requestedUrls = vi.mocked(decoder.decodeImageInWorker).mock.calls.map(([url]) => url)
        expect(requestedUrls).not.toContainEqual(
            expect.stringContaining('/renditions/thumbnail'),
        )
        expect(requestedUrls).not.toContainEqual(
            expect.stringContaining('/renditions/preview'),
        )
    })

    it('records verbose debug payloads only when the reproduction flag is enabled', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        window.localStorage.setItem('lixpi.debug.pixiMedia', '1')
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        layer.sync(makeCanvasState({ nodes: [makeImageNode('verbose-image')] }))

        const syncStart = findLatestDebugEvent('sync-start')
        const visibilityEnd = findLatestDebugEvent('visibility-pass-end')

        expect(syncStart.details.imageNodes).toEqual([expect.objectContaining({
            nodeId: 'verbose-image',
            sourceKey: 'verbose-image-asset',
        })])
        expect(Array.isArray(syncStart.details.entriesBefore)).toBe(true)
        expect(Array.isArray(visibilityEnd.details.entries)).toBe(true)
        expect(Array.isArray(visibilityEnd.details.changed)).toBe(true)
        expect(debugSpy).toHaveBeenCalled()
    })

    it('dispatches non-image nodes to the registry and removes stale node ids on sync', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const imageNode = makeImageNode('image-1')
        const videoNode = makeNonImageNode('video-1', 'video')
        const docNode = makeNonImageNode('doc-1', 'document')

        layer.sync(makeCanvasState({ nodes: [imageNode, videoNode, docNode] }))

        expect(mediaNodeRegistryCalls.dispatchSync).toHaveBeenCalledTimes(2)
        expect(mediaNodeRegistryCalls.dispatchSync).toHaveBeenCalledWith(videoNode, { x: 5, y: 6 }, expect.objectContaining({ nodes: expect.arrayContaining([imageNode, videoNode, docNode]) }))
        expect(mediaNodeRegistryCalls.dispatchSync).toHaveBeenCalledWith(docNode, { x: 5, y: 6 }, expect.objectContaining({ nodes: expect.arrayContaining([imageNode, videoNode, docNode]) }))

        layer.sync(makeCanvasState({ nodes: [imageNode] }))

        expect(mediaNodeRegistryCalls.dispatchRemove).toHaveBeenCalledTimes(2)
        expect(mediaNodeRegistryCalls.dispatchRemove).toHaveBeenCalledWith('video-1')
        expect(mediaNodeRegistryCalls.dispatchRemove).toHaveBeenCalledWith('doc-1')
    })

    it('destroys removed image display objects during the sync that removes the image node', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        layer.sync(makeCanvasState({ nodes: [makeImageNode('removed-image')] }))

        const sprite = pixiSpriteInstances.find((instance) => instance.label === 'pixi-image-removed-image')
        const mask = pixiGraphicsInstances.find((instance) => instance.label === 'pixi-image-mask-removed-image')
        const colorRect = pixiGraphicsInstances.find((instance) => instance.label === 'pixi-image-color-removed-image')
        expect(sprite).toBeTruthy()
        expect(mask).toBeTruthy()
        expect(colorRect).toBeTruthy()
        expect(sprite?.destroy).not.toHaveBeenCalled()
        expect(mask?.destroy).not.toHaveBeenCalled()
        expect(colorRect?.destroy).not.toHaveBeenCalled()

        layer.sync(makeCanvasState({ nodes: [] }))

        expect(sprite?.destroy).toHaveBeenCalledTimes(1)
        expect(mask?.destroy).toHaveBeenCalledTimes(1)
        expect(colorRect?.destroy).toHaveBeenCalledTimes(1)
    })

    it('clears all PIXI scene content when canvas state is absent during workspace navigation', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const imageNode = makeImageNode('stale-image')
        const videoNode = makeNonImageNode('stale-video', 'video')
        layer.sync(makeCanvasState({ nodes: [imageNode, videoNode] }))
        layer.setGeneratingImageNodes(new Set(['stale-image']))
        layer.setPixiEdges([{ edgeId: 'stale-edge' } as any])
        layer.setMarqueeRect({ x: 1, y: 2, width: 30, height: 40 })
        layer.setSelectionOverlayBounds({ x: 3, y: 4, width: 50, height: 60 })

        const sprite = pixiSpriteInstances.find((instance) => instance.label === 'pixi-image-stale-image')
        const mask = pixiGraphicsInstances.find((instance) => instance.label === 'pixi-image-mask-stale-image')
        const colorRect = pixiGraphicsInstances.find((instance) => instance.label === 'pixi-image-color-stale-image')
        const outlineRenderer = outlineRendererInstances.at(-1)!
        const edgeRenderer = edgeRendererInstances.at(-1)!
        expect(getDebugDump().entries).toHaveLength(1)

        layer.sync(null)

        expect(getDebugDump().entries).toHaveLength(0)
        expect(sprite?.destroy).toHaveBeenCalledTimes(1)
        expect(mask?.destroy).toHaveBeenCalledTimes(1)
        expect(colorRect?.destroy).toHaveBeenCalledTimes(1)
        expect(mediaNodeRegistryCalls.dispatchRemove).toHaveBeenCalledWith('stale-video')
        expect(outlineRenderer.sync.mock.calls.at(-1)?.[0]).toEqual([])
        expect(edgeRenderer.render.mock.calls.at(-1)).toEqual([[], { x: 0, y: 0, zoom: 1 }])
    })

    it('forwards live transforms to registry for non-image nodes', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const videoNode = makeNonImageNode('video-live', 'video')
        layer.sync(makeCanvasState({ nodes: [videoNode] }))

        layer.setNodeLiveTransform('video-live', { x: 50, y: 60 }, { width: 70, height: 80 })

        expect(mediaNodeRegistryCalls.dispatchLiveTransform).toHaveBeenCalledWith('video-live', { x: 50, y: 60 }, { width: 70, height: 80 })
    })

    it('forwards live transforms and outline geometry updates for generating non-image nodes', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const videoNode = makeNonImageNode('video-live-outline', 'video')
        layer.sync(makeCanvasState({ nodes: [videoNode] }))
        layer.setGeneratingImageNodes(new Set(['video-live-outline']))
        mediaNodeRegistryCalls.dispatchLiveTransform.mockReset()
        outlineRendererInstances.at(-1)!.updateGeometry.mockReset()

        layer.setNodeLiveTransform('video-live-outline', { x: 11, y: 22 }, { width: 40, height: 30 })

        expect(mediaNodeRegistryCalls.dispatchLiveTransform).toHaveBeenCalledWith(
            'video-live-outline',
            { x: 11, y: 22 },
            { width: 40, height: 30 },
        )
        expect(outlineRendererInstances.at(-1)!.updateGeometry).toHaveBeenCalledWith('video-live-outline', expect.objectContaining({
            x: 11,
            y: 22,
            width: 40,
            height: 30,
            radius: 8,
        }))
    })

    it('syncs generating-image border geometry from currently flagged nodes', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const imageNode = makeImageNode('gen-1')
        layer.sync(makeCanvasState({ nodes: [imageNode] }))

        layer.setGeneratingImageNodes(new Set(['gen-1']))

        const renderer = outlineRendererInstances.at(-1)
        expect(renderer).toBeTruthy()

        const syncCalls = renderer!.sync.mock.calls
        const lastCall = syncCalls[syncCalls.length - 1] as [{ id: string; x: number; y: number; width: number; height: number; visible: boolean }[]]
        expect(lastCall[0]).toHaveLength(1)
        expect(lastCall[0][0]).toMatchObject({
            id: 'gen-1',
            x: 10,
            y: 20,
            width: 100,
            height: 70,
            visible: true,
        })
    })

    it('converts generating-outline options into pre-frame-circle geometry', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const imageNode = makeImageNode('preframe')
        layer.sync(makeCanvasState({ nodes: [imageNode] }))
        layer.setGeneratingImageNodes(new Map([['preframe', { shape: 'preFrameCircle', direction: 'counterclockwise' }]]))

        const renderer = outlineRendererInstances.at(-1)
        expect(renderer).toBeTruthy()
        const calls = renderer!.sync.mock.calls
        const generated = calls.at(-1)?.[0]?.[0]

        expect(generated).toMatchObject({
            id: 'preframe',
            direction: 'counterclockwise',
            visible: true,
        })
        expect(generated?.width).toBeCloseTo(30.333333333333332)
        expect(generated?.height).toBeCloseTo(30.333333333333332)
        expect(generated?.radius).toBeCloseTo(15.166666666666666)
        expect(generated?.durationMs).toBeGreaterThan(0)
        expect(generated?.snakeLengthFraction).toBeGreaterThan(0)
    })

    it('syncs screen-glass border geometry from the composer and its left and right control rails', async () => {
        const { layer } = createLayerWithScreenGlassTargets()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const glassRenderer = glassBorderRendererInstances.at(-1)
        expect(glassRenderer).toBeTruthy()
        glassRenderer!.sync.mockReset()

        layer.renderNow()

        const syncCall = glassRenderer!.sync.mock.calls.at(-1)
        expect(syncCall).toBeTruthy()
        expect(syncCall?.[1]).toEqual({ width: 900, height: 300 })
        expect(syncCall?.[0]).toEqual([
            {
                id: 'workspace-action-panel-left',
                x: 20,
                y: 240,
                width: 80,
                height: 56,
                radius: 28,
                visible: true,
            },
            {
                id: 'workspace-media-library-panel',
                x: 120,
                y: 248,
                width: 40,
                height: 40,
                radius: 20,
                visible: true,
            },
            {
                id: 'workspace-global-composer',
                x: 180,
                y: 230,
                width: 300,
                height: 64,
                radius: 32,
                visible: true,
            },
            {
                id: 'workspace-right-control-rail',
                x: 500,
                y: 248,
                width: 298,
                height: 40,
                radius: 20,
                visible: true,
            },
        ])
    })

    it('refreshes the glass border after the combined right rail changes width', async () => {
        const { layer, rightControlRail, rightControlRailRect } = createLayerWithScreenGlassTargets()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const glassRenderer = glassBorderRendererInstances.at(-1)!
        layer.renderNow()
        glassRenderer.sync.mockClear()
        rightControlRailRect.width = 420

        notifyScreenGlassTargetResize(rightControlRail)

        expect(glassRenderer.sync).toHaveBeenCalled()
        expect(glassRenderer.sync.mock.calls.at(-1)?.[0]).toContainEqual({
            id: 'workspace-right-control-rail',
            x: 500,
            y: 248,
            width: 420,
            height: 40,
            radius: 20,
            visible: true,
        })
    })

    it('captures the Pixi stage with screen glass hidden, restores it, then renders the final stage', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const glassRenderer = glassBorderRendererInstances.at(-1)!
        const app = pixiApplicationInstances.at(-1)!
        glassCaptureTexture = { label: 'capture-texture' }
        glassRenderer.setCapturing.mockClear()
        glassRenderer.getCaptureTexture.mockClear()
        app.renderer.render.mockClear()
        app.render.mockClear()

        layer.renderNow()

        expect(glassRenderer.getCaptureTexture).toHaveBeenCalled()
        expect(glassRenderer.setCapturing.mock.calls.map((call) => call[0])).toEqual([true, false])
        expect(app.renderer.render).toHaveBeenCalledWith({
            container: app.stage,
            target: glassCaptureTexture,
            clear: true,
            clearColor: [0, 0, 0, 0],
        })
        expect(app.render).toHaveBeenCalledTimes(1)
        expect(glassRenderer.setCapturing.mock.invocationCallOrder[0]).toBeLessThan(app.renderer.render.mock.invocationCallOrder[0])
        expect(app.renderer.render.mock.invocationCallOrder[0]).toBeLessThan(glassRenderer.setCapturing.mock.invocationCallOrder[1])
        expect(glassRenderer.setCapturing.mock.invocationCallOrder[1]).toBeLessThan(app.render.mock.invocationCallOrder[0])
    })

    it('forwards viewport changes to the edge renderer', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const edgeRenderer = edgeRendererInstances.at(-1)
        layer.setViewport({ x: 10, y: -20, zoom: 1.5 })

        expect(edgeRenderer?.render).toHaveBeenCalledWith([], { x: 10, y: -20, zoom: 1.5 })
    })

    it('updates node outlines when dragging generating image nodes', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const imageNode = makeImageNode('dragging')
        layer.sync(makeCanvasState({ nodes: [imageNode] }))
        layer.setGeneratingImageNodes(new Set(['dragging']))
        const renderer = outlineRendererInstances.at(-1)!
        renderer.updateGeometry.mockReset()

        layer.setNodeLiveTransform('dragging', { x: 50, y: 60 }, { width: 80, height: 90 })

        expect(renderer.updateGeometry).toHaveBeenCalledWith('dragging', expect.objectContaining({
            x: 50,
            y: 60,
            width: 80,
            height: 90,
            radius: 8,
        }))
        expect(mediaNodeRegistryCalls.dispatchLiveTransform).not.toHaveBeenCalled()
    })

    it('invokes media-node registry destroy during teardown', async () => {
        const layer = createTestLayer()
        await vi.waitFor(() => expect(layer.getHealth()).toBe('ready'))

        const app = pixiApplicationInstances.at(-1)
        layer.sync(makeCanvasState({ nodes: [makeNonImageNode('video-1', 'video')] }))
        layer.destroy()

        expect(mediaNodeRegistryCalls.destroy).toHaveBeenCalled()
        expect(app?.destroy).toHaveBeenCalledWith(true, { children: true, texture: false, textureSource: false })
        expect(outlineRendererInstances.at(-1)?.destroy).toHaveBeenCalled()
        expect(glassBorderRendererInstances.at(-1)?.destroy).toHaveBeenCalled()
        expect(layer.getHealth()).toBe('destroyed')
        const edgeRenderer = edgeRendererInstances.at(-1)
        expect(edgeRenderer?.destroy).toHaveBeenCalled()
    })
})
