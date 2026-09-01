'use strict'

import { roundedRectanglePath } from '@lixpi/ui-primitives/svg'
import type {
    CanvasEngineRect,
    Dispose,
} from '@lixpi/canvas-engine/shared'
import type {
    CanvasDrawingSurface,
    CanvasLayer,
    CaptureResource,
    CaptureSpec,
    ResourceHandle,
    TextureInput,
    VectorShape,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    bakeGlassDisplacementMap,
    createGlassBorderMeshGeometry,
    getDisplacementSignature,
    getMaskAndHighlightSignature,
    getMaterialGeometrySignature,
    writeClosedRoundedBorderGeometry,
    type GlassBorderDatum,
    type GlassBorderMeshGeometry,
    type GlassBorderStyle,
    type ViewportSize,
} from './glass-border-geometry.ts'

export type GlassBorderOptions = {
    surface: CanvasDrawingSurface
    style: GlassBorderStyle
    texture: TextureInput
    sources?: readonly (CanvasLayer | ResourceHandle<'group'>)[]
    resolution?: number
}

type BorderEntry = {
    mesh: ResourceHandle<'mesh'>
    buffers: GlassBorderMeshGeometry
    signature: string
    version: number
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
    return roundedRectanglePath({ x, y, width, height }, radius)
}

function ringShape(datum: GlassBorderDatum, width: number, color: string, alpha: number): VectorShape {
    const half = width / 2
    const innerWidth = datum.width - width
    const innerHeight = datum.height - width
    return {
        path: roundedRectPath(datum.x - half, datum.y - half, datum.width + width, datum.height + width, datum.radius + half),
        fill: { color, alpha },
        holes: innerWidth > 0 && innerHeight > 0
            ? [roundedRectPath(datum.x + half, datum.y + half, innerWidth, innerHeight, Math.max(0, datum.radius - half))]
            : [],
    }
}

function rimShape(datum: GlassBorderDatum, offset: number, color: string, alpha: number): VectorShape {
    return {
        path: roundedRectPath(datum.x - offset, datum.y - offset, Math.max(1, datum.width + offset * 2), Math.max(1, datum.height + offset * 2), Math.max(0, datum.radius + offset)),
        stroke: { color, alpha, width: 1 },
    }
}

function color(value: string, fallback: string): string {
    const normalized = value.trim().replace(/^#/, '')
    return /^[\da-f]{6}$/i.test(normalized) ? `#${normalized}` : fallback
}

function alpha(value: number): number {
    return Math.max(0, Math.min(1, value))
}

export class GlassBorder {
    private readonly root: ResourceHandle<'group'>
    private readonly refraction: ResourceHandle<'group'>
    private readonly material: ResourceHandle<'group'>
    private readonly mask: ResourceHandle<'path'>
    private readonly highlights: ResourceHandle<'path'>
    private readonly materialTexture: ResourceHandle<'texture'>
    private readonly displacementTexture: ResourceHandle<'texture'>
    private readonly entries = new Map<string, BorderEntry>()
    private capture: CaptureResource | null = null
    private captureSpec: CaptureSpec | null = null
    private captureSignature = ''
    private displacementSignature = ''
    private maskSignature = ''
    private displacementBinding = ''
    private displace: Dispose | null = null
    private mapSize: ViewportSize = { width: 1, height: 1 }
    private destroyed = false

    constructor(private readonly options: GlassBorderOptions) {
        const { resources, layers, signal } = options.surface
        if (signal.aborted) throw new Error('Cannot mount glass in a disposed drawing scope')
        const owned: ResourceHandle[] = []
        const own = <Handle extends ResourceHandle>(handle: Handle): Handle => {
            owned.push(handle)
            return handle
        }
        try {
            this.root = own(resources.createGroup({ space: 'screen', layer: layers.foreground }))
            this.refraction = own(resources.createGroup({ space: 'screen', layer: this.root }))
            this.mask = own(resources.createPath(this.root, []))
            resources.setMask(this.refraction, this.mask)
            this.material = own(resources.createGroup({ space: 'screen', layer: this.root }))
            this.highlights = own(resources.createPath(this.root, []))
            this.materialTexture = own(resources.createTexture(options.texture))
            this.displacementTexture = own(resources.createTexture({ kind: 'pixels', size: this.mapSize, rgba: new Uint8Array([128, 128, 128, 255]) }))
            resources.setVisible(this.root, false)
        } catch (error) {
            for (const handle of owned.reverse()) resources.release(handle)
            throw error
        }
        signal.addEventListener('abort', this.destroy, { once: true })
    }

    sync(datums: readonly GlassBorderDatum[], viewport: ViewportSize): void {
        if (this.destroyed) return
        const { style, surface: { resources } } = this.options
        const borderWidth = Math.max(0, style.widthPx)
        const visible = style.enabled && borderWidth > 0 && viewport.width > 0 && viewport.height > 0
            ? datums.filter(datum => datum.visible && datum.x + datum.width + borderWidth >= 0 && datum.y + datum.height + borderWidth >= 0 && datum.x - borderWidth <= viewport.width && datum.y - borderWidth <= viewport.height)
            : []
        resources.setVisible(this.root, visible.length > 0)
        if (visible.length === 0) {
            if (this.capture && this.captureSpec?.enabled !== false) {
                this.captureSpec = { ...this.captureSpec!, enabled: false }
                resources.updateCapture(this.capture.handle, this.captureSpec)
            }
            this.captureSignature = ''
            return
        }
        this.syncDisplacement(visible, viewport)
        this.syncCapture(visible, viewport)
        this.syncPaths(visible)
        this.syncMeshes(visible)
    }

    private syncDisplacement(datums: readonly GlassBorderDatum[], viewport: ViewportSize): void {
        const signature = `${this.options.style.displacementMapMaxDimensionPx}|${getDisplacementSignature(datums, viewport, this.options.style)}`
        if (signature === this.displacementSignature) return
        const pixels = bakeGlassDisplacementMap(datums, viewport, this.options.style)
        this.options.surface.resources.updateTexture(this.displacementTexture, pixels)
        this.mapSize = pixels.size
        this.displacementSignature = signature
    }

    private syncCapture(datums: readonly GlassBorderDatum[], viewport: ViewportSize): void {
        const { resources, layers } = this.options.surface
        const resolution = this.options.resolution ?? Math.min(window.devicePixelRatio || 1, 2)
        const bounds: CanvasEngineRect = { x: 0, y: 0, width: Math.max(1, Math.ceil(viewport.width)), height: Math.max(1, Math.ceil(viewport.height)) }
        const padding = Math.max(0, this.options.style.widthPx) / 2 + Math.max(0, this.options.style.displacementScalePx) + 1
        const sampleBounds = datums.map(datum => ({ x: datum.x - padding, y: datum.y - padding, width: datum.width + padding * 2, height: datum.height + padding * 2 }))
        const signature = JSON.stringify([bounds, resolution, sampleBounds.map(region => [region.x, region.y, region.width, region.height].map(value => Math.round(value * 10) / 10))])
        if (signature !== this.captureSignature) {
            this.captureSpec = {
                include: this.options.sources ?? [layers.media, layers.connectors, layers.foreground],
                exclude: [this.root],
                space: 'screen',
                bounds,
                sampleBounds,
                resolution,
                enabled: true,
            }
            if (this.capture) resources.updateCapture(this.capture.handle, this.captureSpec)
            else this.capture = resources.capture(this.captureSpec)
            this.captureSignature = signature
        }
        const scale = Math.max(0, this.options.style.displacementScalePx)
        const binding = JSON.stringify([viewport.width, viewport.height, this.mapSize.width, this.mapSize.height, scale])
        if (binding !== this.displacementBinding) {
            this.displace?.()
            this.displace = resources.displace(this.refraction, this.capture!.texture, this.displacementTexture, { bounds: { x: 0, y: 0, ...viewport }, scale: { x: scale, y: scale } })
            this.displacementBinding = binding
        }
    }

    private syncPaths(datums: readonly GlassBorderDatum[]): void {
        const { style, surface: { resources } } = this.options
        const signature = getMaskAndHighlightSignature(datums, style)
        if (signature === this.maskSignature) return
        const width = Math.max(0, style.widthPx)
        resources.updatePath(this.mask, datums.map(datum => ringShape(datum, width, '#ffffff', 1)))
        resources.updatePath(
            this.highlights,
            datums.flatMap(datum => [
                ringShape(datum, width, color(style.bodyColor, '#ffffff'), alpha(style.bodyAlpha)),
                rimShape(datum, width / 2, color(style.highlightColor, '#ffffff'), alpha(style.highlightAlpha)),
                rimShape(datum, -width / 2, color(style.shadowColor, '#415061'), alpha(style.shadowAlpha)),
            ]),
        )
        this.maskSignature = signature
    }

    private syncMeshes(datums: readonly GlassBorderDatum[]): void {
        const { style, surface: { resources } } = this.options
        const ids = new Set(datums.map(datum => datum.id))
        for (const [id, entry] of this.entries) if (!ids.has(id)) resources.setVisible(entry.mesh, false)
        for (const datum of datums) {
            let entry = this.entries.get(datum.id)
            const signature = getMaterialGeometrySignature(datum, Math.max(0, style.widthPx), style.edgeFeatherFraction)
            if (!entry) {
                const buffers = createGlassBorderMeshGeometry()
                writeClosedRoundedBorderGeometry(buffers, datum, Math.max(0, style.widthPx), style.edgeFeatherFraction)
                const mesh = resources.createMesh(this.material, { ...buffers, version: 0 }, this.materialTexture)
                entry = { mesh, buffers, signature, version: 0 }
                this.entries.set(datum.id, entry)
            } else if (entry.signature !== signature) {
                writeClosedRoundedBorderGeometry(entry.buffers, datum, Math.max(0, style.widthPx), style.edgeFeatherFraction)
                resources.updateMesh(entry.mesh, { ...entry.buffers, version: ++entry.version })
                entry.signature = signature
            }
            resources.setVisible(entry.mesh, true)
        }
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        const { resources, signal } = this.options.surface
        signal.removeEventListener('abort', this.destroy)
        this.displace?.()
        this.displace = null
        resources.release(this.root)
        if (this.capture) resources.release(this.capture.handle)
        resources.release(this.displacementTexture)
        resources.release(this.materialTexture)
        this.entries.clear()
        this.capture = null
    }
}
