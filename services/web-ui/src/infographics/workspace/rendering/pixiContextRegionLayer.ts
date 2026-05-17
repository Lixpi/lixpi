import {
    Application,
    Container,
    Graphics,
    Sprite,
    Text,
    Texture,
} from 'pixi.js'

import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { getVisibleWorldRect, type PixiRendererHealth, type WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import {
    getContextRegionCloudBleed,
    getContextRegionCloudBounds,
    getContextRegionCloudPolygon,
    getContextRegionCloudResizeHandleRects,
    getContextRegionCloudStyle,
    getContextRegionCloudTitleRect,
    hitTestContextRegionCloud,
    type ContextRegionCloudDatum,
    type ContextRegionCloudHit,
    type ContextRegionCloudPoint,
    type ContextRegionCloudStyle,
} from '$src/infographics/workspace/rendering/contextRegionClouds.ts'

type PixiContextRegionEntry = {
    container: Container
    backdrop: Sprite
    chrome: Graphics
    titleText: Text
    datum: ContextRegionCloudDatum
    styleKey: string
    geometryKey: string
    pulseStartedAt: number | null
}

type ContextRegionViewport = { x: number; y: number; zoom: number }

export type PixiContextRegionLayer = {
    sync: (regions: ContextRegionCloudDatum[]) => void
    setViewport: (viewport: ContextRegionViewport) => void
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ) => void
    hitTest: (worldPoint: ContextRegionCloudPoint) => ContextRegionCloudHit
    pulseRegion: (nodeId: string) => void
    getHealth: () => PixiRendererHealth
    destroy: () => void
}

type PixiContextRegionLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    onHealthChange?: (health: PixiRendererHealth) => void
}

const VISIBILITY_MARGIN = 1600
const PULSE_DURATION_MS = 700

function makeRandom(seed: number): () => number {
    let value = seed >>> 0
    return () => {
        value += 0x6D2B79F5
        let next = value
        next = Math.imul(next ^ next >>> 15, next | 1)
        next ^= next + Math.imul(next ^ next >>> 7, next | 61)
        return ((next ^ next >>> 14) >>> 0) / 4294967296
    }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace('#', '')
    const value = parseInt(normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized, 16)
    return { r: value >> 16 & 255, g: value >> 8 & 255, b: value & 255 }
}

function rgba(hex: string, alpha: number): string {
    const { r, g, b } = hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

function getTemplateSize(style: ContextRegionCloudStyle): { width: number; height: number } {
    if (style.aspect === 'wide') return { width: 1280, height: 760 }
    if (style.aspect === 'tall') return { width: 760, height: 1280 }
    return { width: 920, height: 920 }
}

function drawGradientEllipse(
    ctx: CanvasRenderingContext2D,
    params: {
        x: number
        y: number
        rx: number
        ry: number
        rotation?: number
        stops: Array<{ offset: number; color: string }>
    }
): void {
    ctx.save()
    ctx.translate(params.x, params.y)
    ctx.rotate(params.rotation ?? 0)
    ctx.scale(params.rx, params.ry)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    for (const stop of params.stops) gradient.addColorStop(stop.offset, stop.color)
    ctx.fillStyle = gradient
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
}

function getRingLobes(style: ContextRegionCloudStyle): Array<{ x: number; y: number; rx: number; ry: number; alpha: number; rotation: number }> {
    if (style.aspect === 'wide') {
        return [
            { x: 0.15, y: 0.51, rx: 0.18, ry: 0.25, alpha: 0.22, rotation: -0.10 },
            { x: 0.22, y: 0.34, rx: 0.19, ry: 0.23, alpha: 0.19, rotation: -0.35 },
            { x: 0.34, y: 0.24, rx: 0.21, ry: 0.20, alpha: 0.18, rotation: -0.12 },
            { x: 0.49, y: 0.20, rx: 0.22, ry: 0.22, alpha: 0.20, rotation: 0.10 },
            { x: 0.64, y: 0.25, rx: 0.21, ry: 0.21, alpha: 0.18, rotation: 0.28 },
            { x: 0.78, y: 0.38, rx: 0.18, ry: 0.24, alpha: 0.20, rotation: 0.20 },
            { x: 0.84, y: 0.56, rx: 0.16, ry: 0.26, alpha: 0.18, rotation: -0.06 },
            { x: 0.73, y: 0.72, rx: 0.22, ry: 0.22, alpha: 0.18, rotation: -0.20 },
            { x: 0.57, y: 0.79, rx: 0.24, ry: 0.20, alpha: 0.18, rotation: 0.08 },
            { x: 0.39, y: 0.79, rx: 0.24, ry: 0.21, alpha: 0.18, rotation: -0.08 },
            { x: 0.24, y: 0.70, rx: 0.20, ry: 0.23, alpha: 0.19, rotation: 0.18 },
        ]
    }

    const radiusX = style.aspect === 'tall' ? 0.30 : 0.36
    const radiusY = style.aspect === 'tall' ? 0.37 : 0.34
    const lobes: Array<{ x: number; y: number; rx: number; ry: number; alpha: number; rotation: number }> = []
    for (let i = 0; i < 14; i++) {
        const angle = i / 14 * Math.PI * 2
        lobes.push({
            x: 0.5 + Math.cos(angle) * radiusX,
            y: 0.5 + Math.sin(angle) * radiusY,
            rx: 0.20 + (i % 3) * 0.025,
            ry: 0.21 + (i % 4) * 0.022,
            alpha: 0.18 + (i % 2) * 0.025,
            rotation: angle + Math.PI / 5,
        })
    }
    return lobes
}

function createWatercolorTexture(style: ContextRegionCloudStyle): Texture {
    const { width, height } = getTemplateSize(style)
    const canvas = html`<canvas width=${width} height=${height}></canvas>` as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return Texture.WHITE

    const random = makeRandom(style.seed)
    const minSize = Math.min(width, height)

    ctx.clearRect(0, 0, width, height)

    ctx.filter = `blur(${Math.max(10, minSize * 0.025)}px)`
    drawGradientEllipse(ctx, {
        x: width * 0.50,
        y: height * 0.52,
        rx: width * 0.34,
        ry: height * 0.31,
        rotation: -0.06,
        stops: [
            { offset: 0, color: rgba(style.palette.bloom, 0.52) },
            { offset: 0.58, color: rgba(style.palette.wash, 0.42) },
            { offset: 1, color: rgba(style.palette.pool, 0) },
        ],
    })

    for (const lobe of getRingLobes(style)) {
        const jitterX = (random() - 0.5) * width * 0.035
        const jitterY = (random() - 0.5) * height * 0.04
        drawGradientEllipse(ctx, {
            x: lobe.x * width + jitterX,
            y: lobe.y * height + jitterY,
            rx: lobe.rx * width * (0.90 + random() * 0.22),
            ry: lobe.ry * height * (0.90 + random() * 0.22),
            rotation: lobe.rotation + (random() - 0.5) * 0.35,
            stops: [
                { offset: 0, color: rgba(style.palette.bloom, lobe.alpha * 1.75) },
                { offset: 0.48, color: rgba(style.palette.wash, lobe.alpha * 2.20) },
                { offset: 0.78, color: rgba(style.palette.pool, lobe.alpha * 1.05) },
                { offset: 1, color: rgba(style.palette.pool, 0) },
            ],
        })
    }
    ctx.filter = 'none'

    for (let i = 0; i < 42; i++) {
        const radiusX = (0.025 + random() * 0.10) * width
        const radiusY = (0.035 + random() * 0.13) * height
        const x = (0.12 + random() * 0.76) * width
        const y = (0.12 + random() * 0.76) * height
        const color = random() > 0.55 ? style.palette.bloom : style.palette.pool
        drawGradientEllipse(ctx, {
            x,
            y,
            rx: radiusX,
            ry: radiusY,
            rotation: (random() - 0.5) * 0.7,
            stops: [
                { offset: 0, color: rgba(color, 0.22 + random() * 0.14) },
                { offset: 0.62, color: rgba(color, 0.10 + random() * 0.09) },
                { offset: 1, color: rgba(color, 0) },
            ],
        })
    }

    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 18; i++) {
        drawGradientEllipse(ctx, {
            x: (0.16 + random() * 0.68) * width,
            y: (0.18 + random() * 0.64) * height,
            rx: (0.05 + random() * 0.13) * width,
            ry: (0.06 + random() * 0.14) * height,
            rotation: (random() - 0.5) * 0.8,
            stops: [
                { offset: 0, color: 'rgba(255, 255, 255, 0.035)' },
                { offset: 0.55, color: 'rgba(255, 255, 255, 0.018)' },
                { offset: 1, color: 'rgba(255, 255, 255, 0)' },
            ],
        })
    }

    ctx.globalCompositeOperation = 'source-atop'
    for (let i = 0; i < 1800; i++) {
        const alpha = 0.026 + random() * 0.058
        ctx.fillStyle = rgba(random() > 0.36 ? style.palette.edge : style.palette.pool, alpha)
        const dotSize = 0.45 + random() * 1.8
        ctx.fillRect(random() * width, random() * height, dotSize, dotSize)
    }
    ctx.globalCompositeOperation = 'source-over'

    return Texture.from(canvas)
}

function rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function drawPolygon(graphics: Graphics, points: ContextRegionCloudPoint[]): void {
    if (points.length === 0) return
    graphics.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
        graphics.lineTo(points[i].x, points[i].y)
    }
    graphics.closePath()
}

function colorNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16)
}

function drawTitle(text: Text, datum: ContextRegionCloudDatum, style: ContextRegionCloudStyle, zoom: number): void {
    const rect = getContextRegionCloudTitleRect(datum, zoom)

    text.text = datum.title
    text.style = {
        fill: colorNumber(style.palette.ink),
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 20 / Math.max(zoom, 0.01),
        fontWeight: '650',
    }
    text.position.set(rect.x, rect.y)
    text.scale.set(1)
    text.alpha = 0.80
}

function drawChrome(entry: PixiContextRegionEntry, viewport: ContextRegionViewport): void {
    const { datum, chrome, titleText } = entry
    const zoom = Math.max(viewport.zoom, 0.01)
    const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
    const polygon = getContextRegionCloudPolygon(datum, style)
    chrome.clear()

    drawTitle(titleText, datum, style, zoom)

    if (datum.selected) {
        drawPolygon(chrome, polygon)
        chrome.stroke({ color: colorNumber(style.palette.ink), alpha: 0.18, width: 1.25 / zoom })

        for (const handle of getContextRegionCloudResizeHandleRects(datum, zoom)) {
            const centerX = handle.rect.x + handle.rect.width / 2
            const centerY = handle.rect.y + handle.rect.height / 2
            chrome.circle(centerX, centerY, 5 / zoom)
            chrome.fill({ color: 0xFFFFFF, alpha: 0.9 })
            chrome.stroke({ color: colorNumber(style.palette.ink), alpha: 0.58, width: 1.25 / zoom })
        }
    }
}

function getGeometryKey(datum: ContextRegionCloudDatum, viewport: ContextRegionViewport): string {
    return [datum.nodeId, datum.x, datum.y, datum.width, datum.height, datum.title, datum.selected, viewport.zoom.toFixed(3)].join(':')
}

export function createPixiContextRegionLayer(options: PixiContextRegionLayerOptions): PixiContextRegionLayer {
    const { paneEl, viewportEl, onHealthChange } = options

    const hostStyle = {
        position: 'absolute' as const,
        inset: '0',
        pointerEvents: 'none' as const,
        zIndex: '0',
        overflow: 'hidden',
    }
    const hostEl = html`<div className="workspace-pixi-context-region-layer" style=${hostStyle}></div>` as HTMLDivElement
    paneEl.insertBefore(hostEl, viewportEl)

    const app = new Application()
    const world = new Container({ label: 'workspace-context-region-world' })
    const entries = new Map<string, PixiContextRegionEntry>()
    const textureCache = new Map<string, Texture>()
    let currentRegions: ContextRegionCloudDatum[] = []
    let destroyed = false
    let health: PixiRendererHealth = 'initializing'
    let currentViewport: ContextRegionViewport = { x: 0, y: 0, zoom: 1 }
    let renderRaf: number | null = null
    let pulseRaf: number | null = null

    function setHealth(next: PixiRendererHealth): void {
        if (health === next) return
        health = next
        onHealthChange?.(next)
    }

    function scheduleRender(): void {
        if (destroyed || health !== 'ready' || renderRaf !== null) return
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null
            app.render()
        })
    }

    function getTexture(style: ContextRegionCloudStyle): Texture {
        const existing = textureCache.get(style.key)
        if (existing) return existing
        const texture = createWatercolorTexture(style)
        textureCache.set(style.key, texture)
        return texture
    }

    function updateWorldTransform(): void {
        world.position.set(currentViewport.x, currentViewport.y)
        world.scale.set(currentViewport.zoom)
    }

    function updateVisibility(): void {
        const visibleRect = getVisibleWorldRect(currentViewport, {
            width: paneEl.clientWidth || paneEl.getBoundingClientRect().width,
            height: paneEl.clientHeight || paneEl.getBoundingClientRect().height,
        }, VISIBILITY_MARGIN)
        const visibleBounds = {
            x: visibleRect.minX,
            y: visibleRect.minY,
            width: visibleRect.maxX - visibleRect.minX,
            height: visibleRect.maxY - visibleRect.minY,
        }

        for (const entry of entries.values()) {
            const bounds = getContextRegionCloudBounds(entry.datum)
            entry.container.renderable = rectsIntersect(bounds, visibleBounds)
        }
    }

    function syncEntry(datum: ContextRegionCloudDatum): void {
        const style = getContextRegionCloudStyle(datum.nodeId, datum.width, datum.height)
        let entry = entries.get(datum.nodeId)
        if (!entry) {
            const container = new Container({ label: `workspace-context-region-${datum.nodeId}` })
            const backdrop = new Sprite(getTexture(style))
            const chrome = new Graphics()
            const titleText = new Text({ text: datum.title })
            container.addChild(backdrop)
            container.addChild(chrome)
            container.addChild(titleText)
            world.addChild(container)
            entry = { container, backdrop, chrome, titleText, datum, styleKey: style.key, geometryKey: '', pulseStartedAt: null }
            entries.set(datum.nodeId, entry)
        }

        if (entry.styleKey !== style.key) {
            entry.backdrop.texture = getTexture(style)
            entry.styleKey = style.key
        }

        entry.datum = datum
        const bleed = getContextRegionCloudBleed(style, datum)
        entry.backdrop.position.set(datum.x - bleed, datum.y - bleed)
        entry.backdrop.width = datum.width + bleed * 2
        entry.backdrop.height = datum.height + bleed * 2
        entry.backdrop.alpha = datum.selected ? 1 : 0.98

        const geometryKey = getGeometryKey(datum, currentViewport)
        if (entry.geometryKey !== geometryKey) {
            entry.geometryKey = geometryKey
            drawChrome(entry, currentViewport)
        }
    }

    function sync(regions: ContextRegionCloudDatum[]): void {
        currentRegions = regions
        const activeIds = new Set(regions.map((region) => region.nodeId))
        for (const [nodeId, entry] of entries) {
            if (activeIds.has(nodeId)) continue
            entry.container.destroy({ children: true })
            entries.delete(nodeId)
        }

        for (const region of regions) {
            syncEntry(region)
        }
        updateVisibility()
        scheduleRender()
    }

    function setViewport(viewport: ContextRegionViewport): void {
        currentViewport = viewport
        updateWorldTransform()
        for (const entry of entries.values()) {
            entry.geometryKey = ''
            drawChrome(entry, currentViewport)
            entry.geometryKey = getGeometryKey(entry.datum, currentViewport)
        }
        updateVisibility()
        scheduleRender()
    }

    function setNodeLiveTransform(nodeId: string, worldPosition: WorldPosition, dimensions: { width: number; height: number }): void {
        const entry = entries.get(nodeId)
        if (!entry) return
        syncEntry({
            ...entry.datum,
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height,
        })
        scheduleRender()
    }

    function hitTest(worldPoint: ContextRegionCloudPoint): ContextRegionCloudHit {
        for (let i = currentRegions.length - 1; i >= 0; i--) {
            const entry = entries.get(currentRegions[i].nodeId)
            const datum = entry?.datum ?? currentRegions[i]
            const hit = hitTestContextRegionCloud(datum, worldPoint, currentViewport.zoom)
            if (hit.kind !== 'none') return hit
        }
        return { kind: 'none' }
    }

    function updatePulseFrame(): void {
        pulseRaf = null
        const now = performance.now()
        let hasActivePulse = false
        for (const entry of entries.values()) {
            if (entry.pulseStartedAt === null) continue
            const elapsed = now - entry.pulseStartedAt
            const progress = Math.min(1, elapsed / PULSE_DURATION_MS)
            const lift = Math.sin(progress * Math.PI)
            const style = getContextRegionCloudStyle(entry.datum.nodeId, entry.datum.width, entry.datum.height)
            const bleed = getContextRegionCloudBleed(style, entry.datum)
            entry.backdrop.alpha = (entry.datum.selected ? 1 : 0.98) + lift * 0.02
            entry.backdrop.position.set(entry.datum.x - bleed, entry.datum.y - bleed - lift * 3 / Math.max(currentViewport.zoom, 0.01))
            if (progress >= 1) {
                entry.pulseStartedAt = null
                entry.backdrop.alpha = entry.datum.selected ? 1 : 0.98
                entry.backdrop.position.set(entry.datum.x - bleed, entry.datum.y - bleed)
            } else {
                hasActivePulse = true
            }
        }
        scheduleRender()
        if (hasActivePulse && !destroyed) pulseRaf = requestAnimationFrame(updatePulseFrame)
    }

    function pulseRegion(nodeId: string): void {
        const entry = entries.get(nodeId)
        if (!entry) return
        entry.pulseStartedAt = performance.now()
        if (pulseRaf === null) pulseRaf = requestAnimationFrame(updatePulseFrame)
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
                autoStart: false,
                sharedTicker: false,
                webgpu: { antialias: true },
                webgl: { antialias: true },
            })
            if (destroyed) {
                app.destroy(true)
                return
            }
            app.stage.addChild(world)
            app.ticker.stop()
            hostEl.appendChild(app.canvas)
            applyStyle(app.canvas, { width: '100%', height: '100%', display: 'block' })
            updateWorldTransform()
            sync(currentRegions)
            setHealth('ready')
            scheduleRender()
        } catch (error) {
            console.error('Failed to initialize PIXI context region layer:', error)
            hostEl.remove()
            setHealth('failed')
        }
    })()

    return {
        sync,
        setViewport,
        setNodeLiveTransform,
        hitTest,
        pulseRegion,
        getHealth: () => health,
        destroy() {
            destroyed = true
            if (renderRaf !== null) cancelAnimationFrame(renderRaf)
            if (pulseRaf !== null) cancelAnimationFrame(pulseRaf)
            for (const texture of textureCache.values()) texture.destroy(true)
            textureCache.clear()
            entries.clear()
            app.destroy(true)
            hostEl.remove()
        },
    }
}