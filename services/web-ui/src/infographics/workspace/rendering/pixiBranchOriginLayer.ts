import {
    Application,
    Container,
    Graphics,
} from 'pixi.js'
import type {
    CanvasState,
    CanvasViewport,
} from '@lixpi/constants'
import {
    branchOriginIntersectsRect,
    getBranchOriginRenderDatums,
    type BranchOriginRenderDatum,
} from '$src/infographics/workspace/rendering/branchOrigins.ts'
import { getVisibleWorldRect } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { settings } from '$src/settings.ts'

type BranchOriginEntry = {
    graphics: Graphics
    datum: BranchOriginRenderDatum
    visible: boolean
}

type PixiBranchOriginLayerOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
}

export type PixiBranchOriginLayer = {
    sync: (canvasState: CanvasState | null, selectedNodeIds?: Set<string>) => void
    setViewport: (viewport: CanvasViewport) => void
    setNodeLiveTransform: (
        nodeId: string,
        worldPosition: { x: number; y: number },
        dimensions: { width: number; height: number }
    ) => void
    pulseBranchOrigin: (nodeId: string) => void
    destroy: () => void
}

type LayerHealth = 'initializing' | 'ready' | 'destroyed'

function getPaneSize(paneEl: HTMLDivElement): { width: number; height: number } {
    if (paneEl.clientWidth > 0 && paneEl.clientHeight > 0) {
        return { width: paneEl.clientWidth, height: paneEl.clientHeight }
    }
    const bounds = paneEl.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height }
}

function getPulseProgress(startedAt: number | undefined, now: number): number | null {
    if (startedAt === undefined) return null
    const progress = (now - startedAt) / settings.branchOrigin.pulseDurationMs
    return progress >= 1 ? null : Math.max(0, progress)
}

export function createPixiBranchOriginLayer(options: PixiBranchOriginLayerOptions): PixiBranchOriginLayer {
    const { paneEl, viewportEl } = options

    const hostStyle = {
        position: 'absolute' as const,
        inset: '0',
        pointerEvents: 'none' as const,
        zIndex: '1',
        overflow: 'hidden',
    }
    const hostEl = html`<div className="workspace-pixi-branch-origin-layer" style=${hostStyle}></div>` as HTMLDivElement
    paneEl.insertBefore(hostEl, viewportEl)

    const app = new Application()
    const world = new Container({ label: 'workspace-pixi-branch-origins-world' })
    const branchOriginLayer = new Container({ label: 'workspace-pixi-branch-origins' })
    const entries = new Map<string, BranchOriginEntry>()
    const pulseStartedAtByNodeId = new Map<string, number>()
    let health: LayerHealth = 'initializing'
    let destroyed = false
    let renderRaf: number | null = null
    let lastState: CanvasState | null = null
    let latestSelectedNodeIds: Set<string> = new Set()
    let currentViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }

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
                webgpu: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
                webgl: {
                    antialias: true,
                    powerPreference: 'high-performance',
                },
            })
            app.ticker.stop()

            if (destroyed) {
                app.destroy(true, { children: true, texture: false, textureSource: false })
                return
            }

            app.stage.addChild(world)
            world.addChild(branchOriginLayer)
            hostEl.appendChild(app.canvas)
            applyStyle(app.canvas as HTMLCanvasElement, {
                position: 'absolute',
                inset: '0',
            })
            world.position.set(currentViewport.x, currentViewport.y)
            world.scale.set(currentViewport.zoom, currentViewport.zoom)
            health = 'ready'
            sync(lastState, latestSelectedNodeIds)
            scheduleRender()
        } catch (error) {
            console.error('[PixiBranchOriginLayer] Failed to initialize PIXI branch-origin layer.', error)
            throw error
        }
    })()

    function getVisibleBranchOriginNodeIds(datums: BranchOriginRenderDatum[]): Set<string> {
        const visibleRect = getVisibleWorldRect(
            currentViewport,
            getPaneSize(paneEl),
            settings.branchOrigin.cullingMargin
        )
        return new Set(
            datums
                .filter((datum: BranchOriginRenderDatum) => branchOriginIntersectsRect(datum, visibleRect))
                .map((datum: BranchOriginRenderDatum) => datum.nodeId)
        )
    }

    function paintBranchOrigin(entry: BranchOriginEntry, now: number): void {
        const { graphics, datum } = entry
        const radius = Math.min(datum.width, datum.height) / 2
        const centerX = datum.width / 2
        const centerY = datum.height / 2
        const zoom = currentViewport.zoom || 1
        const strokeWidth = settings.branchOrigin.strokeWidth / zoom
        const iconStrokeWidth = Math.max(1.5 / zoom, strokeWidth * 0.75)
        const pulseProgress = getPulseProgress(pulseStartedAtByNodeId.get(datum.nodeId), now)

        graphics.clear()
        graphics.position.set(datum.x, datum.y)
        graphics.renderable = entry.visible
        if (!entry.visible) return

        if (pulseProgress !== null) {
            const pulseRadius = radius + (8 + 18 * pulseProgress) / zoom
            graphics.beginPath()
            graphics.circle(centerX, centerY, pulseRadius)
            graphics.stroke({
                color: settings.branchOrigin.pulseStrokeColor,
                alpha: 1 - pulseProgress,
                width: Math.max(1 / zoom, strokeWidth),
            })
        } else {
            pulseStartedAtByNodeId.delete(datum.nodeId)
        }

        graphics.beginPath()
        graphics.circle(centerX, centerY, radius)
        graphics.fill({ color: settings.branchOrigin.fillColor, alpha: 0.92 })
        graphics.stroke({
            color: datum.selected ? settings.branchOrigin.selectedStrokeColor : settings.branchOrigin.strokeColor,
            width: datum.selected ? strokeWidth * 1.7 : strokeWidth,
        })

        const forkX = centerX - 10
        const forkY = centerY
        graphics.beginPath()
        graphics.moveTo(forkX, forkY)
        graphics.lineTo(centerX + 2, forkY)
        graphics.lineTo(centerX + 12, centerY - 10)
        graphics.moveTo(centerX + 2, forkY)
        graphics.lineTo(centerX + 12, centerY + 10)
        graphics.stroke({
            color: datum.selected ? settings.branchOrigin.selectedStrokeColor : '#4D5963',
            width: iconStrokeWidth,
            cap: 'round',
            join: 'round',
        })
    }

    function paintAllEntries(): boolean {
        const now = performance.now()
        let hasActivePulse = false
        for (const entry of entries.values()) {
            paintBranchOrigin(entry, now)
            if (getPulseProgress(pulseStartedAtByNodeId.get(entry.datum.nodeId), now) !== null) hasActivePulse = true
        }
        return hasActivePulse
    }

    function scheduleRender(): void {
        if (destroyed || health !== 'ready' || renderRaf !== null) return
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null
            if (destroyed || health !== 'ready') return
            const hasActivePulse = paintAllEntries()
            app.render()
            if (hasActivePulse) scheduleRender()
        })
    }

    function sync(canvasState: CanvasState | null, selectedNodeIds: Set<string> = latestSelectedNodeIds): void {
        lastState = canvasState
        latestSelectedNodeIds = new Set(selectedNodeIds)
        if (destroyed || health !== 'ready') return

        const datums = getBranchOriginRenderDatums(canvasState, latestSelectedNodeIds)
        const activeNodeIds = new Set(datums.map((datum: BranchOriginRenderDatum) => datum.nodeId))
        const visibleNodeIds = getVisibleBranchOriginNodeIds(datums)

        for (const [nodeId, entry] of entries) {
            if (!activeNodeIds.has(nodeId)) {
                branchOriginLayer.removeChild(entry.graphics)
                entry.graphics.destroy()
                entries.delete(nodeId)
                pulseStartedAtByNodeId.delete(nodeId)
            }
        }

        for (const datum of datums) {
            let entry = entries.get(datum.nodeId)
            if (!entry) {
                const graphics = new Graphics()
                branchOriginLayer.addChild(graphics)
                entry = { graphics, datum, visible: false }
                entries.set(datum.nodeId, entry)
            }
            entry.datum = datum
            entry.visible = visibleNodeIds.has(datum.nodeId)
        }

        scheduleRender()
    }

    function setViewport(viewport: CanvasViewport): void {
        if (destroyed) return
        currentViewport = viewport
        world.position.set(viewport.x, viewport.y)
        world.scale.set(viewport.zoom, viewport.zoom)
        sync(lastState, latestSelectedNodeIds)
    }

    function setNodeLiveTransform(
        nodeId: string,
        worldPosition: { x: number; y: number },
        dimensions: { width: number; height: number }
    ): void {
        const entry = entries.get(nodeId)
        if (!entry || destroyed) return
        entry.datum = {
            ...entry.datum,
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height,
        }
        entry.visible = getVisibleBranchOriginNodeIds([entry.datum]).has(nodeId)
        scheduleRender()
    }

    function pulseBranchOrigin(nodeId: string): void {
        if (destroyed) return
        pulseStartedAtByNodeId.set(nodeId, performance.now())
        scheduleRender()
    }

    function destroy(): void {
        const wasReady = health === 'ready'
        destroyed = true
        health = 'destroyed'
        if (renderRaf !== null) {
            cancelAnimationFrame(renderRaf)
            renderRaf = null
        }
        pulseStartedAtByNodeId.clear()
        for (const entry of entries.values()) {
            branchOriginLayer.removeChild(entry.graphics)
            entry.graphics.destroy()
        }
        entries.clear()
        hostEl.remove()
        if (wasReady) {
            app.destroy(true, { children: true, texture: false, textureSource: false })
        }
    }

    return {
        sync,
        setViewport,
        setNodeLiveTransform,
        pulseBranchOrigin,
        destroy,
    }
}
