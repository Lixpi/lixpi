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

type IndexedImage = {
    minX: number
    minY: number
    maxX: number
    maxY: number
    nodeId: string
}

type LodTier = 'color' | 'thumb-256' | 'thumb-1024' | 'full'

export type PixiMediaLayer = {
    sync: (canvasState: CanvasState | null) => void
    setViewport: (viewport: CanvasViewport) => void
    destroy: () => void
}

type PixiMediaLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    getWorkspaceId: () => string
}

const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const CULLING_MARGIN = 800
const MAX_TEXTURES = 256
const MAX_TEXTURE_BYTES = 512 * 1024 * 1024

function buildImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
    if (!imageUrl) return transparentPixel
    if (imageUrl.startsWith('data:')) return imageUrl
    if (imageUrl.startsWith('/api/')) return `${apiBaseUrl}${imageUrl}${token ? `?token=${token}` : ''}`
    return imageUrl
}

function isStoredImageSrc(src: string): boolean {
    const stripped = src.replace(/[?&]token=[^&]+/, '')
    return stripped.startsWith('/api/') || (stripped.startsWith('http') && stripped.includes('/api/images/'))
}

async function resolveImageSrc(node: ImageCanvasNode, workspaceId: string): Promise<string> {
    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
    const strippedSrc = node.src.replace(/[?&]token=[^&]+/, '')
    const resolvedSrc = isStoredImageSrc(strippedSrc)
        ? `/api/images/${workspaceId}/${node.fileId}`
        : strippedSrc
    const token = await AuthService.getTokenSilently()
    return buildImageSrc(resolvedSrc, API_BASE_URL, token || false)
}

function getLodTier(zoom: number): LodTier {
    if (zoom < 0.1) return 'color'
    if (zoom < 0.4) return 'thumb-256'
    if (zoom < 1) return 'thumb-1024'
    return 'full'
}

function addLodSizeParam(url: string, tier: LodTier): string {
    if (tier === 'full' || tier === 'color') return url
    if (!url.includes('/api/images/')) return url

    try {
        const parsed = new URL(url, window.location.origin)
        parsed.searchParams.set('size', tier === 'thumb-256' ? '256' : '1024')
        return parsed.toString()
    } catch {
        return url
    }
}

function makeIndexedImage(node: ImageCanvasNode): IndexedImage {
    return {
        minX: node.position.x,
        minY: node.position.y,
        maxX: node.position.x + node.dimensions.width,
        maxY: node.position.y + node.dimensions.height,
        nodeId: node.nodeId,
    }
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
        zIndex: '0',
        overflow: 'hidden',
    }
    const hostEl = html`<div className="workspace-pixi-media-layer" style=${hostStyle}></div>` as HTMLDivElement
    paneEl.insertBefore(hostEl, viewportEl)

    const app = new Application()
    const world = new Container({ label: 'workspace-pixi-media-world' })
    const entries = new Map<string, PixiImageEntry>()
    const textureCache = new Map<string, TextureEntry>()
    const spatialIndex = new RBush<IndexedImage>()
    let textureBytes = 0
    let textureClock = 0
    let destroyed = false
    let ready = false
    let lastState: CanvasState | null = null
    let requestCounter = 0
    let currentViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }
    let currentTier: LodTier = getLodTier(currentViewport.zoom)

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
            ready = true
            sync(lastState)
        } catch (error) {
            console.error('[PixiMediaLayer] Failed to initialize PIXI media layer.', error)
            ready = false
        }
    })()

    function setViewport(viewport: CanvasViewport): void {
        currentViewport = viewport
        const nextTier = getLodTier(viewport.zoom)
        const tierChanged = nextTier !== currentTier
        currentTier = nextTier
        world.position.set(viewport.x, viewport.y)
        world.scale.set(viewport.zoom, viewport.zoom)
        if (tierChanged && lastState && ready && !destroyed) {
            sync(lastState)
            return
        }
        updateVisibleImages()
    }

    function sync(canvasState: CanvasState | null): void {
        lastState = canvasState
        syncOwnership(canvasState)
        if (!ready || destroyed || !canvasState) return

        setViewport(canvasState.viewport)
        const imageNodes = canvasState.nodes.filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
        const activeIds = new Set<string>(imageNodes.map((node: ImageCanvasNode) => node.nodeId))

        for (const [nodeId, entry] of entries) {
            if (!activeIds.has(nodeId)) {
                setPixiOwned(viewportEl, nodeId, false)
                releaseTexture(entry.textureKey)
                world.removeChild(entry.sprite)
                world.removeChild(entry.colorRect)
                entry.sprite.destroy()
                entry.colorRect.destroy()
                entries.delete(nodeId)
            }
        }

        spatialIndex.clear()
        for (const node of imageNodes) {
            upsertImage(node)
        }
        updateVisibleImages()
    }

    function syncOwnership(canvasState: CanvasState | null): void {
        const imageNodeIds = new Set<string>(
            canvasState?.nodes
                .filter((node: CanvasState['nodes'][number]): node is ImageCanvasNode => node.type === 'image')
                .map((node: ImageCanvasNode) => node.nodeId) ?? []
        )

        for (const nodeId of imageNodeIds) {
            setPixiOwned(viewportEl, nodeId, true)
        }
    }

    function upsertImage(node: ImageCanvasNode): void {
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
                worldRect: makeIndexedImage(node),
            }
            entries.set(node.nodeId, entry)
        }

        setPixiOwned(viewportEl, node.nodeId, true)

        entry.sprite.position.set(node.position.x, node.position.y)
        entry.sprite.width = node.dimensions.width
        entry.sprite.height = node.dimensions.height
        entry.colorRect.position.set(node.position.x, node.position.y)
        drawColorRect(entry.colorRect, node.dimensions.width, node.dimensions.height)
        entry.worldRect = makeIndexedImage(node)
        spatialIndex.insert(entry.worldRect)

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
        entry.sprite.visible = false
        entry.colorRect.visible = true

        void (async () => {
            try {
                const resolved = addLodSizeParam(await resolveImageSrc(node, getWorkspaceId()), tier)
                const texture = await acquireTexture(resolved)
                if (destroyed || entry?.requestId !== requestId) return
                releaseTexture(entry.textureKey)
                entry.textureKey = resolved
                entry.sprite.texture = texture
                entry.sprite.width = node.dimensions.width
                entry.sprite.height = node.dimensions.height
                entry.sprite.visible = true
                entry.colorRect.visible = false
            } catch (error) {
                console.error('[PixiMediaLayer] Failed to load image texture.', error)
                if (entry?.requestId === requestId) {
                    entry.sprite.visible = false
                    entry.colorRect.visible = true
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
        if (!ready || !lastState) return
        const visible = new Set(
            spatialIndex.search({
                minX: (-currentViewport.x / currentViewport.zoom) - CULLING_MARGIN,
                minY: (-currentViewport.y / currentViewport.zoom) - CULLING_MARGIN,
                maxX: ((paneEl.clientWidth - currentViewport.x) / currentViewport.zoom) + CULLING_MARGIN,
                maxY: ((paneEl.clientHeight - currentViewport.y) / currentViewport.zoom) + CULLING_MARGIN,
            }).map((item: IndexedImage) => item.nodeId)
        )

        for (const [nodeId, entry] of entries) {
            const isVisible = visible.has(nodeId)
            entry.sprite.renderable = isVisible
            entry.colorRect.renderable = isVisible
        }
    }

    function destroy(): void {
        destroyed = true
        for (const [nodeId, entry] of entries) {
            setPixiOwned(viewportEl, nodeId, false)
            releaseTexture(entry.textureKey)
            entry.sprite.destroy()
            entry.colorRect.destroy()
        }
        entries.clear()
        for (const [, entry] of textureCache) {
            entry.texture.destroy(true)
        }
        textureCache.clear()
        spatialIndex.clear()
        destroyPixiImageDecoder()
        hostEl.remove()
        if (ready) {
            app.destroy(true, { children: true, texture: false, textureSource: false })
        }
    }

    return {
        sync,
        setViewport,
        destroy,
    }
}
