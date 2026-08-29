import {
    Application,
    Container,
    Graphics,
    Sprite,
    Texture,
    type RenderTexture,
} from 'pixi.js'
import RBush from 'rbush'
import type {
    CanvasNode,
    CanvasState,
    ImageCanvasNode,
    CanvasViewport,
} from '@lixpi/constants'

import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { decodeImageInWorker, destroyPixiImageDecoder } from '$src/infographics/workspace/pixiImageDecoder.ts'
import {
    addPixiLodSizeParam,
    buildNodesById,
    buildPixiImageSrc,
    computeWorldPosition,
    getPixiLodTier,
    getVisibleWorldRect,
    isGeneratedImageNodeWaitingForFrame,
    makeIndexedImage,
    resolveStoredImagePath,
    tierRank,
    type IndexedImage,
    type LodTier,
    type PixiEdgeRenderDatum,
    type PixiRendererHealth,
    type WorldPosition,
} from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import { createPixiEdgeRenderer, type PixiEdgeRenderer } from '$src/infographics/workspace/rendering/pixiEdgeRenderer.ts'
import { createMediaNodeRegistry, type MediaNodeRegistry } from '$src/infographics/workspace/rendering/mediaNodeRegistry.ts'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getRoundedOutlinePerimeter,
    PixiGlassBorderRenderer,
    PixiTravelingOutlineRenderer,
    type PixiGlassBorderDatum,
    type PixiTravelingOutlineDatum,
    type PixiTravelingOutlineDirection,
    scaleCanvasChromeWorldSizeForZoom,
} from '@lixpi/canvas-engine'
import { settings } from '$src/settings.ts'

type PixiImageEntry = {
    sprite: Sprite
    spriteMask: Graphics
    colorRect: Graphics
    nodeRef: ImageCanvasNode
    // Stable Asset identity used to invalidate loaded rendition state. When this
    // changes (e.g. user replaces the image), all loaded state is reset.
    sourceKey: string
    // Tier of the texture currently rendered on the sprite. `null` means no
    // texture has been loaded yet — the color placeholder is shown.
    loadedTier: LodTier | null
    // Tier of the in-flight texture request, or `null` when idle.
    requestedTier: LodTier | null
    // A newer source is waiting to replace the currently displayed texture.
    // The old texture remains visible until the replacement has decoded.
    sourceReloadPending: boolean
    // Bumped on every new request so stale completions can be ignored.
    requestId: number
    // URL of the texture currently bound to the sprite, or `null` when none.
    textureKey: string | null
    // Generated placeholders should promote directly to the stored final file.
    // The thumbnail endpoint can briefly expose resize artifacts during this swap.
    forceFullOnNextLoad: boolean
    worldRect: IndexedImage
    isVisible: boolean
    // Last-known geometry used to draw the placeholder colorRect. Compared
    // before each drawColorRect call so we skip the GPU clear+rebuild when
    // the node hasn't moved or resized.
    colorRectW: number
    colorRectH: number
    spriteMaskW: number
    spriteMaskH: number
    spriteMaskRadius: number
}

type TextureEntry = {
    texture: Texture
    bytes: number
    refCount: number
    lastUsed: number
}

type PixiMediaDebugImageSnapshot = {
    nodeId: string
    assetId: string
    src: string
    sourceKey: string
    loadedTier: LodTier | null
    requestedTier: LodTier | null
    sourceReloadPending: boolean
    requestId: number
    textureKey: string | null
    isVisible: boolean
    worldRect: IndexedImage
    nodeDimensions: { width: number; height: number }
    sprite: {
        renderable: boolean
        visible: boolean
        x: number
        y: number
        width: number
        height: number
        textureWidth: number
        textureHeight: number
    }
    colorRect: {
        renderable: boolean
        visible: boolean
        x: number
        y: number
    }
}

type PixiMediaDebugEvent = {
    t: number
    event: string
    workspaceId: string
    health: PixiRendererHealth
    destroyed: boolean
    viewport: CanvasViewport
    pane: {
        clientWidth: number
        clientHeight: number
        rectWidth: number
        rectHeight: number
    }
    cache: {
        textures: number
        bytes: number
        requestCounter: number
    }
    details: Record<string, unknown>
}

type PixiGpuBufferDestroyEvent = {
    t: number
    stack: string | undefined
    // True when this call queued a native GPUBuffer.destroy for a later frame.
    // False means the same GPUBuffer was already queued and this call only
    // records another stack that tried to destroy it.
    deferred: boolean
    queueLength: number
}

type PixiMediaDebugDump = {
    t: number
    workspaceId: string
    health: PixiRendererHealth
    destroyed: boolean
    viewport: CanvasViewport
    pane: PixiMediaDebugEvent['pane']
    cache: PixiMediaDebugEvent['cache']
    entries: PixiMediaDebugImageSnapshot[]
    events: PixiMediaDebugEvent[]
    gpuBufferDestroys: PixiGpuBufferDestroyEvent[]
}

type PixiMediaDebugDetails = Record<string, unknown> | ((verbose: boolean) => Record<string, unknown>)

type PixiMediaDebugWindow = typeof window & {
    // Set to true, or set localStorage `lixpi.debug.pixiMedia` to `1`, for
    // verbose event payloads and console streaming. The dump exists regardless.
    __lixpiPixiMediaDebug?: boolean
    // Set to true, or set localStorage `lixpi.debug.pixiMediaEvents` to `1`, to
    // record the in-memory event log without console streaming. Collection is
    // off by default because recording an event forces a layout.
    __lixpiPixiMediaDebugCollect?: boolean
    __lixpiPixiMediaDebugEvents?: PixiMediaDebugEvent[]
    __lixpiGpuBufferDestroyDebugInstalled?: boolean
    __lixpiGpuBufferDestroyDebugVersion?: number
    __lixpiGpuBufferDestroyEvents?: PixiGpuBufferDestroyEvent[]
    __lixpiGpuBufferDestroyOriginal?: (this: unknown) => void
    __lixpiGpuBufferDestroyQueue?: DeferredGpuBufferDestroy[]
    __lixpiGpuBufferDestroyQueued?: WeakSet<object>
    __lixpiGpuBufferDestroyRaf?: number | null
    __lixpiPixiMediaDebugDump?: () => PixiMediaDebugDump
}

type DeferredGpuBufferDestroy = {
    buffer: object
    framesRemaining: number
}

export type SelectionColors = {
    marqueeStroke: string
    marqueeFill: string
    groupOverlayStroke: string
    groupOverlayFill: string
}

export type GeneratingMediaOutlineDirection = PixiTravelingOutlineDirection

export type GeneratingMediaOutlineOptions = {
    direction?: GeneratingMediaOutlineDirection
    shape?: 'node' | 'preFrameCircle'
    sourceRendition?: 'original'
}

type SelectionOverlayOptions = {
    fill?: boolean
}

export type GeneratingMediaOutlineTarget = GeneratingMediaOutlineDirection | GeneratingMediaOutlineOptions | undefined
export type GeneratingMediaOutlineTargets = Set<string> | Map<string, GeneratingMediaOutlineTarget>

export type PixiMediaLayer = {
    // Reconciles canvas state into Pixi image/video/display objects.
    sync: (canvasState: CanvasState | null) => void
    // Retries unresolved image textures after their Asset record changes.
    retryAssetTextures: (assetIds: ReadonlySet<string>) => void
    // Updates animated generation/reference outlines for image-like media nodes.
    setGeneratingImageNodes: (nodeTargets: GeneratingMediaOutlineTargets) => void
    // Uses a run-scoped media reference while a generated Asset is still unsettled.
    setTransientImageSource: (nodeId: string, sourceUrl: string | null) => void
    // Applies the current pan/zoom transform and schedules culling/prefetch.
    setViewport: (viewport: CanvasViewport) => void
    // Applies drag/resize geometry before persisted canvas state catches up.
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ) => void
    // Shows or hides selected image outlines.
    setSelectedImageNodes: (selectedNodeIds: Set<string>) => void
    // Draws the drag-selection marquee in world coordinates.
    setMarqueeRect: (worldRect: { x: number; y: number; width: number; height: number } | null) => void
    // Draws the multi-selection group bounds overlay in world coordinates.
    setSelectionOverlayBounds: (worldBounds: { x: number; y: number; width: number; height: number } | null, options?: SelectionOverlayOptions) => void
    // Sends connector edge geometry to the Pixi edge layer.
    setPixiEdges: (edges: PixiEdgeRenderDatum[]) => void
    // Forces an immediate Pixi render when callers need a synchronous paint.
    renderNow: () => void
    // Reports whether Pixi initialization/rendering is ready, failed, or gone.
    getHealth: () => PixiRendererHealth
    // Exposes non-image media handlers for integration code that owns video DOM.
    getMediaNodeRegistry?: () => MediaNodeRegistry
    // Exposes the Pixi video layer so video handlers can align poster geometry.
    getVideoLayer?: () => Container
    // Requests a coalesced render on the next animation frame.
    scheduleRender?: () => void
    // Tears down Pixi resources and removes the media-layer host.
    destroy: () => void
}

type PixiMediaLayerOptions = {
    // Pane that owns the Pixi host and defines renderer resize bounds.
    paneEl: HTMLDivElement
    // DOM viewport element used as the insertion anchor for the Pixi host.
    viewportEl: HTMLDivElement
    // Late-bound workspace id so debug dumps and image URLs match workspace switches.
    getWorkspaceId: () => string
    // Selection colors are supplied by the canvas host theme/settings.
    selectionColors: SelectionColors
    // Reports natural image size corrections back to canvas state.
    onImageIntrinsicSize?: (size: {
        nodeId: string
        width: number
        height: number
        preserveNodeGeometry?: boolean
    }) => void
    // Lets the view host react to Pixi health transitions.
    onHealthChange?: (health: PixiRendererHealth) => void
}

// Margin in *world* coordinates beyond the viewport rect. Sprites whose
// bounding box intersects this expanded rect are considered visible (and
// therefore eligible for texture loading). Larger values trade memory for
// pan smoothness — a sprite that just scrolled into view still has its
// texture ready, no progressive flash.
const VISIBILITY_MARGIN = 1200

// Idle-time prefetch margin: how far past the visibility margin we
// pre-load thumb-256 textures during idle frames. This makes pan around
// the canvas instant after the first idle slot.
const PREFETCH_MARGIN = 4000

// Cache limits. The PIXI v8 architecture is mipmap-aware so a single
// well-cached `full` texture serves *all* zoom levels for that sprite.
// We therefore cache aggressively: 2k textures @ ~768MB worst case.
const MAX_TEXTURES = 2000
const MAX_TEXTURE_BYTES = 768 * 1024 * 1024
const PIXI_MEDIA_DEBUG_BUFFER_LIMIT = 2500
const PIXI_GPU_BUFFER_DESTROY_DEFER_FRAMES = 4
const PIXI_GPU_BUFFER_DESTROY_DEBUG_VERSION = 2

// Resolved screen-fixed chrome element whose glass border is drawn by the
// media layer, cached with its last measured corner radius.
type ScreenGlassBorderTarget = {
    id: string
    element: HTMLElement
    radiusKey: string
    radius: number
}

// Schedule a low-priority callback. requestIdleCallback is the right tool;
// fall back to setTimeout on browsers that lack it (Safari before ~16.4).
const scheduleIdle: (cb: () => void, timeout?: number) => void = (() => {
    if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        return (cb, timeout = 1500) => {
            ;(window as any).requestIdleCallback(cb, { timeout })
        }
    }
    return (cb, timeout = 250) => {
        window.setTimeout(cb, Math.min(timeout, 250))
    }
})()

// Single shared token promise. Re-used by all concurrent `resolveImageSrc`
// calls in a given tick so 200 in-flight image loads don't each invoke
// `getTokenSilently` independently — one auth round-trip serves all of them.
// Cleared after 30 s so the next batch always gets a fresh token.
let tokenPromise: Promise<string | false> | null = null
let tokenPromiseTimer: ReturnType<typeof setTimeout> | null = null

function getSharedToken(): Promise<string | false> {
    if (!tokenPromise) {
        tokenPromise = AuthService.getTokenSilently().catch(() => false as const)
        if (tokenPromiseTimer !== null) clearTimeout(tokenPromiseTimer)
        tokenPromiseTimer = setTimeout(() => {
            tokenPromise = null
            tokenPromiseTimer = null
        }, 30000)
    }
    return tokenPromise
}

async function resolveImageSrc(node: ImageCanvasNode, workspaceId: string, storedImagePath?: string): Promise<string> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
    const resolvedSrc = storedImagePath ?? resolveStoredImagePath(node, workspaceId)
    const token = await getSharedToken()
    return buildPixiImageSrc(resolvedSrc, API_BASE_URL, token)
}

export function createPixiMediaLayer(options: PixiMediaLayerOptions): PixiMediaLayer {
    const { paneEl, viewportEl, getWorkspaceId, selectionColors, onImageIntrinsicSize, onHealthChange } = options
    const transientImageSources = new Map<string, string>()

    const hostStyle = {
        position: 'absolute' as const,
        inset: '0',
        pointerEvents: 'none' as const,
        zIndex: '2',
        overflow: 'hidden',
    }
    const hostEl = html`<div className="workspace-pixi-media-layer" style=${hostStyle}></div>` as HTMLDivElement
    paneEl.insertBefore(hostEl, viewportEl)

    const app = new Application()
    const world = new Container({ label: 'workspace-pixi-media-world' })
    const imageLayer = new Container({ label: 'workspace-pixi-images' })
    // Non-image media (video for now; audio later) lives in a sibling layer so
    // image-only sync, texture-cache, and LoD logic stay untouched. Handlers
    // are dispatched here through mediaNodeRegistry — pixiMediaLayer doesn't
    // own video texture lifecycle directly.
    const videoLayer = new Container({ label: 'workspace-pixi-videos' })
    const generatingBorderLayer = new Container({ label: 'workspace-pixi-generating-borders' })
    const fgLayer = new Container({ label: 'workspace-pixi-fg' })
    const edgeLayer = new Container({ label: 'workspace-pixi-edges' })
    // Screen-fixed glass sits in the Pixi stage, not in CSS. It is above the
    // world/edge/foreground layers so it can refract those pixels, but below the
    // DOM composer/buttons that remain normal interactive controls.
    const screenGlassLayer = new Container({ label: 'workspace-pixi-screen-glass' })
    const mediaNodeRegistry: MediaNodeRegistry = createMediaNodeRegistry()
    // Tracks which non-image nodes the registry currently owns so sync() can
    // detect removal (when a node leaves canvasState we dispatch remove).
    let registryDispatchedNodes: Set<string> = new Set()
    const entries = new Map<string, PixiImageEntry>()
    let generatingImageNodeOutlines = new Map<string, GeneratingMediaOutlineOptions>()
    let edgeRenderer: PixiEdgeRenderer | null = null
    const textureCache = new Map<string, TextureEntry>()
    const spatialIndex = new RBush<IndexedImage>()
    let textureBytes = 0
    let textureClock = 0
    let destroyed = false
    let health: PixiRendererHealth = 'initializing'
    let marqueeGraphics: Graphics | null = null
    let groupOverlayGraphics: Graphics | null = null
    let lastState: CanvasState | null = null
    let requestCounter = 0
    let currentViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
    let currentTier: LodTier = getPixiLodTier(currentViewport.zoom)
    let latestPixiEdges: PixiEdgeRenderDatum[] = []
    let renderRaf: number | null = null
    let visibilityRaf: number | null = null
    let prefetchScheduled = false
    let screenGlassBorderTargets: ScreenGlassBorderTarget[] | null = null
    const observedScreenGlassBorderElements = new Set<HTMLElement>()
    const screenGlassBorderResizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => scheduleRender())
        : null
    let screenGlassBorderRects: PixiGlassBorderDatum[] = []
    let stageCaptureDirty = true
    let lastCaptureTexture: RenderTexture | null = null
    let lastCaptureKey = ''
    // Debug event collection is opt-in and read once. Every collected event
    // reads the pane rect, snapshots cache state, and allocates a record, so
    // leaving collection on made the per-frame render path force a layout
    // several times per animation frame. Set `lixpi.debug.pixiMedia` in
    // localStorage (or `window.__lixpiPixiMediaDebug`) before load to enable.
    const debugCollectionEnabled = isPixiMediaDebugCollectionEnabled()
    const inProgressOutlineAnimation = settings.mediaNode.inProgressOutlineAnimation
    const inProgressOutlineAnimationStyles = inProgressOutlineAnimation.styles
    const inProgressOutlineZoomScaling = getAdaptiveBoundedZoomScalingOptions(inProgressOutlineAnimation.zoomScaling ?? { minZoom: 0.4 })
    const generatingBorderRenderer = new PixiTravelingOutlineRenderer({
        container: generatingBorderLayer,
        style: {
            radius: inProgressOutlineAnimation.radius,
            gap: inProgressOutlineAnimation.gap ?? 0,
            snakeHeadWidth: inProgressOutlineAnimation.snakeWidth,
            snakeTailWidthFraction: inProgressOutlineAnimation.snakeTailWidthFraction ?? 0.18,
            snakeTailThinLengthFraction: inProgressOutlineAnimation.snakeTailThinLengthFraction,
            snakeWidthTaperPower: inProgressOutlineAnimation.snakeWidthTaperPower,
            snakeLengthFraction: inProgressOutlineAnimation.snakeLengthFraction,
            snakeHeadRoundLengthFraction: inProgressOutlineAnimation.snakeHeadRoundLengthFraction,
            snakeTailAlpha: inProgressOutlineAnimationStyles.snakeTailAlpha,
            snakeColors: inProgressOutlineAnimationStyles.snakeColors,
            glassMaterial: inProgressOutlineAnimationStyles.glassMaterial,
            durationMs: inProgressOutlineAnimation.animationDurationMs,
        },
        getStrokeScale: () => scaleCanvasChromeWorldSizeForZoom(1, currentViewport.zoom, inProgressOutlineZoomScaling),
        onFrame: scheduleAnimationRender,
    })
    const glassBorderRenderer = new PixiGlassBorderRenderer({
        container: screenGlassLayer,
        style: settings.canvasChrome.glassBorder,
    })

    function setHealth(next: PixiRendererHealth): void {
        if (health === next) return
        health = next
        onHealthChange?.(next)
        debugLog('health-change', { next })
    }

    // Keep debug collection installed in normal builds. The dump is cheap when
    // nobody calls it, and it gives reproducible state when flaky canvas issues
    // happen outside a debugger session.
    installDebugDump()
    installGpuBufferDestroyDebug()
    debugLog('layer-created', {
        pane: getDebugPaneSnapshot(),
        initialViewport: currentViewport,
    })

    // Reads the browser global through a typed boundary. Keeping this isolated
    // avoids leaking debug-only window fields into renderer logic.
    function getDebugHost(): PixiMediaDebugWindow | null {
        if (typeof window === 'undefined') return null
        return window as PixiMediaDebugWindow
    }

    // Captures both layout APIs because disappearing-media bugs often involve a
    // stale zero-sized pane during panel open/close or resize.
    function getDebugPaneSnapshot(): PixiMediaDebugEvent['pane'] {
        const rect = paneEl.getBoundingClientRect()
        return {
            clientWidth: paneEl.clientWidth,
            clientHeight: paneEl.clientHeight,
            rectWidth: rect.width,
            rectHeight: rect.height,
        }
    }

    // Debug events may include signed object-store URLs. Strip auth tokens and
    // shorten data URLs so dumps are safe enough to paste into an issue/thread.
    function cleanDebugUrl(value: string | null | undefined): string {
        if (!value) return ''
        if (value.startsWith('data:')) return `${value.slice(0, 32)}...len=${value.length}`
        return value.replace(/[?&]token=[^&]+/, '')
    }

    // Texture-cache summary used in every event. It keeps dumps small while
    // still showing whether disappearing images are cache pressure, request
    // churn, or renderer visibility state.
    function getDebugCacheSnapshot(): PixiMediaDebugEvent['cache'] {
        return {
            textures: textureCache.size,
            bytes: textureBytes,
            requestCounter,
        }
    }

    // Per-image state snapshot. This is the main diagnostic payload for blank
    // media cards: it separates app state, PIXI sprite state, culling state,
    // texture request state, and placeholder visibility.
    function getDebugEntrySnapshot(entry: PixiImageEntry): PixiMediaDebugImageSnapshot {
        return {
            nodeId: entry.nodeRef.nodeId,
            assetId: entry.nodeRef.assetId,
            src: cleanDebugUrl(resolveStoredImagePath(entry.nodeRef, getWorkspaceId())),
            sourceKey: cleanDebugUrl(entry.sourceKey),
            loadedTier: entry.loadedTier,
            requestedTier: entry.requestedTier,
            sourceReloadPending: entry.sourceReloadPending,
            requestId: entry.requestId,
            textureKey: cleanDebugUrl(entry.textureKey),
            isVisible: entry.isVisible,
            worldRect: { ...entry.worldRect },
            nodeDimensions: { ...entry.nodeRef.dimensions },
            sprite: {
                renderable: entry.sprite.renderable,
                visible: entry.sprite.visible,
                x: entry.sprite.x,
                y: entry.sprite.y,
                width: entry.sprite.width,
                height: entry.sprite.height,
                textureWidth: entry.sprite.texture.width,
                textureHeight: entry.sprite.texture.height,
            },
            colorRect: {
                renderable: entry.colorRect.renderable,
                visible: entry.colorRect.visible,
                x: entry.colorRect.x,
                y: entry.colorRect.y,
            },
        }
    }

    // Compact entry state for always-on event records. The full dump still
    // captures every geometry field on demand, but normal canvas work should not
    // pay for large per-entry forensic snapshots.
    function getDebugEntrySummary(entry: PixiImageEntry): Record<string, unknown> {
        return {
            nodeId: entry.nodeRef.nodeId,
            assetId: entry.nodeRef.assetId,
            loadedTier: entry.loadedTier,
            requestedTier: entry.requestedTier,
            sourceReloadPending: entry.sourceReloadPending,
            requestId: entry.requestId,
            textureKey: cleanDebugUrl(entry.textureKey),
            isVisible: entry.isVisible,
            spriteRenderable: entry.sprite.renderable,
            spriteVisible: entry.sprite.visible,
            colorRectRenderable: entry.colorRect.renderable,
            colorRectVisible: entry.colorRect.visible,
        }
    }

    function isFinalGeneratedImageNode(node: ImageCanvasNode): boolean {
        return Boolean(node.generatedBy && node.assetId)
    }

    function logFinalGeneratedImageLifecycle(event: string, details: Record<string, unknown>): void {
        const host = getDebugHost()
        if (!host || !isVerboseDebugEnabled(host)) return
        console.debug('[CANVAS][pixi-media]', event, details)
    }

    // Snapshot all live image entries at the moment of the dump. The dump avoids
    // retaining entry references so pasted output cannot mutate after capture.
    function getDebugEntrySnapshots(): PixiMediaDebugImageSnapshot[] {
        return Array.from(entries.values()).map((entry) => getDebugEntrySnapshot(entry))
    }

    // Exposes `window.__lixpiPixiMediaDebugDump()`. Use it after a canvas
    // rendering failure, before reloading, to capture entries/cache/events and
    // WebGPU buffer destroy stacks in one serializable object.
    function installDebugDump(): void {
        const host = getDebugHost()
        if (!host) return
        host.__lixpiPixiMediaDebugEvents ??= []
        host.__lixpiPixiMediaDebugDump = () => ({
            t: Date.now(),
            workspaceId: getWorkspaceId(),
            health,
            destroyed,
            viewport: { ...currentViewport },
            pane: getDebugPaneSnapshot(),
            cache: getDebugCacheSnapshot(),
            entries: getDebugEntrySnapshots(),
            events: [...(host.__lixpiPixiMediaDebugEvents ?? [])],
            gpuBufferDestroys: [...(host.__lixpiGpuBufferDestroyEvents ?? [])],
        })
    }

    // WebGPU validation fails if a GPUBuffer is destroyed while a command
    // buffer submitted earlier in the same render turn still references it.
    // Pixi can resize/unload internal buffers during normal Graphics/batcher
    // work, so this wrapper records the stack and delays the native destroy a
    // few rAFs. This preserves WebGPU and avoids downgrading to WebGL.
    function installGpuBufferDestroyDebug(): void {
        const host = getDebugHost()
        const gpuBufferPrototype = (host as unknown as { GPUBuffer?: { prototype?: { destroy?: () => void } } } | null)
            ?.GPUBuffer
            ?.prototype
        if (!host || !gpuBufferPrototype?.destroy) return
        if (
            host.__lixpiGpuBufferDestroyDebugInstalled
            && host.__lixpiGpuBufferDestroyDebugVersion === PIXI_GPU_BUFFER_DESTROY_DEBUG_VERSION
        ) {
            return
        }
        const originalDestroy = gpuBufferPrototype.destroy
        host.__lixpiGpuBufferDestroyOriginal = originalDestroy
        host.__lixpiGpuBufferDestroyQueue = []
        host.__lixpiGpuBufferDestroyQueued = new WeakSet<object>()
        host.__lixpiGpuBufferDestroyRaf = null
        host.__lixpiGpuBufferDestroyEvents ??= []
        host.__lixpiGpuBufferDestroyDebugInstalled = true
        host.__lixpiGpuBufferDestroyDebugVersion = PIXI_GPU_BUFFER_DESTROY_DEBUG_VERSION
        gpuBufferPrototype.destroy = function destroyWithDebug(this: unknown): void {
            if (typeof this !== 'object' || this === null) {
                originalDestroy.call(this)
                return
            }
            const buffer = this
            host.__lixpiGpuBufferDestroyQueue ??= []
            host.__lixpiGpuBufferDestroyQueued ??= new WeakSet<object>()
            const queue = host.__lixpiGpuBufferDestroyQueue
            const queued = host.__lixpiGpuBufferDestroyQueued
            const alreadyQueued = queued.has(buffer)
            if (!alreadyQueued) {
                queued.add(buffer)
                queue.push({
                    buffer,
                    framesRemaining: PIXI_GPU_BUFFER_DESTROY_DEFER_FRAMES,
                })
            }
            // Capturing a stack per destroy is the single most expensive part of
            // this wrapper and Pixi destroys buffers constantly, so the event log
            // is gated. The deferral itself is functional and always runs.
            if (debugCollectionEnabled) {
                host.__lixpiGpuBufferDestroyEvents ??= []
                host.__lixpiGpuBufferDestroyEvents.push({
                    t: typeof performance === 'undefined' ? Date.now() : performance.now(),
                    stack: new Error().stack,
                    deferred: !alreadyQueued,
                    queueLength: queue.length,
                })
                while (host.__lixpiGpuBufferDestroyEvents.length > PIXI_MEDIA_DEBUG_BUFFER_LIMIT) {
                    host.__lixpiGpuBufferDestroyEvents.shift()
                }
            }
            scheduleDeferredGpuBufferDestroys(host)
        }
    }

    // Starts the one global drain loop for deferred native GPUBuffer.destroy().
    // A single loop avoids scheduling one rAF per buffer when Pixi resizes many
    // batch resources in the same frame.
    function scheduleDeferredGpuBufferDestroys(host: PixiMediaDebugWindow): void {
        if (host.__lixpiGpuBufferDestroyRaf !== null && host.__lixpiGpuBufferDestroyRaf !== undefined) return
        host.__lixpiGpuBufferDestroyRaf = requestAnimationFrame(() => runDeferredGpuBufferDestroys(host))
    }

    // Drains queued native GPUBuffer.destroy calls only after enough frames have
    // passed for the browser to retire the submitted command buffers that may
    // still reference the old Pixi buffer.
    function runDeferredGpuBufferDestroys(host: PixiMediaDebugWindow): void {
        host.__lixpiGpuBufferDestroyRaf = null
        const originalDestroy = host.__lixpiGpuBufferDestroyOriginal
        const queue = host.__lixpiGpuBufferDestroyQueue
        const queued = host.__lixpiGpuBufferDestroyQueued
        if (!originalDestroy || !queue || !queued) return
        for (let index = queue.length - 1; index >= 0; index--) {
            const item = queue[index]
            item.framesRemaining -= 1
            if (item.framesRemaining > 0) continue
            queue.splice(index, 1)
            queued.delete(item.buffer)
            originalDestroy.call(item.buffer)
        }
        if (queue.length > 0) scheduleDeferredGpuBufferDestroys(host)
    }

    // Pixi's shared GC can call Buffer.unload() during renderer postrender.
    // This canvas owns a bounded texture cache and explicit disposal path, so
    // automatic GPU-resource GC adds the exact class of mid-submit destroys
    // that blanked image sprites.
    function disablePixiRendererResourceGc(): void {
        const renderer = app.renderer as typeof app.renderer & {
            gc?: { enabled: boolean; maxUnusedTime?: number }
        }
        const gcWasEnabled = renderer.gc?.enabled
        if (renderer.gc) renderer.gc.enabled = false
        debugLog('renderer-resource-gc-disabled', {
            gcWasEnabled,
            gcEnabled: renderer.gc?.enabled,
        })
    }

    // Resolved once at layer creation so the hot path never touches
    // localStorage. Verbose logging implies collection; the separate collect
    // flag turns the in-memory event log on without console spam. Enabling
    // either requires a page reload.
    function isPixiMediaDebugCollectionEnabled(): boolean {
        const host = getDebugHost()
        if (!host) return false
        if (isVerboseDebugEnabled(host)) return true
        try {
            return host.__lixpiPixiMediaDebugCollect === true
                || window.localStorage.getItem('lixpi.debug.pixiMediaEvents') === '1'
        } catch {
            return host.__lixpiPixiMediaDebugCollect === true
        }
    }

    // Runtime switch for verbose event payloads and console streaming. The dump
    // is always installed; this flag only turns on expensive live forensics.
    function isVerboseDebugEnabled(host: PixiMediaDebugWindow): boolean {
        try {
            return host.__lixpiPixiMediaDebug === true || window.localStorage.getItem('lixpi.debug.pixiMedia') === '1'
        } catch {
            return host.__lixpiPixiMediaDebug === true
        }
    }

    function shouldBuildVerboseDebugPayloads(): boolean {
        const host = getDebugHost()
        return host ? isVerboseDebugEnabled(host) : false
    }

    // Appends one bounded event record. The ring buffer prevents a long canvas
    // session from retaining unbounded debug state while still preserving the
    // recent path into a failure.
    function debugLog(event: string, details: PixiMediaDebugDetails = {}): void {
        if (!debugCollectionEnabled) return
        const host = getDebugHost()
        if (!host) return
        host.__lixpiPixiMediaDebugEvents ??= []
        const verbose = isVerboseDebugEnabled(host)
        const resolvedDetails = typeof details === 'function' ? details(verbose) : details
        const record: PixiMediaDebugEvent = {
            t: typeof performance === 'undefined' ? Date.now() : performance.now(),
            event,
            workspaceId: getWorkspaceId(),
            health,
            destroyed,
            viewport: { ...currentViewport },
            pane: getDebugPaneSnapshot(),
            cache: getDebugCacheSnapshot(),
            details: resolvedDetails,
        }
        host.__lixpiPixiMediaDebugEvents.push(record)
        while (host.__lixpiPixiMediaDebugEvents.length > PIXI_MEDIA_DEBUG_BUFFER_LIMIT) {
            host.__lixpiPixiMediaDebugEvents.shift()
        }
        if (verbose) console.debug('[PixiMediaLayer]', event, record)
    }

    // CanvasState persisted by older code paths may not carry a viewport field.
    // Falling back to the current viewport keeps sync compatible with both
    // shapes without adding migration logic to the renderer.
    function getCanvasStateViewport(canvasState: CanvasState): CanvasViewport {
        return (canvasState as CanvasState & { viewport?: CanvasViewport }).viewport ?? currentViewport
    }

    void (async () => {
        try {
            debugLog('app-init-start', {
                preference: 'webgpu',
                gcActive: false,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
            })
            const pixiInitOptions = {
                preference: 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                resizeTo: paneEl,
                gcActive: false,
                // We render on demand via `scheduleRender`. Letting PIXI's
                // ticker run autoStart at 60fps wastes CPU/GPU on every frame
                // even when the canvas is idle, and also doubles the work
                // when call sites also invoke `app.render()` synchronously.
                autoStart: false,
                sharedTicker: false,
                webgpu: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
                webgl: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
            } as const
            await app.init(pixiInitOptions)
            installGpuBufferDestroyDebug()

            // Keep the ticker stopped so it never auto-renders behind our backs.
            app.ticker.stop()
            disablePixiRendererResourceGc()

            if (destroyed) {
                debugLog('app-init-destroyed-before-ready')
                app.destroy(true, { children: true, texture: true, textureSource: true })
                return
            }

            app.stage.addChild(edgeLayer)
            app.stage.addChild(world)
            app.stage.addChild(screenGlassLayer)
            world.addChild(imageLayer)
            world.addChild(videoLayer)
            world.addChild(generatingBorderLayer)
            world.addChild(fgLayer)
            edgeRenderer = createPixiEdgeRenderer(edgeLayer)
            edgeRenderer.render(latestPixiEdges, currentViewport)
            hostEl.appendChild(app.canvas)
            // Only position the canvas — DO NOT set width/height explicitly.
            // `autoDensity: true` + `resizeTo: paneEl` own the canvas pixel
            // buffer and CSS display size. Overriding them with percentage values
            // conflicts with PIXI's ResizeObserver and creates an inconsistent
            // aspect ratio after pane-size changes (e.g. sidebar opening).
            applyStyle(app.canvas as HTMLCanvasElement, {
                position: 'absolute',
                inset: '0',
            })
            world.position.set(currentViewport.x, currentViewport.y)
            world.scale.set(currentViewport.zoom, currentViewport.zoom)
            setHealth('ready')
            debugLog('app-init-ready', {
                canvasWidth: app.canvas.width,
                canvasHeight: app.canvas.height,
                pane: getDebugPaneSnapshot(),
            })
            sync(lastState)
            scheduleRender()
        } catch (error) {
            debugLog('app-init-error', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
            console.error('[PixiMediaLayer] Failed to initialize PIXI media layer.', error)
            throw error
        }
    })()

    function setViewport(viewport: CanvasViewport): void {
        if (destroyed) return
        const previousViewport = currentViewport
        currentViewport = viewport
        // Tier is recomputed on every viewport change so newly visible
        // sprites get the right tier on demand. Sprites that already have a
        // higher-or-equal tier loaded are NEVER re-fetched (mipmaps in the
        // PIXI texture handle GPU-side downsampling for free).
        currentTier = getPixiLodTier(viewport.zoom)
        world.position.set(viewport.x, viewport.y)
        world.scale.set(viewport.zoom, viewport.zoom)
        edgeRenderer?.render(latestPixiEdges, viewport)
        debugLog('set-viewport', {
            previousViewport,
            nextViewport: viewport,
            tier: currentTier,
            entries: entries.size,
        })
        // Visibility update is rAF-coalesced so a 60Hz wheel-zoom doesn't
        // run the spatial-index scan + per-entry iteration 60 times per
        // second — once per frame is enough.
        scheduleVisibilityUpdate()
        schedulePrefetch()
        scheduleRender()
    }

    function scheduleVisibilityUpdate(): void {
        if (destroyed) {
            debugLog('visibility-schedule-skipped', { reason: 'destroyed' })
            return
        }
        if (visibilityRaf !== null) {
            debugLog('visibility-schedule-skipped', { reason: 'already-scheduled' })
            return
        }
        debugLog('visibility-scheduled')
        visibilityRaf = requestAnimationFrame(() => {
            visibilityRaf = null
            if (destroyed) return
            updateVisibleImages()
        })
    }

    function sync(canvasState: CanvasState | null): void {
        lastState = canvasState
        if (!canvasState) {
            clearPixiScene()
            return
        }

        if (health !== 'ready' || destroyed) {
            debugLog('sync-skipped', {
                hasCanvasState: true,
                health,
                destroyed,
            })
            return
        }

        // On workspace switch the external setViewport call arrives after sync.
        // Apply the state's viewport directly so culling and world transform are
        // correct before any sprites are positioned or made renderable.
        const vp = getCanvasStateViewport(canvasState)
        if (vp.x !== currentViewport.x || vp.y !== currentViewport.y || vp.zoom !== currentViewport.zoom) {
            currentViewport = vp
            currentTier = getPixiLodTier(vp.zoom)
            world.position.set(vp.x, vp.y)
            world.scale.set(vp.zoom, vp.zoom)
            edgeRenderer?.render(latestPixiEdges, vp)
        }

        const imageNodes = canvasState.nodes.filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
        const activeIds = new Set<string>(imageNodes.map((node: ImageCanvasNode) => node.nodeId))
        debugLog('sync-start', (verbose) => ({
            nodeCount: canvasState.nodes.length,
            imageCount: imageNodes.length,
            nonImageCount: canvasState.nodes.length - imageNodes.length,
            canvasViewport: vp,
            entryCount: entries.size,
            imageNodes: verbose
                ? imageNodes.map((node) => ({
                    nodeId: node.nodeId,
                    assetId: node.assetId,
                    src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
                    dimensions: node.dimensions,
                    position: node.position,
                    sourceKey: makeSourceKey(node),
                }))
                : imageNodes.map((node) => node.nodeId),
            entriesBefore: verbose ? getDebugEntrySnapshots() : entries.size,
        }))

        for (const [nodeId, entry] of entries) {
            if (!activeIds.has(nodeId)) {
                debugLog('entry-remove', (verbose) => ({
                    nodeId,
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                entry.requestId++
                entry.requestedTier = null
                entry.loadedTier = null
                releaseTexture(entry.textureKey)
                // Remove from spatial index before destroying the entry.
                spatialIndex.remove(entry.worldRect, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
                imageLayer.removeChild(entry.sprite)
                imageLayer.removeChild(entry.spriteMask)
                imageLayer.removeChild(entry.colorRect)
                entry.sprite.mask = null
                entry.sprite.renderable = false
                entry.spriteMask.renderable = false
                entry.colorRect.renderable = false
                entry.sprite.destroy()
                entry.spriteMask.destroy()
                entry.colorRect.destroy()
                entries.delete(nodeId)
                transientImageSources.delete(nodeId)
            }
        }

        upsertAllEntries(canvasState)
        syncGeneratingImageBorders()
        // Dispatch non-image media nodes (video for now) through the registry.
        // Image LoD/texture-cache/visibility logic above is intentionally not
        // shared — image-specific perf invariants stay scoped to image entries.
        dispatchNonImageMediaNodes(canvasState)
        // Single visibility pass loads textures for visible entries only.
        updateVisibleImages()
        schedulePrefetch()
        scheduleRender()
        debugLog('sync-end', (verbose) => ({
            entriesAfter: verbose ? getDebugEntrySnapshots() : entries.size,
            registryDispatchedNodes: [...registryDispatchedNodes],
        }))
    }

    function retryAssetTextures(assetIds: ReadonlySet<string>): void {
        if (destroyed || health !== 'ready' || assetIds.size === 0) return

        let shouldRetryVisibleImages = false
        for (const entry of entries.values()) {
            if (!assetIds.has(entry.nodeRef.assetId) || entry.textureKey !== null) continue

            // Invalidate an in-flight request as well as a settled failure. An
            // Asset event can race the 404 response from a not-yet-ready
            // preview; the replacement request must resolve its source again
            // against the new rendition state.
            entry.requestId++
            entry.requestedTier = null
            shouldRetryVisibleImages = true
        }

        if (!shouldRetryVisibleImages) return
        updateVisibleImages()
        schedulePrefetch()
        scheduleRender()
    }

    function clearPixiScene(): void {
        if (destroyed) return
        debugLog('sync-clear-start', {
            health,
            entries: entries.size,
            registryDispatchedNodes: [...registryDispatchedNodes],
            edgeCount: latestPixiEdges.length,
            generatingOutlineCount: generatingImageNodeOutlines.size,
        })

        for (const [nodeId, entry] of entries) {
            entry.requestId++
            entry.requestedTier = null
            entry.loadedTier = null
            releaseTexture(entry.textureKey)
            imageLayer.removeChild(entry.sprite)
            imageLayer.removeChild(entry.spriteMask)
            imageLayer.removeChild(entry.colorRect)
            entry.sprite.mask = null
            entry.sprite.renderable = false
            entry.spriteMask.renderable = false
            entry.colorRect.renderable = false
            entry.sprite.destroy()
            entry.spriteMask.destroy()
            entry.colorRect.destroy()
            entries.delete(nodeId)
        }
        spatialIndex.clear()

        for (const nodeId of registryDispatchedNodes) {
            mediaNodeRegistry.dispatchRemove(nodeId)
        }
        registryDispatchedNodes.clear()

        generatingImageNodeOutlines.clear()
        generatingBorderRenderer.sync([])
        latestPixiEdges = []
        edgeRenderer?.render(latestPixiEdges, currentViewport)
        hideForegroundGraphics(marqueeGraphics)
        hideForegroundGraphics(groupOverlayGraphics)

        if (health === 'ready') {
            scheduleRender()
        }
        debugLog('sync-clear-end', {
            entries: entries.size,
            registryDispatchedNodes: [...registryDispatchedNodes],
            edgeCount: latestPixiEdges.length,
            generatingOutlineCount: generatingImageNodeOutlines.size,
        })
    }

    function dispatchNonImageMediaNodes(canvasState: CanvasState): void {
        const nodesById = buildNodesById(canvasState.nodes)
        const currentRegistryNodes = new Set<string>()
        let handledCount = 0
        for (const node of canvasState.nodes) {
            if (node.type === 'image') continue
            const worldPosition = computeWorldPosition(node, nodesById)
            const handled = mediaNodeRegistry.dispatchSync(node, worldPosition, canvasState)
            if (handled) {
                handledCount++
                currentRegistryNodes.add(node.nodeId)
            }
        }
        for (const nodeId of registryDispatchedNodes) {
            if (!currentRegistryNodes.has(nodeId)) {
                debugLog('non-image-remove', { nodeId })
                mediaNodeRegistry.dispatchRemove(nodeId)
            }
        }
        registryDispatchedNodes = currentRegistryNodes
        debugLog('non-image-dispatch', {
            handledCount,
            handledNodeIds: [...currentRegistryNodes],
        })
    }

    function upsertAllEntries(canvasState: CanvasState): void {
        // Do NOT clear the spatial index here. upsertEntry updates each
        // entry's rect incrementally — remove old rect, insert new — so
        // the index stays consistent without the O(N log N) full rebuild
        // that was happening on every sync.
        const nodesById = buildNodesById(canvasState.nodes)
        const imageNodes = canvasState.nodes.filter(
            (node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image'
        )
        for (const node of imageNodes) {
            upsertEntry(node, computeWorldPosition(node, nodesById))
        }
    }

    // Any caller other than the traveling-outline animation may have changed
    // what sits beneath the screen glass, so it invalidates the refraction
    // capture. Animation-only frames use `scheduleAnimationRender`.
    function scheduleRender(): void {
        stageCaptureDirty = true
        scheduleRenderFrame()
    }

    // Drives frames for the traveling outline. The outline lives in the world
    // layer and is almost never under the screen-fixed chrome, so re-capturing
    // the whole stage into a full-viewport render texture 60 times a second
    // just to refract it is pure waste. The capture is only re-taken when an
    // animating outline actually overlaps a glass panel.
    function scheduleAnimationRender(): void {
        if (!stageCaptureDirty && animatingOutlinesOverlapScreenGlass()) stageCaptureDirty = true
        scheduleRenderFrame()
    }

    function scheduleRenderFrame(): void {
        if (destroyed || health !== 'ready') {
            debugLog('render-schedule-skipped', {
                destroyed,
                health,
            })
            return
        }
        if (renderRaf !== null) {
            debugLog('render-schedule-skipped', {
                reason: 'already-scheduled',
            })
            return
        }
        debugLog('render-scheduled', {
            entries: entries.size,
        })
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null
            if (destroyed || health !== 'ready') return
            renderPixiStage()
        })
    }

    function renderNow(): void {
        stageCaptureDirty = true
        if (destroyed || health !== 'ready') {
            debugLog('render-now-skipped', {
                destroyed,
                health,
            })
            return
        }
        if (renderRaf !== null) {
            cancelAnimationFrame(renderRaf)
            renderRaf = null
        }
        debugLog('render-now')
        renderPixiStage()
    }

    function renderPixiStage(): void {
        debugLog('render-stage-start', (verbose) => ({
            entryCount: entries.size,
            ...(verbose ? { entries: getDebugEntrySnapshots() } : {}),
        }))
        syncScreenGlassBorders()
        const captureTexture = glassBorderRenderer.getCaptureTexture()
        // A freshly created or resized render texture holds no usable capture,
        // so it always needs one regardless of the dirty flag. The renderer
        // resizes in place, so the size is compared alongside the identity.
        const captureKey = captureTexture
            ? `${captureTexture.width}x${captureTexture.height}@${captureTexture.source?.resolution ?? 1}`
            : ''
        if (captureTexture !== lastCaptureTexture || captureKey !== lastCaptureKey) {
            lastCaptureTexture = captureTexture
            lastCaptureKey = captureKey
            stageCaptureDirty = true
        }
        if (captureTexture && stageCaptureDirty) {
            stageCaptureDirty = false
            // Capture the stage with the glass layer hidden. If the layer stayed
            // visible, the next frame would sample and distort the previous
            // glass result, causing feedback and stale-resource pressure.
            glassBorderRenderer.setCapturing(true)
            try {
                app.renderer.render({
                    container: app.stage,
                    target: captureTexture,
                    clear: true,
                    clearColor: [0, 0, 0, 0],
                })
            } finally {
                glassBorderRenderer.setCapturing(false)
            }
        }
        // Final render draws the live stage, including the restored glass layer
        // that samples the captureTexture generated above.
        app.render()
        debugLog('render-stage-end', (verbose) => ({
            entryCount: entries.size,
            ...(verbose ? { entries: getDebugEntrySnapshots() } : {}),
        }))
    }

    // Screen-glass geometry is resolved at render time from DOM client rects
    // because the composer/action panels are screen-fixed DOM controls, not
    // world-space canvas nodes.
    function syncScreenGlassBorders(): void {
        screenGlassBorderRects = getScreenGlassBorderDatums()
        glassBorderRenderer.sync(screenGlassBorderRects, getPaneViewportSize())
    }

    // True when an animating outline currently sits under a glass panel, which
    // is the only case where an animation-only frame must re-capture the stage
    // for the refraction to stay live.
    function animatingOutlinesOverlapScreenGlass(): boolean {
        if (screenGlassBorderRects.length === 0 || generatingImageNodeOutlines.size === 0) return false

        const nodesById = lastState ? buildNodesById(lastState.nodes) : new Map()
        const zoom = currentViewport.zoom || 1
        for (const nodeId of generatingImageNodeOutlines.keys()) {
            const node = nodesById.get(nodeId)
            if (!node) continue
            const worldPosition = computeWorldPosition(node, nodesById)
            // Pad by the outline's outward reach so a snake travelling just
            // outside the node box still counts as overlapping.
            const padding = (inProgressOutlineAnimation.gap ?? 0) + inProgressOutlineAnimation.snakeWidth
            const left = worldPosition.x * zoom + currentViewport.x - padding
            const top = worldPosition.y * zoom + currentViewport.y - padding
            const right = left + node.dimensions.width * zoom + padding * 2
            const bottom = top + node.dimensions.height * zoom + padding * 2
            for (const glass of screenGlassBorderRects) {
                if (
                    left < glass.x + glass.width
                    && right > glass.x
                    && top < glass.y + glass.height
                    && bottom > glass.y
                ) {
                    return true
                }
            }
        }
        return false
    }

    // Prefer client dimensions because the Pixi canvas is resized to the pane.
    // getBoundingClientRect is a fallback for test DOMs and transient layout
    // states where clientWidth/clientHeight are not populated yet.
    function getPaneViewportSize(): { width: number; height: number } {
        if (paneEl.clientWidth > 0 && paneEl.clientHeight > 0) {
            return {
                width: paneEl.clientWidth,
                height: paneEl.clientHeight,
            }
        }
        const rect = paneEl.getBoundingClientRect()
        return {
            width: rect.width,
            height: rect.height,
        }
    }

    // Build one screen-space datum per glass target. The action panels are
    // searched from the workspace root because they are siblings of the pane,
    // while the global composer is inside the pane.
    function getScreenGlassBorderDatums(): PixiGlassBorderDatum[] {
        const glassBorder = settings.canvasChrome.glassBorder
        if (!glassBorder.enabled) return []

        const paneRect = paneEl.getBoundingClientRect()
        const targets = getScreenGlassBorderTargets()
        const datums: PixiGlassBorderDatum[] = []

        for (const target of targets) {
            if (!target.element.isConnected) {
                screenGlassBorderResizeObserver?.unobserve(target.element)
                observedScreenGlassBorderElements.delete(target.element)
                screenGlassBorderTargets = null
                continue
            }
            const rect = target.element.getBoundingClientRect()
            if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) continue
            // Renderer coordinates are pane-local screen pixels. That keeps the
            // glass fixed to the DOM chrome while the world pans/zooms below it.
            datums.push({
                id: target.id,
                x: rect.left - paneRect.left,
                y: rect.top - paneRect.top,
                width: rect.width,
                height: rect.height,
                radius: getCachedElementBorderRadius(target, rect.width, rect.height),
                visible: true,
            })
        }

        return datums
    }

    // Chrome elements are stable for the life of the pane, so the selector walk
    // is cached. Repeating the selector walk on every rendered frame adds steady
    // main-thread cost while the traveling outline animates.
    function getScreenGlassBorderTargets(): ScreenGlassBorderTarget[] {
        if (screenGlassBorderTargets) return screenGlassBorderTargets

        const rootEl = paneEl.closest<HTMLElement>('.workspace-canvas')
        const candidates: { id: string; element: HTMLElement | null | undefined }[] = [
            {
                id: 'workspace-action-panel-left',
                element: rootEl?.querySelector<HTMLElement>('.workspace-canvas-action-panel-left'),
            },
            {
                id: 'workspace-media-library-panel',
                element: rootEl?.querySelector<HTMLElement>('.workspace-canvas-media-library-panel'),
            },
            {
                id: 'workspace-global-composer',
                element: paneEl.querySelector<HTMLElement>('.workspace-canvas-global-composer'),
            },
            {
                id: 'workspace-right-control-rail',
                element: rootEl?.querySelector<HTMLElement>('.workspace-canvas-right-control-rail'),
            },
        ]
        const targets: ScreenGlassBorderTarget[] = []
        for (const candidate of candidates) {
            if (!candidate.element) continue
            if (!observedScreenGlassBorderElements.has(candidate.element)) {
                screenGlassBorderResizeObserver?.observe(candidate.element)
                observedScreenGlassBorderElements.add(candidate.element)
            }
            targets.push({ id: candidate.id, element: candidate.element, radiusKey: '', radius: 0 })
        }
        // Only cache once the chrome has actually mounted, otherwise an early
        // render would pin an empty target list for the session.
        if (targets.length === candidates.length) screenGlassBorderTargets = targets
        return targets
    }

    // `getComputedStyle` forces a style recalc, and the border radius only
    // changes when the element is resized, so the resolved value is memoized
    // against the measured box.
    function getCachedElementBorderRadius(target: ScreenGlassBorderTarget, width: number, height: number): number {
        const radiusKey = `${width}x${height}`
        if (target.radiusKey !== radiusKey) {
            target.radius = getElementBorderRadius(target.element, width, height)
            target.radiusKey = radiusKey
        }
        return target.radius
    }

    // Use the largest corner radius so a pill-shaped composer and circular
    // action buttons get matching rounded glass. Clamp to half size to avoid
    // invalid Pixi rounded-rect geometry.
    function getElementBorderRadius(element: HTMLElement, width: number, height: number): number {
        const styles = window.getComputedStyle(element)
        const radius = Math.max(
            parseCssRadius(styles.borderTopLeftRadius, width, height),
            parseCssRadius(styles.borderTopRightRadius, width, height),
            parseCssRadius(styles.borderBottomRightRadius, width, height),
            parseCssRadius(styles.borderBottomLeftRadius, width, height)
        )
        return Math.max(0, Math.min(radius, width / 2, height / 2))
    }

    // CSS allows radii like `999px`, `50%`, and two-value elliptical syntax.
    // The glass renderer needs one circular radius, so take the first radius
    // component and resolve percentages against the smaller box dimension.
    function parseCssRadius(value: string, width: number, height: number): number {
        const firstRadius = value.trim().split(/\s+/)[0]
        if (firstRadius.endsWith('%')) {
            const percent = Number.parseFloat(firstRadius)
            return Number.isFinite(percent) ? Math.min(width, height) * percent / 100 : 0
        }
        const pixels = Number.parseFloat(firstRadius)
        return Number.isFinite(pixels) ? pixels : 0
    }

    function getForegroundGraphics(graphics: Graphics | null, label: string): Graphics {
        if (graphics) {
            graphics.clear()
            graphics.renderable = true
            return graphics
        }
        const next = new Graphics()
        next.label = label
        next.eventMode = 'none'
        fgLayer.addChild(next)
        return next
    }

    function hideForegroundGraphics(graphics: Graphics | null): void {
        if (!graphics) return
        graphics.clear()
        graphics.renderable = false
    }

    // Live drag/resize updates push the new world position straight to the
    // sprite without going through `sync`, so the PIXI pixels stay locked
    // to the DOM hitbox during interaction.
    function setNodeLiveTransform(
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ): void {
        if (destroyed) return
        const x = worldPosition.x
        const y = worldPosition.y
        const w = dimensions.width
        const h = dimensions.height
        const entry = entries.get(nodeId)
        if (!entry) {
            debugLog('live-transform-missing-image-entry', {
                nodeId,
                worldPosition,
                dimensions,
                registryHasNode: registryDispatchedNodes.has(nodeId),
            })
            // Non-image (e.g. video) nodes flow through the registry so their
            // sprite transforms stay in lockstep with DOM hitboxes during drag/resize.
            if (registryDispatchedNodes.has(nodeId)) {
                mediaNodeRegistry.dispatchLiveTransform(nodeId, worldPosition, dimensions)
                const node = lastState?.nodes.find((candidate) => candidate.nodeId === nodeId)
                generatingBorderRenderer.updateGeometry(nodeId, {
                    x,
                    y,
                    width: w,
                    height: h,
                    radius: getGeneratingBorderRadius(node, w, h),
                })
                debugLog('live-transform-non-image', {
                    nodeId,
                    worldPosition,
                    dimensions,
                })
                scheduleRender()
            }
            return
        }

        debugLog('live-transform-image', (verbose) => ({
            nodeId,
            before: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            worldPosition,
            dimensions,
        }))

        entry.sprite.position.set(x, y)
        entry.sprite.width = w
        entry.sprite.height = h
        syncSpriteMask(entry, x, y, w, h)
        entry.colorRect.position.set(x, y)
        if (w !== entry.colorRectW || h !== entry.colorRectH) {
            drawColorRect(entry.colorRect, w, h)
            entry.colorRectW = w
            entry.colorRectH = h
        }

        generatingBorderRenderer.updateGeometry(nodeId, { x, y, width: w, height: h, radius: getMediaNodeBorderRadius(w, h) })

        spatialIndex.remove(entry.worldRect, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
        const newRect: IndexedImage = { minX: x, minY: y, maxX: x + w, maxY: y + h, nodeId }
        entry.worldRect = newRect
        spatialIndex.insert(newRect)

        debugLog('live-transform-image-applied', (verbose) => ({
            nodeId,
            after: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
        }))
        scheduleRender()
    }

    function makeSourceKey(node: ImageCanvasNode): string {
        return transientImageSources.get(node.nodeId) ?? node.assetId
    }

    function setTransientImageSource(nodeId: string, sourceUrl: string | null): void {
        if (sourceUrl) transientImageSources.set(nodeId, sourceUrl)
        else transientImageSources.delete(nodeId)
        sync(lastState)
    }

    function shouldPromoteGeneratedFinalFrameDirectly(previousNode: ImageCanvasNode, nextNode: ImageCanvasNode): boolean {
        return Boolean(nextNode.generatedBy?.conversationAssetId && previousNode.assetId !== nextNode.assetId)
    }

    function getMediaNodeBorderRadius(width: number, height: number): number {
        const borderRadius = settings.mediaNode.styles.borderRadius
        if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
        return Math.min(borderRadius, width / 2, height / 2)
    }

    function getGeneratingBorderRadius(node: CanvasNode | undefined, width: number, height: number): number {
        if (node?.type === 'image' || node?.type === 'video') return getMediaNodeBorderRadius(width, height)
        const borderRadius = inProgressOutlineAnimation.radius
        if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
        return Math.min(borderRadius, width / 2, height / 2)
    }

    function getPreFrameCircleGeometry(
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ): { x: number; y: number; width: number; height: number; radius: number } {
        const configuredScale = Number(inProgressOutlineAnimation.preFrameCircleScale)
        const scale = Number.isFinite(configuredScale) && configuredScale > 0
            ? Math.min(1, configuredScale)
            : 1 / 3
        const size = Math.max(1, Math.min(dimensions.width, dimensions.height) * scale)
        return {
            x: worldPosition.x + (dimensions.width - size) / 2,
            y: worldPosition.y + (dimensions.height - size) / 2,
            width: size,
            height: size,
            radius: size / 2,
        }
    }

    function getGeneratingOutlinePathPerimeter(width: number, height: number, radius: number): number {
        const strokeScale = scaleCanvasChromeWorldSizeForZoom(1, currentViewport.zoom, inProgressOutlineZoomScaling)
        const headOutset = (inProgressOutlineAnimation.gap + inProgressOutlineAnimation.snakeWidth / 2) * strokeScale
        return getRoundedOutlinePerimeter(width + headOutset * 2, height + headOutset * 2, radius + headOutset)
    }

    function getPreFrameCircleDurationMs(
        node: CanvasNode,
        circleGeometry: { width: number; height: number; radius: number }
    ): number | undefined {
        const nodeRadius = getGeneratingBorderRadius(node, node.dimensions.width, node.dimensions.height)
        const nodePerimeter = getGeneratingOutlinePathPerimeter(node.dimensions.width, node.dimensions.height, nodeRadius)
        const circlePerimeter = getGeneratingOutlinePathPerimeter(circleGeometry.width, circleGeometry.height, circleGeometry.radius)
        if (nodePerimeter <= 0 || circlePerimeter <= 0) return undefined
        return inProgressOutlineAnimation.animationDurationMs * (circlePerimeter / nodePerimeter)
    }

    function getPreFrameCircleSnakeLengthFraction(
        node: CanvasNode,
        circleGeometry: { width: number; height: number; radius: number }
    ): number | undefined {
        const nodeRadius = getGeneratingBorderRadius(node, node.dimensions.width, node.dimensions.height)
        const nodePerimeter = getGeneratingOutlinePathPerimeter(node.dimensions.width, node.dimensions.height, nodeRadius)
        const circlePerimeter = getGeneratingOutlinePathPerimeter(circleGeometry.width, circleGeometry.height, circleGeometry.radius)
        if (nodePerimeter <= 0 || circlePerimeter <= 0) return undefined
        return Math.min(0.98, inProgressOutlineAnimation.snakeLengthFraction * (nodePerimeter / circlePerimeter))
    }

    function isUsableGraphics(graphics: Graphics): boolean {
        const candidate = graphics as unknown as {
            destroyed?: boolean
            position?: { set?: unknown }
        }
        return candidate.destroyed !== true && typeof candidate.position?.set === 'function'
    }

    function replaceEntrySpriteMask(entry: PixiImageEntry): void {
        const previousSpriteMask = entry.spriteMask
        const nextSpriteMask = createImageSpriteMask(entry.nodeRef.nodeId)
        let previousSpriteMaskIndex = imageLayer.children.length
        try {
            previousSpriteMaskIndex = imageLayer.getChildIndex(previousSpriteMask)
            imageLayer.removeChild(previousSpriteMask)
        } catch {
            // If Pixi already detached or destroyed the mask, keep replacing it.
        }
        entry.spriteMask = nextSpriteMask
        entry.sprite.mask = nextSpriteMask
        entry.spriteMaskW = -1
        entry.spriteMaskH = -1
        entry.spriteMaskRadius = -1
        imageLayer.addChildAt(nextSpriteMask, Math.max(0, Math.min(previousSpriteMaskIndex, imageLayer.children.length)))
        try {
            previousSpriteMask.destroy()
        } catch (error) {
            debugLog('texture-mask-destroy-after-mask-replace-failed', {
                nodeId: entry.nodeRef.nodeId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
        }
    }

    function syncSpriteMask(entry: PixiImageEntry, x: number, y: number, width: number, height: number): void {
        if (!isUsableGraphics(entry.spriteMask)) replaceEntrySpriteMask(entry)
        const radius = getMediaNodeBorderRadius(width, height)
        entry.spriteMask.position.set(x, y)
        if (width === entry.spriteMaskW && height === entry.spriteMaskH && radius === entry.spriteMaskRadius) return

        entry.spriteMask.clear()
        entry.spriteMask.roundRect(0, 0, width, height, radius)
        entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })
        entry.spriteMaskW = width
        entry.spriteMaskH = height
        entry.spriteMaskRadius = radius
    }

    function createImageSprite(nodeId: string, texture: Texture = Texture.EMPTY): Sprite {
        const sprite = new Sprite(texture)
        sprite.label = `pixi-image-${nodeId}`
        sprite.eventMode = 'none'
        sprite.visible = false
        return sprite
    }

    function createImageSpriteMask(nodeId: string): Graphics {
        const spriteMask = new Graphics()
        spriteMask.label = `pixi-image-mask-${nodeId}`
        spriteMask.eventMode = 'none'
        return spriteMask
    }

    function detachImageLayerChild(child: Sprite | Graphics): void {
        try {
            imageLayer.removeChild(child)
        } catch {
            // Already detached.
        }
    }

    function hideDetachedImageSprite(sprite: Sprite): void {
        try {
            sprite.mask = null
            sprite.renderable = false
            sprite.visible = false
        } catch {
            // A failed texture swap can corrupt sprite internals; cleanup remains best effort.
        }
    }

    function hideDetachedImageMask(mask: Graphics): void {
        try {
            mask.clear()
            mask.renderable = false
            mask.visible = false
        } catch {
            // A corrupted mask should not block replacement.
        }
    }

    function replaceEntrySprite(entry: PixiImageEntry, texture: Texture): void {
        const previousSprite = entry.sprite
        const previousSpriteMask = entry.spriteMask
        const nextSprite = createImageSprite(entry.nodeRef.nodeId, texture)
        const nextSpriteMask = createImageSpriteMask(entry.nodeRef.nodeId)
        let previousSpriteIndex = imageLayer.children.length
        try {
            previousSpriteIndex = imageLayer.getChildIndex(previousSprite)
        } catch {
            // If the failed texture assignment left the old sprite detached, append
            // the replacement at the top of the image layer.
        }
        nextSprite.mask = nextSpriteMask
        nextSprite.renderable = entry.isVisible
        nextSprite.position.set(entry.worldRect.minX, entry.worldRect.minY)
        detachImageLayerChild(previousSprite)
        detachImageLayerChild(previousSpriteMask)
        hideDetachedImageSprite(previousSprite)
        hideDetachedImageMask(previousSpriteMask)
        entry.sprite = nextSprite
        entry.spriteMask = nextSpriteMask
        entry.spriteMaskW = -1
        entry.spriteMaskH = -1
        entry.spriteMaskRadius = -1
        imageLayer.addChildAt(nextSpriteMask, Math.max(0, Math.min(previousSpriteIndex, imageLayer.children.length)))
        imageLayer.addChildAt(nextSprite, Math.max(0, Math.min(previousSpriteIndex + 1, imageLayer.children.length)))
        try {
            previousSprite.destroy()
        } catch (error) {
            debugLog('texture-sprite-destroy-after-replace-failed', {
                nodeId: entry.nodeRef.nodeId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
        }
        try {
            previousSpriteMask.destroy()
        } catch (error) {
            debugLog('texture-mask-destroy-after-replace-failed', {
                nodeId: entry.nodeRef.nodeId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
        }
    }

    function bindTextureToEntrySprite(entry: PixiImageEntry, texture: Texture): void {
        try {
            entry.sprite.texture = texture
        } catch (error) {
            debugLog('texture-sprite-bind-replaced-after-error', {
                nodeId: entry.nodeRef.nodeId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
            replaceEntrySprite(entry, texture)
        }
    }

    function upsertEntry(node: ImageCanvasNode, worldPosition: WorldPosition): void {
        const newSourceKey = makeSourceKey(node)
        let entry = entries.get(node.nodeId)

        if (!entry) {
            debugLog('entry-create-start', {
                nodeId: node.nodeId,
                assetId: node.assetId,
                src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
                sourceKey: newSourceKey,
                worldPosition,
                dimensions: node.dimensions,
            })
            if (isFinalGeneratedImageNode(node)) {
                logFinalGeneratedImageLifecycle('final-generated-entry-create-start', {
                    nodeId: node.nodeId,
                    assetId: node.assetId,
                    src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
                    sourceKey: cleanDebugUrl(newSourceKey),
                    worldPosition,
                    dimensions: node.dimensions,
                })
            }
            const sprite = createImageSprite(node.nodeId)
            const spriteMask = createImageSpriteMask(node.nodeId)
            sprite.mask = spriteMask
            const colorRect = new Graphics()
            colorRect.label = `pixi-image-color-${node.nodeId}`
            colorRect.eventMode = 'none'
            imageLayer.addChild(sprite)
            imageLayer.addChild(spriteMask)
            imageLayer.addChild(colorRect)
            const rect = makeIndexedImage(node, worldPosition)
            entry = {
                sprite,
                spriteMask,
                colorRect,
                nodeRef: node,
                sourceKey: newSourceKey,
                loadedTier: null,
                requestedTier: null,
                sourceReloadPending: false,
                requestId: 0,
                textureKey: null,
                forceFullOnNextLoad: false,
                worldRect: rect,
                isVisible: false,
                colorRectW: -1,
                colorRectH: -1,
                spriteMaskW: -1,
                spriteMaskH: -1,
                spriteMaskRadius: -1,
            }
            entries.set(node.nodeId, entry)
            spatialIndex.insert(rect)
            debugLog('entry-create-end', (verbose) => ({
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            if (isFinalGeneratedImageNode(node)) {
                logFinalGeneratedImageLifecycle('final-generated-entry-create-end', {
                    entry: getDebugEntrySummary(entry),
                })
            }
        } else if (entry.sourceKey !== newSourceKey) {
            // Keep the current texture visible until the replacement has fully
            // decoded, then bind the new texture in one render pass.
            debugLog('entry-source-change', (verbose) => ({
                nodeId: node.nodeId,
                oldSourceKey: cleanDebugUrl(entry.sourceKey),
                newSourceKey: cleanDebugUrl(newSourceKey),
                before: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                nextNode: {
                    assetId: node.assetId,
                    src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
                    dimensions: node.dimensions,
                    position: node.position,
                },
            }))
            const promoteFinalFrameDirectly = shouldPromoteGeneratedFinalFrameDirectly(entry.nodeRef, node)
            entry.requestedTier = null
            entry.requestId++
            entry.sourceKey = newSourceKey
            entry.sourceReloadPending = true
            entry.forceFullOnNextLoad = promoteFinalFrameDirectly
        }

        entry.nodeRef = node
        if (entry.sourceKey === newSourceKey) {
            debugLog('entry-upsert-node-ref-applied', (verbose) => ({
                nodeId: node.nodeId,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
        }

        const x = worldPosition.x
        const y = worldPosition.y
        const w = node.dimensions.width
        const h = node.dimensions.height

        // Sprite transform — always cheap (matrix update only).
        entry.sprite.position.set(x, y)
        entry.sprite.width = w
        entry.sprite.height = h
        syncSpriteMask(entry, x, y, w, h)

        // Color-rect geometry — only rebuild GPU path when size actually changed.
        // Position is a transform update; width/height require path re-upload.
        entry.colorRect.position.set(x, y)
        if (w !== entry.colorRectW || h !== entry.colorRectH) {
            drawColorRect(entry.colorRect, w, h)
            entry.colorRectW = w
            entry.colorRectH = h
        }

        // Spatial index — incremental: remove old rect only if position/size changed.
        const old = entry.worldRect
        if (old.minX !== x || old.minY !== y || old.maxX !== x + w || old.maxY !== y + h) {
            debugLog('entry-geometry-change', {
                nodeId: node.nodeId,
                oldRect: { ...old },
                newRect: { minX: x, minY: y, maxX: x + w, maxY: y + h, nodeId: node.nodeId },
            })
            spatialIndex.remove(old, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
            const newRect = makeIndexedImage(node, worldPosition)
            entry.worldRect = newRect
            spatialIndex.insert(newRect)
            debugLog('entry-geometry-change-applied', (verbose) => ({
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
        }

        // IMPORTANT: do NOT trigger texture loading here. Texture loading is
        // driven by visibility (updateVisibleImages / ensureTextureForEntry).
    }

    function drawColorRect(rect: Graphics, width: number, height: number): void {
        rect.clear()
        rect.roundRect(0, 0, width, height, getMediaNodeBorderRadius(width, height))
        rect.fill({ color: 0xe7eaee, alpha: 0.85 })
    }

    function syncGeneratingImageBorders(): void {
        const datums: PixiTravelingOutlineDatum[] = []
        const nodesById = lastState ? buildNodesById(lastState.nodes) : new Map()
        for (const [nodeId, outline] of generatingImageNodeOutlines) {
            const node = nodesById.get(nodeId)
            if (!node) continue
            const worldPosition = computeWorldPosition(node, nodesById)
            const geometry = outline.shape === 'preFrameCircle'
                ? getPreFrameCircleGeometry(worldPosition, node.dimensions)
                : {
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                    radius: getGeneratingBorderRadius(node, node.dimensions.width, node.dimensions.height),
                }
            const datum: PixiTravelingOutlineDatum = {
                id: nodeId,
                x: geometry.x,
                y: geometry.y,
                width: geometry.width,
                height: geometry.height,
                radius: geometry.radius,
                visible: true,
            }
            if (outline.direction) datum.direction = outline.direction
            datum.durationMs = outline.shape === 'preFrameCircle'
                ? getPreFrameCircleDurationMs(node, geometry)
                : undefined
            datum.snakeLengthFraction = outline.shape === 'preFrameCircle'
                ? getPreFrameCircleSnakeLengthFraction(node, geometry)
                : undefined
            datums.push(datum)
        }
        generatingBorderRenderer.sync(datums)
    }

    function setGeneratingImageNodes(nodeIds: Set<string>): void
    function setGeneratingImageNodes(nodeIds: Map<string, GeneratingMediaOutlineTarget>): void
    function setGeneratingImageNodes(nodeIds: GeneratingMediaOutlineTargets): void
    function setGeneratingImageNodes(nodeIds: GeneratingMediaOutlineTargets): void {
        generatingImageNodeOutlines = nodeIds instanceof Map
            ? new Map(Array.from(nodeIds, ([nodeId, target]) => [nodeId, normalizeGeneratingOutlineTarget(target)]))
            : new Map(Array.from(nodeIds, (nodeId): [string, GeneratingMediaOutlineOptions] => [nodeId, {}]))
        if (destroyed || health !== 'ready') return
        syncGeneratingImageBorders()
        scheduleRender()
    }

    function normalizeGeneratingOutlineTarget(target: GeneratingMediaOutlineTarget): GeneratingMediaOutlineOptions {
        if (!target) return {}
        if (typeof target === 'string') return { direction: target }
        return target
    }

    function isPreFrameCircleGeneratingNode(nodeId: string): boolean {
        return generatingImageNodeOutlines.get(nodeId)?.shape === 'preFrameCircle'
    }

    function shouldTreatImageEntryAsFramePending(entry: PixiImageEntry): boolean {
        return isPreFrameCircleGeneratingNode(entry.nodeRef.nodeId) || isGeneratedImageNodeWaitingForFrame(entry.nodeRef)
    }

    function resolveRenderableImagePath(node: ImageCanvasNode): string {
        const transientSource = transientImageSources.get(node.nodeId)
        if (transientSource) return transientSource
        const forcedRendition = generatingImageNodeOutlines.get(node.nodeId)?.sourceRendition
        if (forcedRendition) return `/api/assets/${encodeURIComponent(node.assetId)}/renditions/${forcedRendition}`
        const renditions = assetsStore.get(node.assetId)?.media?.renditions
        if (renditions?.preview?.status === 'ready') return resolveStoredImagePath(node, getWorkspaceId())
        if (renditions?.original?.status === 'ready') {
            return `/api/assets/${encodeURIComponent(node.assetId)}/renditions/original`
        }
        return resolveStoredImagePath(node, getWorkspaceId())
    }

    // Idempotent texture-quality guarantor. Ensures the entry has at least
    // `desiredTier`-quality pixels loaded. Three cardinal rules:
    //   1) If a higher-or-equal tier is already on the sprite, do NOTHING —
    //      mipmaps handle GPU downsampling, so a `full` texture renders fine
    //      at any zoom and re-fetching `thumb-256` would be pure waste.
    //   2) If a higher-or-equal tier is already in-flight, do NOTHING.
    //   3) If we have nothing yet AND the desired tier is bigger than 256px,
    //      progressively load `thumb-256` first for instant visual feedback,
    //      then schedule a background upgrade to the desired tier in idle time.
    function ensureTextureForEntry(entry: PixiImageEntry, desiredTier: LodTier): void {
        const isPreFramePending = shouldTreatImageEntryAsFramePending(entry)
        const forcedSourceRendition = generatingImageNodeOutlines.get(entry.nodeRef.nodeId)?.sourceRendition
        debugLog('ensure-texture-start', (verbose) => ({
            nodeId: entry.nodeRef.nodeId,
            desiredTier,
            isPreFramePending,
            entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
        }))
        if (isPreFramePending && !forcedSourceRendition) {
            entry.sprite.visible = false
            entry.colorRect.visible = false
            debugLog('ensure-texture-skip-frame-pending', (verbose) => ({
                nodeId: entry.nodeRef.nodeId,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            return
        }
        if (desiredTier === 'color') {
            // Extreme zoom-out: tinted rectangle suffices. Keep any existing
            // texture cached on the sprite for when the user zooms back in.
            entry.sprite.visible = entry.loadedTier !== null
            entry.colorRect.visible = entry.loadedTier === null && !isPreFramePending
            debugLog('ensure-texture-color-tier', (verbose) => ({
                nodeId: entry.nodeRef.nodeId,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            return
        }

        // Rule 1: never downgrade. Mipmaps make a full-res texture render
        // perfectly at any zoom; refetching a smaller LoD is pure waste and
        // is exactly what made zoom-out feel sluggish.
        if (!entry.sourceReloadPending
            && entry.loadedTier !== null
            && tierRank(entry.loadedTier) >= tierRank(desiredTier)) {
            entry.sprite.visible = true
            syncSpriteMask(entry, entry.worldRect.minX, entry.worldRect.minY, entry.nodeRef.dimensions.width, entry.nodeRef.dimensions.height)
            entry.colorRect.visible = false
            debugLog('ensure-texture-loaded-tier-sufficient', (verbose) => ({
                nodeId: entry.nodeRef.nodeId,
                desiredTier,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            return
        }

        // Rule 2: a request is already in flight.
        if (entry.requestedTier !== null) {
            if (tierRank(entry.requestedTier) >= tierRank(desiredTier)) {
                // In-flight request already covers our needs.
                debugLog('ensure-texture-request-sufficient', (verbose) => ({
                    nodeId: entry.nodeRef.nodeId,
                    desiredTier,
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                return
            }
            // In-flight is a lower tier (typically the progressive thumb-256
            // first step). Don't race the network with a duplicate fetch —
            // schedule an idle upgrade and let the in-flight one finish.
            debugLog('ensure-texture-schedule-upgrade-from-inflight', (verbose) => ({
                nodeId: entry.nodeRef.nodeId,
                desiredTier,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            scheduleProgressiveUpgrade(entry, desiredTier)
            return
        }

        // Rule 3: progressive `thumb-256`-first when we have nothing yet.
        // 256px PNGs are tiny (~10–30KB) so the entire workspace can paint a
        // recognizable preview in well under a second, then upgrade in idle
        // time. This is the single most impactful change for first-paint.
        const shouldFetchProgressivePreview = !forcedSourceRendition
            && entry.loadedTier === null
            && desiredTier !== 'thumb-256'
        const fetchTier: LodTier = forcedSourceRendition || entry.forceFullOnNextLoad
            ? 'full'
            : shouldFetchProgressivePreview
                ? 'thumb-256'
                : desiredTier

        entry.requestedTier = fetchTier
        entry.requestId = ++requestCounter
        const requestId = entry.requestId

        const hasTexture = entry.textureKey !== null
        if (!hasTexture) {
            entry.sprite.visible = false
            entry.colorRect.visible = !isPreFramePending
        }

        const node = entry.nodeRef
        debugLog('texture-request-start', (verbose) => ({
            nodeId: node.nodeId,
            assetId: node.assetId,
            src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
            desiredTier,
            fetchTier,
            requestId,
            hasTexture,
            entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
        }))
        if (isFinalGeneratedImageNode(node)) {
            logFinalGeneratedImageLifecycle('final-generated-texture-request-start', {
                nodeId: node.nodeId,
                assetId: node.assetId,
                src: cleanDebugUrl(resolveStoredImagePath(node, getWorkspaceId())),
                desiredTier,
                fetchTier,
                requestId,
                hasTexture,
                entry: getDebugEntrySummary(entry),
            })
        }

        void (async () => {
            let acquiredKey: string | null = null
            try {
                const url = await resolveImageSrc(node, getWorkspaceId(), resolveRenderableImagePath(node))
                const resolved = forcedSourceRendition ? url : addPixiLodSizeParam(url, fetchTier)
                debugLog('texture-request-resolved-url', {
                    nodeId: node.nodeId,
                    requestId,
                    fetchTier,
                    url: cleanDebugUrl(url),
                    resolved: cleanDebugUrl(resolved),
                })
                const texture = await acquireTexture(resolved)
                acquiredKey = resolved
                if (destroyed || entry.requestId !== requestId || entries.get(node.nodeId) !== entry) {
                    debugLog('texture-request-stale', {
                        nodeId: node.nodeId,
                        requestId,
                        currentRequestId: entry.requestId,
                        destroyed,
                        resolved: cleanDebugUrl(resolved),
                    })
                    releaseTexture(resolved)
                    return
                }
                // Don't downgrade if a parallel request already loaded a higher tier.
                if (!entry.sourceReloadPending
                    && entry.loadedTier !== null
                    && tierRank(entry.loadedTier) > tierRank(fetchTier)) {
                    debugLog('texture-request-skip-downgrade', {
                        nodeId: node.nodeId,
                        requestId,
                        fetchTier,
                        loadedTier: entry.loadedTier,
                        resolved: cleanDebugUrl(resolved),
                    })
                    releaseTexture(resolved)
                    entry.requestedTier = null
                    return
                }
                const oldKey = entry.textureKey
                bindTextureToEntrySprite(entry, texture)
                if (Number.isFinite(texture.width) && Number.isFinite(texture.height) && texture.width > 0 && texture.height > 0) {
                    onImageIntrinsicSize?.({
                        nodeId: node.nodeId,
                        width: texture.width,
                        height: texture.height,
                        preserveNodeGeometry: Boolean(oldKey?.includes('/api/transient-media/')),
                    })
                }
                entry.sprite.position.set(entry.worldRect.minX, entry.worldRect.minY)
                entry.sprite.width = entry.nodeRef.dimensions.width
                entry.sprite.height = entry.nodeRef.dimensions.height
                syncSpriteMask(entry, entry.worldRect.minX, entry.worldRect.minY, entry.nodeRef.dimensions.width, entry.nodeRef.dimensions.height)
                entry.textureKey = resolved
                entry.loadedTier = fetchTier
                entry.requestedTier = null
                entry.sourceReloadPending = false
                entry.forceFullOnNextLoad = false
                entry.sprite.visible = true
                entry.colorRect.visible = false
                if (oldKey && oldKey !== resolved) releaseTexture(oldKey)
                scheduleRender()
                debugLog('texture-request-loaded', (verbose) => ({
                    nodeId: node.nodeId,
                    requestId,
                    fetchTier,
                    desiredTier,
                    resolved: cleanDebugUrl(resolved),
                    oldKey: cleanDebugUrl(oldKey),
                    textureWidth: texture.width,
                    textureHeight: texture.height,
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                if (isFinalGeneratedImageNode(node)) {
                    logFinalGeneratedImageLifecycle('final-generated-texture-request-loaded', {
                        nodeId: node.nodeId,
                        assetId: node.assetId,
                        requestId,
                        fetchTier,
                        desiredTier,
                        resolved: cleanDebugUrl(resolved),
                        textureWidth: texture.width,
                        textureHeight: texture.height,
                        entry: getDebugEntrySummary(entry),
                    })
                }

                // If the user actually wants a higher tier than we just loaded,
                // schedule a background upgrade in an idle slot. The user sees
                // the preview now and gets sharper pixels later, with no
                // blocking on the critical path.
                if (tierRank(desiredTier) > tierRank(fetchTier)) {
                    scheduleProgressiveUpgrade(entry, desiredTier)
                }
            } catch (error) {
                const staleRequest = destroyed || entry.requestId !== requestId || entries.get(node.nodeId) !== entry
                if (staleRequest) {
                    debugLog('texture-request-error-stale', (verbose) => ({
                        nodeId: node.nodeId,
                        requestId,
                        currentRequestId: entry.requestId,
                        destroyed,
                        acquiredKey: cleanDebugUrl(acquiredKey),
                        message: error instanceof Error ? error.message : String(error),
                        entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                    }))
                    if (acquiredKey) releaseTexture(acquiredKey)
                    return
                }
                console.error('[PixiMediaLayer] Failed to load image texture.', error)
                if (isFinalGeneratedImageNode(node)) {
                    logFinalGeneratedImageLifecycle('final-generated-texture-request-error', {
                        nodeId: node.nodeId,
                        assetId: node.assetId,
                        requestId,
                        fetchTier,
                        desiredTier,
                        acquiredKey: cleanDebugUrl(acquiredKey),
                        message: error instanceof Error ? error.message : String(error),
                        entry: getDebugEntrySummary(entry),
                    })
                }
                debugLog('texture-request-error', (verbose) => ({
                    nodeId: node.nodeId,
                    requestId,
                    fetchTier,
                    desiredTier,
                    acquiredKey: cleanDebugUrl(acquiredKey),
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                if (acquiredKey) releaseTexture(acquiredKey)
                if (entry.requestId === requestId) {
                    entry.requestedTier = null
                    if (!hasTexture) {
                        entry.sprite.visible = false
                        entry.colorRect.visible = !shouldTreatImageEntryAsFramePending(entry)
                    }
                    scheduleRender()
                }
            }
        })()
    }

    function scheduleProgressiveUpgrade(entry: PixiImageEntry, targetTier: LodTier): void {
        if (destroyed) return
        debugLog('progressive-upgrade-scheduled', (verbose) => ({
            nodeId: entry.nodeRef.nodeId,
            targetTier,
            entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
        }))
        scheduleIdle(() => {
            if (destroyed) {
                debugLog('progressive-upgrade-skipped', {
                    nodeId: entry.nodeRef.nodeId,
                    targetTier,
                    reason: 'destroyed',
                })
                return
            }
            // Skip if entry is no longer visible OR already has equal/better tier
            // OR another request has already taken over.
            if (!entry.isVisible) {
                debugLog('progressive-upgrade-skipped', (verbose) => ({
                    nodeId: entry.nodeRef.nodeId,
                    targetTier,
                    reason: 'not-visible',
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                return
            }
            if (!entry.sourceReloadPending
                && entry.loadedTier !== null
                && tierRank(entry.loadedTier) >= tierRank(targetTier)) {
                debugLog('progressive-upgrade-skipped', (verbose) => ({
                    nodeId: entry.nodeRef.nodeId,
                    targetTier,
                    reason: 'loaded-tier-sufficient',
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                return
            }
            if (entry.requestedTier !== null && tierRank(entry.requestedTier) >= tierRank(targetTier)) {
                debugLog('progressive-upgrade-skipped', (verbose) => ({
                    nodeId: entry.nodeRef.nodeId,
                    targetTier,
                    reason: 'request-tier-sufficient',
                    entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
                }))
                return
            }
            debugLog('progressive-upgrade-run', (verbose) => ({
                nodeId: entry.nodeRef.nodeId,
                targetTier,
                entry: verbose ? getDebugEntrySnapshot(entry) : getDebugEntrySummary(entry),
            }))
            ensureTextureForEntry(entry, targetTier)
        }, 2000)
    }

    async function acquireTexture(url: string): Promise<Texture> {
        const cached = textureCache.get(url)
        if (cached) {
            cached.refCount++
            cached.lastUsed = ++textureClock
            debugLog('texture-cache-hit', {
                url: cleanDebugUrl(url),
                refCount: cached.refCount,
                textureWidth: cached.texture.width,
                textureHeight: cached.texture.height,
                cache: getDebugCacheSnapshot(),
            })
            return cached.texture
        }

        debugLog('texture-cache-miss', {
            url: cleanDebugUrl(url),
            cache: getDebugCacheSnapshot(),
        })
        const bitmap = await decodeImageInWorker(url)
        debugLog('texture-decode-complete', {
            url: cleanDebugUrl(url),
            bitmapWidth: bitmap.width,
            bitmapHeight: bitmap.height,
        })
        const texture = Texture.from(bitmap)

        // CRITICAL for zoom-out performance. Without mipmaps, every zoomed-out
        // sprite forces the GPU to sample from the full-resolution texture for
        // each output pixel. At zoom 0.1×, rendering a 1024-px texture as a
        // ~10-px sprite means the GPU's texture cache must service the full
        // 1 MB texel footprint for 100 pixels of output — catastrophic with
        // hundreds of images visible simultaneously. With mipmaps the GPU
        // selects the pre-computed 8×8 or 16×16 MIP level and the cache
        // pressure drops by 3–4 orders of magnitude.
        //
        // We set the flag before the first GPU upload (which happens lazily on
        // the next `app.render()` call) so PIXI generates the MIP chain during
        // the initial upload at no extra cost.
        texture.source.autoGenerateMipmaps = true

        const bytes = Math.max(1, bitmap.width) * Math.max(1, bitmap.height) * 4
        textureCache.set(url, {
            texture,
            bytes,
            refCount: 1,
            lastUsed: ++textureClock,
        })
        textureBytes += bytes
        evictTextures()
        debugLog('texture-cache-insert', {
            url: cleanDebugUrl(url),
            bytes,
            textureWidth: texture.width,
            textureHeight: texture.height,
            cache: getDebugCacheSnapshot(),
        })
        return texture
    }

    function releaseTexture(url: string | null): void {
        if (!url) return
        const entry = textureCache.get(url)
        if (!entry) {
            debugLog('texture-release-missing-cache-entry', {
                url: cleanDebugUrl(url),
            })
            return
        }
        entry.refCount = Math.max(0, entry.refCount - 1)
        debugLog('texture-release', {
            url: cleanDebugUrl(url),
            refCount: entry.refCount,
            cache: getDebugCacheSnapshot(),
        })
    }

    function evictTextures(): void {
        if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) return
        debugLog('texture-evict-start', {
            cache: getDebugCacheSnapshot(),
            maxTextures: MAX_TEXTURES,
            maxBytes: MAX_TEXTURE_BYTES,
        })

        // First pass: evict textures with no live references (already
        // detached or never bound). LRU within that pool.
        const idleCandidates = Array.from(textureCache.entries())
            .filter(([, entry]) => entry.refCount === 0)
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

        for (const [key, entry] of idleCandidates) {
            if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) break
            textureCache.delete(key)
            textureBytes -= entry.bytes
            entry.texture.destroy(true)
            debugLog('texture-evict-idle', {
                key: cleanDebugUrl(key),
                bytes: entry.bytes,
                cache: getDebugCacheSnapshot(),
            })
        }

        if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) {
            debugLog('texture-evict-end', {
                reason: 'after-idle-eviction',
                cache: getDebugCacheSnapshot(),
            })
            return
        }

        // Second pass: under genuine memory pressure, detach textures from
        // *non-visible* sprites (LRU first) so their cache slot can be
        // reclaimed. The sprite reverts to its color placeholder; when the
        // user pans/zooms it back into the viewport, `updateVisibleImages`
        // re-fetches the right tier on demand.
        //
        // Visible sprites are NEVER evicted from under the user — that
        // would cause flashing during zoom/pan.
        const offscreen = Array.from(entries.values())
            .filter((e) => !e.isVisible && e.textureKey !== null)
            .sort((a, b) => {
                const ta = textureCache.get(a.textureKey!)?.lastUsed ?? 0
                const tb = textureCache.get(b.textureKey!)?.lastUsed ?? 0
                return ta - tb
            })

        for (const e of offscreen) {
            if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) break
            const key = e.textureKey
            if (!key) continue
            debugLog('texture-evict-offscreen-entry', (verbose) => ({
                nodeId: e.nodeRef.nodeId,
                key: cleanDebugUrl(key),
                entry: verbose ? getDebugEntrySnapshot(e) : getDebugEntrySummary(e),
            }))
            e.sprite.texture = Texture.EMPTY
            e.textureKey = null
            e.loadedTier = null
            const cached = textureCache.get(key)
            if (cached) {
                cached.refCount = Math.max(0, cached.refCount - 1)
                if (cached.refCount === 0) {
                    textureCache.delete(key)
                    textureBytes -= cached.bytes
                    cached.texture.destroy(true)
                    debugLog('texture-evict-offscreen-cache', {
                        nodeId: e.nodeRef.nodeId,
                        key: cleanDebugUrl(key),
                        bytes: cached.bytes,
                        cache: getDebugCacheSnapshot(),
                    })
                }
            }
        }
        debugLog('texture-evict-end', {
            reason: 'after-offscreen-eviction',
            cache: getDebugCacheSnapshot(),
        })
    }

    // Drive sprite renderable flags + texture loading from spatial-index
    // visibility. Visible entries fetch on demand; non-visible entries keep
    // any cached texture they have. This is the hot path during pan/zoom so
    // it is intentionally lean: spatial index search + map iteration only.
    function updateVisibleImages(): void {
        if (health !== 'ready' || !lastState || destroyed) {
            debugLog('visibility-pass-skipped', {
                health,
                hasLastState: Boolean(lastState),
                destroyed,
            })
            return
        }
        const paneBounds = paneEl.clientWidth > 0 && paneEl.clientHeight > 0
            ? null
            : paneEl.getBoundingClientRect()
        const paneSize = {
            width: paneEl.clientWidth || paneBounds?.width || 0,
            height: paneEl.clientHeight || paneBounds?.height || 0,
        }
        const visibleRect = getVisibleWorldRect(
            currentViewport,
            paneSize,
            VISIBILITY_MARGIN
        )
        const visibleNodeIds = new Set(
            spatialIndex.search(visibleRect).map((item: IndexedImage) => item.nodeId)
        )

        const tier = currentTier
        const verboseDebug = shouldBuildVerboseDebugPayloads()
        const changed: Record<string, unknown>[] = []
        const blankVisibleCandidates: PixiMediaDebugImageSnapshot[] = []
        let changedCount = 0
        let blankVisibleCandidateCount = 0
        debugLog('visibility-pass-start', (verbose) => ({
            paneSize,
            visibleRect,
            visibleNodeCount: visibleNodeIds.size,
            tier,
            entryCount: entries.size,
            ...(verbose ? { visibleNodeIds: [...visibleNodeIds] } : {}),
        }))
        for (const [nodeId, entry] of entries) {
            const before = {
                isVisible: entry.isVisible,
                spriteRenderable: entry.sprite.renderable,
                spriteVisible: entry.sprite.visible,
                colorRectRenderable: entry.colorRect.renderable,
                colorRectVisible: entry.colorRect.visible,
                loadedTier: entry.loadedTier,
                requestedTier: entry.requestedTier,
                textureKey: entry.textureKey,
            }
            const isVisible = visibleNodeIds.has(nodeId)
            const shouldRenderColorRect = isVisible && !shouldTreatImageEntryAsFramePending(entry)
            if (isVisible !== entry.isVisible) {
                entry.sprite.renderable = isVisible
                generatingBorderRenderer.setVisible(nodeId, isVisible)
                entry.isVisible = isVisible
            }
            entry.colorRect.renderable = shouldRenderColorRect
            // Only fetch/upload textures for sprites that are actually on
            // screen. Non-visible entries that may have a stale tier will
            // refresh lazily once they enter the viewport.
            if (isVisible) {
                ensureTextureForEntry(entry, tier)
            }
            const after = {
                isVisible: entry.isVisible,
                spriteRenderable: entry.sprite.renderable,
                spriteVisible: entry.sprite.visible,
                colorRectRenderable: entry.colorRect.renderable,
                colorRectVisible: entry.colorRect.visible,
                loadedTier: entry.loadedTier,
                requestedTier: entry.requestedTier,
                textureKey: entry.textureKey,
            }
            const entryChanged = before.isVisible !== after.isVisible
                || before.spriteRenderable !== after.spriteRenderable
                || before.spriteVisible !== after.spriteVisible
                || before.colorRectRenderable !== after.colorRectRenderable
                || before.colorRectVisible !== after.colorRectVisible
                || before.loadedTier !== after.loadedTier
                || before.requestedTier !== after.requestedTier
                || before.textureKey !== after.textureKey
            if (entryChanged) {
                changedCount += 1
            }
            if (entryChanged && verboseDebug) {
                changed.push({
                    nodeId,
                    before: {
                        ...before,
                        textureKey: cleanDebugUrl(before.textureKey),
                    },
                    after: {
                        ...after,
                        textureKey: cleanDebugUrl(after.textureKey),
                    },
                })
            }
            if (
                isVisible
                && entry.sprite.renderable
                && !entry.sprite.visible
                && entry.colorRect.renderable
                && !entry.colorRect.visible
                && entry.textureKey === null
                && entry.requestedTier === null
            ) {
                blankVisibleCandidateCount += 1
                if (verboseDebug) blankVisibleCandidates.push(getDebugEntrySnapshot(entry))
            }
        }
        debugLog('visibility-pass-end', (verbose) => ({
            changedCount,
            blankVisibleCandidateCount,
            ...(verbose ? { changed, blankVisibleCandidates, entries: getDebugEntrySnapshots() } : {}),
        }))
        if (blankVisibleCandidateCount > 0) {
            console.warn('[CANVAS][pixi-media]', 'blank-visible-candidates', {
                blankVisibleCandidateCount,
                entries: Array.from(entries.values())
                    .filter((entry) =>
                        entry.isVisible
                        && entry.sprite.renderable
                        && !entry.sprite.visible
                        && entry.colorRect.renderable
                        && !entry.colorRect.visible
                        && entry.textureKey === null
                        && entry.requestedTier === null
                    )
                    .map((entry) => getDebugEntrySummary(entry)),
            })
        }
    }

    // Idle-time prefetch — cache `thumb-256` for the entire workspace,
    // prioritized by world-distance from the viewport center so the user's
    // current focus area finishes first.
    //
    // 256-px PNGs are tiny (~10–30 KB each) so even a 5k-image workspace
    // fits comfortably within the texture-cache budget. The payoff is huge:
    // every subsequent zoom-out / pan reveals images that already have a
    // texture on the GPU, eliminating the load-flash that made the canvas
    // feel "absolutely atrocious" before.
    //
    // Visibility-driven loading still runs synchronously inside
    // `updateVisibleImages` so the user's actual focus area never waits
    // behind prefetch in the worker queue.
    function schedulePrefetch(): void {
        if (destroyed || health !== 'ready' || prefetchScheduled) {
            debugLog('prefetch-schedule-skipped', {
                destroyed,
                health,
                prefetchScheduled,
            })
            return
        }
        prefetchScheduled = true
        debugLog('prefetch-scheduled', {
            entryCount: entries.size,
        })
        scheduleIdle(() => {
            prefetchScheduled = false
            if (destroyed || health !== 'ready' || !lastState) {
                debugLog('prefetch-skipped', {
                    destroyed,
                    health,
                    hasLastState: Boolean(lastState),
                })
                return
            }

            // Center of the current viewport in world coordinates — used to
            // sort the prefetch order. Sprites near the user's focus get
            // cached first; far ones later.
            const cx = (-currentViewport.x + paneEl.clientWidth / 2) / (currentViewport.zoom || 1)
            const cy = (-currentViewport.y + paneEl.clientHeight / 2) / (currentViewport.zoom || 1)

            const candidates: { entry: PixiImageEntry; d2: number }[] = []
            for (const [, entry] of entries) {
                if (entry.loadedTier !== null || entry.requestedTier !== null) continue
                const ex = (entry.worldRect.minX + entry.worldRect.maxX) * 0.5
                const ey = (entry.worldRect.minY + entry.worldRect.maxY) * 0.5
                const dx = ex - cx
                const dy = ey - cy
                candidates.push({ entry, d2: dx * dx + dy * dy })
            }
            candidates.sort((a, b) => a.d2 - b.d2)
            debugLog('prefetch-candidates', (verbose) => ({
                center: { x: cx, y: cy },
                candidateCount: candidates.length,
                batch: verbose
                    ? candidates.slice(0, 20).map(({ entry, d2 }) => ({
                        nodeId: entry.nodeRef.nodeId,
                        d2,
                        entry: getDebugEntrySnapshot(entry),
                    }))
                    : candidates.slice(0, 20).map(({ entry, d2 }) => ({
                        nodeId: entry.nodeRef.nodeId,
                        d2,
                    })),
            }))

            // Process at most PREFETCH_BATCH_SIZE images per idle tick so one
            // callback can't queue thousands of concurrent decode requests.
            // Remaining candidates will be picked up on the next schedulePrefetch()
            // call (triggered by the next viewport change or sync).
            const PREFETCH_BATCH_SIZE = 20
            for (let i = 0; i < Math.min(candidates.length, PREFETCH_BATCH_SIZE); i++) {
                ensureTextureForEntry(candidates[i].entry, 'thumb-256')
            }
            // If more remain, schedule another idle pass.
            if (candidates.length > PREFETCH_BATCH_SIZE) {
                prefetchScheduled = false
                schedulePrefetch()
            }
        }, 1500)
    }

    function setSelectedImageNodes(_selectedNodeIds: Set<string>): void {
        if (destroyed) return
    }

    function setMarqueeRect(worldRect: { x: number; y: number; width: number; height: number } | null): void {
        if (destroyed) return
        if (!worldRect || !Number.isFinite(worldRect.width) || !Number.isFinite(worldRect.height) || worldRect.width <= 0 || worldRect.height <= 0) {
            hideForegroundGraphics(marqueeGraphics)
            scheduleRender()
            return
        }

        marqueeGraphics = getForegroundGraphics(marqueeGraphics, 'workspace-pixi-marquee')

        marqueeGraphics.roundRect(worldRect.x, worldRect.y, worldRect.width, worldRect.height, 8 / (currentViewport.zoom || 1))
        marqueeGraphics.fill({ color: selectionColors.marqueeFill })
        marqueeGraphics.stroke({ color: selectionColors.marqueeStroke, width: 1 / (currentViewport.zoom || 1) })

        scheduleRender()
    }

    function setPixiEdges(edges: PixiEdgeRenderDatum[]): void {
        if (destroyed) return
        latestPixiEdges = edges
        if (!edgeRenderer) return
        edgeRenderer.render(latestPixiEdges, currentViewport)
        scheduleRender()
    }

    function setSelectionOverlayBounds(worldBounds: { x: number; y: number; width: number; height: number } | null, options: SelectionOverlayOptions = {}): void {
        if (destroyed) return
        if (!worldBounds || !Number.isFinite(worldBounds.width) || !Number.isFinite(worldBounds.height) || worldBounds.width <= 0 || worldBounds.height <= 0) {
            hideForegroundGraphics(groupOverlayGraphics)
            scheduleRender()
            return
        }

        groupOverlayGraphics = getForegroundGraphics(groupOverlayGraphics, 'workspace-pixi-group-overlay')

        const r = 18 / (currentViewport.zoom || 1)
        groupOverlayGraphics.roundRect(worldBounds.x, worldBounds.y, worldBounds.width, worldBounds.height, r)
        if (options.fill !== false) groupOverlayGraphics.fill({ color: selectionColors.groupOverlayFill })
        groupOverlayGraphics.stroke({ color: selectionColors.groupOverlayStroke, width: 1 / (currentViewport.zoom || 1) })

        scheduleRender()
    }

    function getHealth(): PixiRendererHealth {
        return health
    }

    function destroy(): void {
        debugLog('destroy-start', (verbose) => ({
            wasReady: health === 'ready',
            entries: verbose ? getDebugEntrySnapshots() : entries.size,
            cache: getDebugCacheSnapshot(),
        }))
        const wasReady = health === 'ready'
        destroyed = true
        setHealth('destroyed')
        if (renderRaf !== null) {
            cancelAnimationFrame(renderRaf)
            renderRaf = null
        }
        if (visibilityRaf !== null) {
            cancelAnimationFrame(visibilityRaf)
            visibilityRaf = null
        }
        screenGlassBorderResizeObserver?.disconnect()
        observedScreenGlassBorderElements.clear()
        generatingBorderRenderer.destroy()
        glassBorderRenderer.destroy()
        generatingImageNodeOutlines.clear()
        mediaNodeRegistry.destroy()
        registryDispatchedNodes.clear()
        for (const [, entry] of entries) {
            releaseTexture(entry.textureKey)
            entry.sprite.mask = null
            entry.sprite.destroy()
            entry.spriteMask.destroy()
            entry.colorRect.destroy()
        }
        entries.clear()
        marqueeGraphics?.destroy()
        marqueeGraphics = null
        groupOverlayGraphics?.destroy()
        groupOverlayGraphics = null
        edgeRenderer?.destroy()
        edgeRenderer = null
        for (const [, entry] of textureCache) {
            entry.texture.destroy(true)
        }
        textureCache.clear()
        transientImageSources.clear()
        spatialIndex.clear()
        destroyPixiImageDecoder()
        hostEl.remove()
        if (wasReady) {
            app.destroy(true, { children: true, texture: false, textureSource: false })
        }
        debugLog('destroy-end', {
            wasReady,
            entries: entries.size,
            cache: getDebugCacheSnapshot(),
        })
    }

    return {
        sync,
        retryAssetTextures,
        setGeneratingImageNodes,
        setTransientImageSource,
        setViewport,
        setNodeLiveTransform,
        setSelectedImageNodes,
        setMarqueeRect,
        setSelectionOverlayBounds,
        setPixiEdges,
        renderNow,
        getHealth,
        // Caller (WorkspaceCanvas) registers handlers for non-image media via
        // the returned registry; videoLayer is exposed so handlers know which
        // PIXI Container to add their sprites to.
        getMediaNodeRegistry: () => mediaNodeRegistry,
        getVideoLayer: () => videoLayer,
        // Triggers another render through the rAF-coalesced scheduler. Video
        // handlers call this on each video frame so PIXI updates the texture.
        scheduleRender: () => scheduleRender(),
        destroy,
    }
}
