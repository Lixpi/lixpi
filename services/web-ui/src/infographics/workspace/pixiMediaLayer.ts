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
    type IndexedImage,
    type LodTier,
    type PixiRendererHealth,
    type WorldPosition,
} from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

type PixiImageEntry = {
    sprite: Sprite
    colorRect: Graphics
    srcKey: string
    requestId: number
    textureKey: string | null
    worldRect: IndexedImage
}

type TextureEntry = {
    texture: Texture
    bytes: number
    refCount: number
    lastUsed: number
}

export type PixiMediaLayer = {
    sync: (canvasState: CanvasState | null) => void
    setViewport: (viewport: CanvasViewport) => void
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ) => void
    destroy: () => void
}

type PixiMediaLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    getWorkspaceId: () => string
}

const CULLING_MARGIN = 800
const MAX_TEXTURES = 256
const MAX_TEXTURE_BYTES = 512 * 1024 * 1024

async function resolveImageSrc(node: ImageCanvasNode, workspaceId: string): Promise<string> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
    const resolvedSrc = resolveStoredImagePath(node, workspaceId)
    const token = await AuthService.getTokenSilently()
    return buildPixiImageSrc(resolvedSrc, API_BASE_URL, token || false)
}

function setPixiOwned(viewportEl: HTMLDivElement, nodeId: string, owned: boolean): void {
    const nodeEl = viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
    if (!nodeEl) return
    nodeEl.classList.toggle('workspace-image-node--pixi-owned', owned)
}

export function createPixiMediaLayer(options: PixiMediaLayerOptions): PixiMediaLayer {
    const { paneEl, viewportEl, getWorkspaceId } = options

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
    const entries = new Map<string, PixiImageEntry>()
    const textureCache = new Map<string, TextureEntry>()
    const spatialIndex = new RBush<IndexedImage>()
    const pixiOwnedNodeIds = new Set<string>()
    let textureBytes = 0
    let textureClock = 0
    let destroyed = false
    let health: PixiRendererHealth = 'initializing'
    let lastState: CanvasState | null = null
    let requestCounter = 0
    let currentViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
    let currentTier: LodTier = getPixiLodTier(currentViewport.zoom)

    void (async () => {
        try {
            await app.init({
                preference: 'webgpu',
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                resizeTo: paneEl,
                webgpu: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
                webgl: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
            })

            if (destroyed) {
                app.destroy(true, { children: true, texture: true, textureSource: true })
                return
            }

            app.stage.addChild(world)
            hostEl.appendChild(app.canvas)
            applyStyle(app.canvas as HTMLCanvasElement, {
                position: 'absolute',
                inset: '0',
                width: '100%',
                height: '100%',
            })
            world.position.set(currentViewport.x, currentViewport.y)
            world.scale.set(currentViewport.zoom, currentViewport.zoom)
            health = 'ready'
            sync(lastState)
            renderNow()
        } catch (error) {
            console.error('[PixiMediaLayer] Failed to initialize PIXI media layer.', error)
            health = 'failed'
            releaseAllDomOwnership()
        }
    })()

    function setViewport(viewport: CanvasViewport): void {
        if (destroyed) return
        currentViewport = viewport
        const nextTier = getPixiLodTier(viewport.zoom)
        const tierChanged = nextTier !== currentTier
        currentTier = nextTier
        world.position.set(viewport.x, viewport.y)
        world.scale.set(viewport.zoom, viewport.zoom)
        if (tierChanged && lastState && health === 'ready') {
            upsertAllImages(lastState)
        }
        updateVisibleImages()
        renderNow()
    }

    function upsertAllImages(canvasState: CanvasState): void {
        spatialIndex.clear()
        const nodesById = buildNodesById(canvasState.nodes)
        const imageNodes = canvasState.nodes.filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
        for (const node of imageNodes) {
            upsertImage(node, computeWorldPosition(node, nodesById))
        }
    }

    function sync(canvasState: CanvasState | null): void {
        lastState = canvasState
        syncDomOwnership(canvasState)
        if (!canvasState || health !== 'ready' || destroyed) return

        const imageNodes = canvasState.nodes.filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
        const activeIds = new Set<string>(imageNodes.map((node: ImageCanvasNode) => node.nodeId))

        for (const [nodeId, entry] of entries) {
            if (!activeIds.has(nodeId)) {
                setDomOwnership(nodeId, false)
                releaseTexture(entry.textureKey)
                world.removeChild(entry.sprite)
                world.removeChild(entry.colorRect)
                entry.sprite.destroy()
                entry.colorRect.destroy()
                entries.delete(nodeId)
            }
        }

        upsertAllImages(canvasState)
        updateVisibleImages()
        renderNow()
    }

    function renderNow(): void {
        if (health !== 'ready' || destroyed) return
        app.render()
    }

    // Live drag/resize updates push the new world position straight to the
    // sprite without going through `sync`, so the PIXI pixels stay locked
    // to the DOM hitbox during interaction. Once the gesture commits and
    // `sync` runs with the final canvas state, the sprite is re-positioned
    // from the same source of truth as the DOM.
    function setNodeLiveTransform(
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ): void {
        if (destroyed) return
        const entry = entries.get(nodeId)
        if (!entry) return

        entry.sprite.position.set(worldPosition.x, worldPosition.y)
        entry.sprite.width = dimensions.width
        entry.sprite.height = dimensions.height
        entry.colorRect.position.set(worldPosition.x, worldPosition.y)
        drawColorRect(entry.colorRect, dimensions.width, dimensions.height)

        spatialIndex.remove(entry.worldRect, (a: IndexedImage, b: IndexedImage) => a.nodeId === b.nodeId)
        const newRect: IndexedImage = {
            minX: worldPosition.x,
            minY: worldPosition.y,
            maxX: worldPosition.x + dimensions.width,
            maxY: worldPosition.y + dimensions.height,
            nodeId,
        }
        entry.worldRect = newRect
        spatialIndex.insert(newRect)

        updateVisibleImages()
        renderNow()
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
        setPixiOwned(viewportEl, nodeId, owned)
        if (owned) {
            pixiOwnedNodeIds.add(nodeId)
        } else {
            pixiOwnedNodeIds.delete(nodeId)
        }
    }

    function releaseAllDomOwnership(): void {
        for (const nodeId of pixiOwnedNodeIds) {
            setPixiOwned(viewportEl, nodeId, false)
        }
        pixiOwnedNodeIds.clear()
    }

    function upsertImage(node: ImageCanvasNode, worldPosition: WorldPosition): void {
        let entry = entries.get(node.nodeId)
        if (!entry) {
            const sprite = new Sprite(Texture.EMPTY)
            sprite.label = `pixi-image-${node.nodeId}`
            sprite.eventMode = 'none'
            sprite.visible = false
            const colorRect = new Graphics()
            colorRect.label = `pixi-image-color-${node.nodeId}`
            colorRect.eventMode = 'none'
            world.addChild(sprite)
            world.addChild(colorRect)
            entry = {
                sprite,
                colorRect,
                srcKey: '',
                requestId: 0,
                textureKey: null,
                worldRect: makeIndexedImage(node, worldPosition),
            }
            entries.set(node.nodeId, entry)
        }

        entry.sprite.position.set(worldPosition.x, worldPosition.y)
        entry.sprite.width = node.dimensions.width
        entry.sprite.height = node.dimensions.height
        entry.colorRect.position.set(worldPosition.x, worldPosition.y)
        drawColorRect(entry.colorRect, node.dimensions.width, node.dimensions.height)
        entry.worldRect = makeIndexedImage(node, worldPosition)
        spatialIndex.insert(entry.worldRect)
        setDomOwnership(node.nodeId, true)

        const tier = currentTier
        if (tier === 'color') {
            entry.sprite.visible = false
            entry.colorRect.visible = true
            releaseTexture(entry.textureKey)
            entry.textureKey = null
            return
        }

        const srcKey = `${getWorkspaceId()}|${node.fileId}|${node.src}|${tier}`
        if (entry.srcKey === srcKey) return

        entry.srcKey = srcKey
        entry.requestId = ++requestCounter
        const requestId = entry.requestId

        // Keep the existing texture (if any) visible while the new tier loads.
        // Only show the color placeholder when no texture has been resolved yet.
        const hasExistingTexture = entry.textureKey !== null
        entry.sprite.visible = hasExistingTexture
        entry.colorRect.visible = !hasExistingTexture

        void (async () => {
            try {
                const resolved = addPixiLodSizeParam(await resolveImageSrc(node, getWorkspaceId()), tier)
                const texture = await acquireTexture(resolved)
                if (destroyed || entry?.requestId !== requestId) return
                releaseTexture(entry.textureKey)
                entry.textureKey = resolved
                entry.sprite.texture = texture
                entry.sprite.width = node.dimensions.width
                entry.sprite.height = node.dimensions.height
                entry.sprite.visible = true
                entry.colorRect.visible = false
                renderNow()
            } catch (error) {
                console.error('[PixiMediaLayer] Failed to load image texture.', error)
                if (entry?.requestId === requestId) {
                    entry.srcKey = ''
                    if (!hasExistingTexture) {
                        entry.sprite.visible = false
                        entry.colorRect.visible = true
                    }
                    renderNow()
                }
            }
        })()
    }

    function drawColorRect(rect: Graphics, width: number, height: number): void {
        rect.clear()
        rect.roundRect(0, 0, width, height, 4)
        rect.fill({ color: 0xe7eaee, alpha: 0.85 })
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

        const candidates = Array.from(textureCache.entries())
            .filter(([, entry]) => entry.refCount === 0)
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

        for (const [key, entry] of candidates) {
            if (textureCache.size <= MAX_TEXTURES && textureBytes <= MAX_TEXTURE_BYTES) break
            textureCache.delete(key)
            textureBytes -= entry.bytes
            entry.texture.destroy(true)
        }
    }

    function updateVisibleImages(): void {
        if (health !== 'ready' || !lastState) return
        const visibleRect = getVisibleWorldRect(
            currentViewport,
            { width: paneEl.clientWidth, height: paneEl.clientHeight },
            CULLING_MARGIN
        )
        const visible = new Set(
            spatialIndex.search(visibleRect).map((item: IndexedImage) => item.nodeId)
        )

        for (const [nodeId, entry] of entries) {
            const isVisible = visible.has(nodeId)
            entry.sprite.renderable = isVisible
            entry.colorRect.renderable = isVisible
        }
    }

    function destroy(): void {
        const wasReady = health === 'ready'
        destroyed = true
        health = 'destroyed'
        for (const [nodeId, entry] of entries) {
            setDomOwnership(nodeId, false)
            releaseTexture(entry.textureKey)
            entry.sprite.destroy()
            entry.colorRect.destroy()
        }
        releaseAllDomOwnership()
        entries.clear()
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
        destroy,
    }
}
