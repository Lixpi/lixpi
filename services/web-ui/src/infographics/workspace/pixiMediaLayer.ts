import {
    Application,
    Container,
    Graphics,
    Sprite,
    Texture,
} from 'pixi.js'
import RBush from 'rbush'
import type {
    CanvasState,
    ImageCanvasNode,
    CanvasViewport,
} from '@lixpi/constants'

import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { decodeImageInWorker, destroyPixiImageDecoder } from '$src/infographics/workspace/pixiImageDecoder.ts'
import {
    addPixiLodSizeParam,
    buildNodesById,
    buildPixiImageSrc,
    computeWorldPosition,
    getPixiLodTier,
    getVisibleWorldRect,
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
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'

type PixiImageEntry = {
    sprite: Sprite
    spriteMask: Graphics
    colorRect: Graphics
    nodeRef: ImageCanvasNode
    // Identity of the SOURCE image (workspace + fileId + src). When this
    // changes (e.g. user replaces the image), all loaded state is reset.
    sourceKey: string
    // Tier of the texture currently rendered on the sprite. `null` means no
    // texture has been loaded yet — the color placeholder is shown.
    loadedTier: LodTier | null
    // Tier of the in-flight texture request, or `null` when idle.
    requestedTier: LodTier | null
    // Bumped on every new request so stale completions can be ignored.
    requestId: number
    // URL of the texture currently bound to the sprite, or `null` when none.
    textureKey: string | null
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

export type SelectionColors = {
    marqueeStroke: string
    marqueeFill: string
    groupOverlayStroke: string
    groupOverlayFill: string
}

type SelectionOverlayOptions = {
    fill?: boolean
}

export type PixiMediaLayer = {
    sync: (canvasState: CanvasState | null) => void
    setViewport: (viewport: CanvasViewport) => void
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ) => void
    setSelectedImageNodes: (selectedNodeIds: Set<string>) => void
    setMarqueeRect: (worldRect: { x: number; y: number; width: number; height: number } | null) => void
    setSelectionOverlayBounds: (worldBounds: { x: number; y: number; width: number; height: number } | null, options?: SelectionOverlayOptions) => void
    setPixiEdges: (edges: PixiEdgeRenderDatum[]) => void
    renderNow: () => void
    getHealth: () => PixiRendererHealth
    destroy: () => void
}

type PixiMediaLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    getWorkspaceId: () => string
    selectionColors: SelectionColors
    onImageIntrinsicSize?: (size: { nodeId: string; width: number; height: number }) => void
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
        }, 30_000)
    }
    return tokenPromise
}

async function resolveImageSrc(node: ImageCanvasNode, workspaceId: string): Promise<string> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
    const resolvedSrc = resolveStoredImagePath(node, workspaceId)
    const token = await getSharedToken()
    return buildPixiImageSrc(resolvedSrc, API_BASE_URL, token)
}

export function createPixiMediaLayer(options: PixiMediaLayerOptions): PixiMediaLayer {
    const { paneEl, viewportEl, getWorkspaceId, selectionColors, onImageIntrinsicSize, onHealthChange } = options

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
    const fgLayer = new Container({ label: 'workspace-pixi-fg' })
    const edgeLayer = new Container({ label: 'workspace-pixi-edges' })
    const entries = new Map<string, PixiImageEntry>()
    let edgeRenderer: PixiEdgeRenderer | null = null
    const textureCache = new Map<string, TextureEntry>()
    const spatialIndex = new RBush<IndexedImage>()
    const pixiOwnedNodeIds = new Set<string>()
    // Cached element refs keyed by nodeId. A single querySelectorAll on every
    // sync is dramatically cheaper than per-node querySelector(`[data-node-id]`)
    // calls during upsert.
    const nodeElCache = new Map<string, HTMLElement>()
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

    function setHealth(next: PixiRendererHealth): void {
        if (health === next) return
        health = next
        onHealthChange?.(next)
    }

    void (async () => {
        try {
            await app.init({
                preference: 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                resizeTo: paneEl,
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
            })

            // Keep the ticker stopped so it never auto-renders behind our backs.
            app.ticker.stop()

            if (destroyed) {
                app.destroy(true, { children: true, texture: true, textureSource: true })
                return
            }

            app.stage.addChild(edgeLayer)
            app.stage.addChild(world)
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
            sync(lastState)
            scheduleRender()
        } catch (error) {
            console.error('[PixiMediaLayer] Failed to initialize PIXI media layer.', error)
            throw error
        }
    })()

    function setViewport(viewport: CanvasViewport): void {
        if (destroyed) return
        currentViewport = viewport
        // Tier is recomputed on every viewport change so newly visible
        // sprites get the right tier on demand. Sprites that already have a
        // higher-or-equal tier loaded are NEVER re-fetched (mipmaps in the
        // PIXI texture handle GPU-side downsampling for free).
        currentTier = getPixiLodTier(viewport.zoom)
        world.position.set(viewport.x, viewport.y)
        world.scale.set(viewport.zoom, viewport.zoom)
        edgeRenderer?.render(latestPixiEdges, viewport)
        // Visibility update is rAF-coalesced so a 60Hz wheel-zoom doesn't
        // run the spatial-index scan + per-entry iteration 60 times per
        // second — once per frame is enough.
        scheduleVisibilityUpdate()
        schedulePrefetch()
        scheduleRender()
    }

    function scheduleVisibilityUpdate(): void {
        if (destroyed || visibilityRaf !== null) return
        visibilityRaf = requestAnimationFrame(() => {
            visibilityRaf = null
            if (destroyed) return
            updateVisibleImages()
        })
    }

    function refreshNodeElCache(): void {
        nodeElCache.clear()
        const all = viewportEl.querySelectorAll<HTMLElement>('[data-node-id]')
        for (const el of all) {
            const id = el.dataset.nodeId
            if (id) nodeElCache.set(id, el)
        }
    }

    function getNodeEl(nodeId: string): HTMLElement | null {
        const cached = nodeElCache.get(nodeId)
        if (cached && cached.isConnected) return cached
        // Fall back to a one-shot query if the cache is stale (e.g. a node
        // was just appended after the most recent sync).
        const el = viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
        if (el) nodeElCache.set(nodeId, el)
        return el
    }

    function setPixiOwnedClass(nodeId: string, owned: boolean): void {
        const el = getNodeEl(nodeId)
        if (!el) return
        el.classList.toggle('workspace-image-node-pixi-owned', owned)
    }

    function sync(canvasState: CanvasState | null): void {
        lastState = canvasState
        // Refresh DOM element cache once per sync. All subsequent per-node
        // calls (setDomOwnership, etc.) read from the cache rather than
        // querying the DOM.
        refreshNodeElCache()
        syncDomOwnership(canvasState)
        if (!canvasState || health !== 'ready' || destroyed) return

        // On workspace switch the external setViewport call arrives after sync.
        // Apply the state's viewport directly so culling and world transform are
        // correct before any sprites are positioned or made renderable.
        const vp = canvasState.viewport
        if (vp.x !== currentViewport.x || vp.y !== currentViewport.y || vp.zoom !== currentViewport.zoom) {
            currentViewport = vp
            currentTier = getPixiLodTier(vp.zoom)
            world.position.set(vp.x, vp.y)
            world.scale.set(vp.zoom, vp.zoom)
            edgeRenderer?.render(latestPixiEdges, vp)
        }

        const imageNodes = canvasState.nodes.filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
        const activeIds = new Set<string>(imageNodes.map((node: ImageCanvasNode) => node.nodeId))

        for (const [nodeId, entry] of entries) {
            if (!activeIds.has(nodeId)) {
                setDomOwnership(nodeId, false)
                releaseTexture(entry.textureKey)
                // Remove from spatial index before destroying the entry.
                spatialIndex.remove(entry.worldRect, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
                world.removeChild(entry.sprite)
                world.removeChild(entry.spriteMask)
                world.removeChild(entry.colorRect)
                entry.sprite.mask = null
                entry.sprite.destroy()
                entry.spriteMask.destroy()
                entry.colorRect.destroy()
                entries.delete(nodeId)
            }
        }

        upsertAllEntries(canvasState)
        // Single visibility pass loads textures for visible entries only.
        updateVisibleImages()
        schedulePrefetch()
        scheduleRender()
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

    function scheduleRender(): void {
        if (destroyed || health !== 'ready') return
        if (renderRaf !== null) return
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null
            if (destroyed || health !== 'ready') return
            app.render()
        })
    }

    function renderNow(): void {
        if (destroyed || health !== 'ready') return
        if (renderRaf !== null) {
            cancelAnimationFrame(renderRaf)
            renderRaf = null
        }
        app.render()
    }

    function destroyForegroundGraphics(graphics: Graphics | null): null {
        if (!graphics) return null
        graphics.parent?.removeChild(graphics)
        graphics.destroy()
        return null
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
        const entry = entries.get(nodeId)
        if (!entry) return

        const x = worldPosition.x
        const y = worldPosition.y
        const w = dimensions.width
        const h = dimensions.height

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

        spatialIndex.remove(entry.worldRect, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
        const newRect: IndexedImage = { minX: x, minY: y, maxX: x + w, maxY: y + h, nodeId }
        entry.worldRect = newRect
        spatialIndex.insert(newRect)

        scheduleRender()
    }

    function syncDomOwnership(canvasState: CanvasState | null): void {
        const nextImageNodeIds = new Set<string>(
            canvasState?.nodes
                .filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
                .map((node: ImageCanvasNode) => node.nodeId) ?? []
        )

        for (const nodeId of pixiOwnedNodeIds) {
            if (!nextImageNodeIds.has(nodeId)) {
                setDomOwnership(nodeId, false)
            }
        }

        for (const nodeId of nextImageNodeIds) {
            setDomOwnership(nodeId, true)
        }
    }

    function setDomOwnership(nodeId: string, owned: boolean): void {
        setPixiOwnedClass(nodeId, owned)
        if (owned) {
            pixiOwnedNodeIds.add(nodeId)
        } else {
            pixiOwnedNodeIds.delete(nodeId)
        }
    }

    function releaseAllDomOwnership(): void {
        for (const nodeId of pixiOwnedNodeIds) {
            setPixiOwnedClass(nodeId, false)
        }
        pixiOwnedNodeIds.clear()
    }

    function makeSourceKey(node: ImageCanvasNode): string {
        return `${getWorkspaceId()}|${node.fileId}|${node.src}`
    }

    function getImageBorderRadius(width: number, height: number): number {
        const borderRadius = webUiThemeSettings.imageNode.borderRadius
        if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
        return Math.min(borderRadius, width / 2, height / 2)
    }

    function syncSpriteMask(entry: PixiImageEntry, x: number, y: number, width: number, height: number): void {
        const radius = getImageBorderRadius(width, height)
        entry.spriteMask.position.set(x, y)
        if (width === entry.spriteMaskW && height === entry.spriteMaskH && radius === entry.spriteMaskRadius) return

        entry.spriteMask.clear()
        entry.spriteMask.roundRect(0, 0, width, height, radius)
        entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })
        entry.spriteMaskW = width
        entry.spriteMaskH = height
        entry.spriteMaskRadius = radius
    }

    function upsertEntry(node: ImageCanvasNode, worldPosition: WorldPosition): void {
        const newSourceKey = makeSourceKey(node)
        let entry = entries.get(node.nodeId)

        if (!entry) {
            const sprite = new Sprite(Texture.EMPTY)
            sprite.label = `pixi-image-${node.nodeId}`
            sprite.eventMode = 'none'
            sprite.visible = false
            const spriteMask = new Graphics()
            spriteMask.label = `pixi-image-mask-${node.nodeId}`
            spriteMask.eventMode = 'none'
            sprite.mask = spriteMask
            const colorRect = new Graphics()
            colorRect.label = `pixi-image-color-${node.nodeId}`
            colorRect.eventMode = 'none'
            world.addChild(sprite)
            world.addChild(spriteMask)
            world.addChild(colorRect)
            const rect = makeIndexedImage(node, worldPosition)
            entry = {
                sprite,
                spriteMask,
                colorRect,
                nodeRef: node,
                sourceKey: newSourceKey,
                loadedTier: null,
                requestedTier: null,
                requestId: 0,
                textureKey: null,
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
            // DOM ownership is new — always set.
            setDomOwnership(node.nodeId, true)
        } else if (entry.sourceKey !== newSourceKey) {
            // Source image replaced. Drop loaded state; next visibility pass refetches.
            if (entry.textureKey) releaseTexture(entry.textureKey)
            entry.textureKey = null
            entry.loadedTier = null
            entry.requestedTier = null
            entry.requestId++
            entry.sprite.texture = Texture.EMPTY
            entry.sourceKey = newSourceKey
        }

        entry.nodeRef = node

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
            spatialIndex.remove(old, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
            const newRect = makeIndexedImage(node, worldPosition)
            entry.worldRect = newRect
            spatialIndex.insert(newRect)
        }

        // DOM ownership — skip classList.toggle when already in the right state.
        if (!pixiOwnedNodeIds.has(node.nodeId)) {
            setDomOwnership(node.nodeId, true)
        }
        // IMPORTANT: do NOT trigger texture loading here. Texture loading is
        // driven by visibility (updateVisibleImages / ensureTextureForEntry).
    }

    function drawColorRect(rect: Graphics, width: number, height: number): void {
        rect.clear()
        rect.roundRect(0, 0, width, height, getImageBorderRadius(width, height))
        rect.fill({ color: 0xe7eaee, alpha: 0.85 })
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
        if (desiredTier === 'color') {
            // Extreme zoom-out: tinted rectangle suffices. Keep any existing
            // texture cached on the sprite for when the user zooms back in.
            entry.sprite.visible = entry.loadedTier !== null
            entry.colorRect.visible = entry.loadedTier === null
            return
        }

        // Rule 1: never downgrade. Mipmaps make a full-res texture render
        // perfectly at any zoom; refetching a smaller LoD is pure waste and
        // is exactly what made zoom-out feel sluggish.
        if (entry.loadedTier !== null && tierRank(entry.loadedTier) >= tierRank(desiredTier)) {
            entry.sprite.visible = true
                            syncSpriteMask(entry, entry.worldRect.minX, entry.worldRect.minY, entry.nodeRef.dimensions.width, entry.nodeRef.dimensions.height)
            entry.colorRect.visible = false
            return
        }

        // Rule 2: a request is already in flight.
        if (entry.requestedTier !== null) {
            if (tierRank(entry.requestedTier) >= tierRank(desiredTier)) {
                // In-flight request already covers our needs.
                return
            }
            // In-flight is a lower tier (typically the progressive thumb-256
            // first step). Don't race the network with a duplicate fetch —
            // schedule an idle upgrade and let the in-flight one finish.
            scheduleProgressiveUpgrade(entry, desiredTier)
            return
        }

        // Rule 3: progressive `thumb-256`-first when we have nothing yet.
        // 256px PNGs are tiny (~10–30KB) so the entire workspace can paint a
        // recognizable preview in well under a second, then upgrade in idle
        // time. This is the single most impactful change for first-paint.
        const fetchTier: LodTier = (entry.loadedTier === null && desiredTier !== 'thumb-256')
            ? 'thumb-256'
            : desiredTier

        entry.requestedTier = fetchTier
        entry.requestId = ++requestCounter
        const requestId = entry.requestId

        const hasTexture = entry.textureKey !== null
        if (!hasTexture) {
            entry.sprite.visible = false
            entry.colorRect.visible = true
        }

        const node = entry.nodeRef

        void (async () => {
            let acquiredKey: string | null = null
            try {
                const url = await resolveImageSrc(node, getWorkspaceId())
                const resolved = addPixiLodSizeParam(url, fetchTier)
                const texture = await acquireTexture(resolved)
                acquiredKey = resolved
                if (destroyed || entry.requestId !== requestId) {
                    releaseTexture(resolved)
                    return
                }
                // Don't downgrade if a parallel request already loaded a higher tier.
                if (entry.loadedTier !== null && tierRank(entry.loadedTier) > tierRank(fetchTier)) {
                    releaseTexture(resolved)
                    entry.requestedTier = null
                    return
                }
                const oldKey = entry.textureKey
                entry.textureKey = resolved
                entry.loadedTier = fetchTier
                entry.requestedTier = null
                entry.sprite.texture = texture
                if (Number.isFinite(texture.width) && Number.isFinite(texture.height) && texture.width > 0 && texture.height > 0) {
                    onImageIntrinsicSize?.({ nodeId: node.nodeId, width: texture.width, height: texture.height })
                }
                entry.sprite.position.set(entry.worldRect.minX, entry.worldRect.minY)
                entry.sprite.width = entry.nodeRef.dimensions.width
                entry.sprite.height = entry.nodeRef.dimensions.height
                syncSpriteMask(entry, entry.worldRect.minX, entry.worldRect.minY, entry.nodeRef.dimensions.width, entry.nodeRef.dimensions.height)
                entry.sprite.visible = true
                entry.colorRect.visible = false
                if (oldKey && oldKey !== resolved) releaseTexture(oldKey)
                scheduleRender()

                // If the user actually wants a higher tier than we just loaded,
                // schedule a background upgrade in an idle slot. The user sees
                // the preview now and gets sharper pixels later, with no
                // blocking on the critical path.
                if (tierRank(desiredTier) > tierRank(fetchTier)) {
                    scheduleProgressiveUpgrade(entry, desiredTier)
                }
            } catch (error) {
                console.error('[PixiMediaLayer] Failed to load image texture.', error)
                if (acquiredKey) releaseTexture(acquiredKey)
                if (entry.requestId === requestId) {
                    entry.requestedTier = null
                    if (!hasTexture) {
                        entry.sprite.visible = false
                        entry.colorRect.visible = true
                    }
                    scheduleRender()
                }
            }
        })()
    }

    function scheduleProgressiveUpgrade(entry: PixiImageEntry, targetTier: LodTier): void {
        if (destroyed) return
        scheduleIdle(() => {
            if (destroyed) return
            // Skip if entry is no longer visible OR already has equal/better tier
            // OR another request has already taken over.
            if (!entry.isVisible) return
            if (entry.loadedTier !== null && tierRank(entry.loadedTier) >= tierRank(targetTier)) return
            if (entry.requestedTier !== null && tierRank(entry.requestedTier) >= tierRank(targetTier)) return
            ensureTextureForEntry(entry, targetTier)
        }, 2000)
    }

    async function acquireTexture(url: string): Promise<Texture> {
        const cached = textureCache.get(url)
        if (cached) {
            cached.refCount++
            cached.lastUsed = ++textureClock
            return cached.texture
        }

        const bitmap = await decodeImageInWorker(url)
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
        return texture
    }

    function releaseTexture(url: string | null): void {
        if (!url) return
        const entry = textureCache.get(url)
        if (!entry) return
        entry.refCount = Math.max(0, entry.refCount - 1)
    }

    function evictTextures(): void {
        if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) return

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
        }

        if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) return

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
                }
            }
        }
    }

    // Drive sprite renderable flags + texture loading from spatial-index
    // visibility. Visible entries fetch on demand; non-visible entries keep
    // any cached texture they have. This is the hot path during pan/zoom so
    // it is intentionally lean: spatial index search + map iteration only.
    function updateVisibleImages(): void {
        if (health !== 'ready' || !lastState || destroyed) return
        const paneBounds = paneEl.clientWidth > 0 && paneEl.clientHeight > 0
            ? null
            : paneEl.getBoundingClientRect()
        const visibleRect = getVisibleWorldRect(
            currentViewport,
            {
                width: paneEl.clientWidth || paneBounds?.width || 0,
                height: paneEl.clientHeight || paneBounds?.height || 0,
            },
            VISIBILITY_MARGIN
        )
        const visibleNodeIds = new Set(
            spatialIndex.search(visibleRect).map((item: IndexedImage) => item.nodeId)
        )

        const tier = currentTier
        for (const [nodeId, entry] of entries) {
            const isVisible = visibleNodeIds.has(nodeId)
            if (isVisible !== entry.isVisible) {
                entry.sprite.renderable = isVisible
                entry.colorRect.renderable = isVisible
                entry.isVisible = isVisible
            }
            // Only fetch/upload textures for sprites that are actually on
            // screen. Non-visible entries that may have a stale tier will
            // refresh lazily once they enter the viewport.
            if (isVisible) {
                ensureTextureForEntry(entry, tier)
            }
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
        if (destroyed || health !== 'ready' || prefetchScheduled) return
        prefetchScheduled = true
        scheduleIdle(() => {
            prefetchScheduled = false
            if (destroyed || health !== 'ready' || !lastState) return

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
            marqueeGraphics = destroyForegroundGraphics(marqueeGraphics)
            scheduleRender()
            return
        }

        marqueeGraphics = destroyForegroundGraphics(marqueeGraphics)
        marqueeGraphics = new Graphics()
        fgLayer.addChild(marqueeGraphics)

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
            groupOverlayGraphics = destroyForegroundGraphics(groupOverlayGraphics)
            scheduleRender()
            return
        }

        groupOverlayGraphics = destroyForegroundGraphics(groupOverlayGraphics)
        groupOverlayGraphics = new Graphics()
        fgLayer.addChild(groupOverlayGraphics)

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
        for (const [nodeId, entry] of entries) {
            setDomOwnership(nodeId, false)
            releaseTexture(entry.textureKey)
            entry.sprite.mask = null
            entry.sprite.destroy()
            entry.spriteMask.destroy()
            entry.colorRect.destroy()
        }
        releaseAllDomOwnership()
        entries.clear()
        nodeElCache.clear()
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
        spatialIndex.clear()
        destroyPixiImageDecoder()
        hostEl.remove()
        if (wasReady) {
            app.destroy(true, { children: true, texture: false, textureSource: false })
        }
    }

    return {
        sync,
        setViewport,
        setNodeLiveTransform,
        setSelectedImageNodes,
        setMarqueeRect,
        setSelectionOverlayBounds,
        setPixiEdges,
        renderNow,
        getHealth,
        destroy,
    }
}
