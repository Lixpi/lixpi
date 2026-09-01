import { roundedRectanglePath } from '@lixpi/ui-primitives/svg'
import type { CanvasEngineRect } from '../../shared/index.ts'
import type { CanvasDrawingSurface } from './drawing-scope.ts'
import type { ResourceHandle } from './resources.ts'

export type RectangleOverlayOptions = { surface: CanvasDrawingSurface; stroke: string; fill: string; radius: number; width?: number }

export class RectangleOverlay {
    private readonly group: ResourceHandle<'group'>
    private readonly path: ResourceHandle<'path'>
    private bounds: CanvasEngineRect | null = null
    private filled = true
    private zoom = 1
    private destroyed = false

    constructor(private readonly options: RectangleOverlayOptions) {
        options.surface.signal.throwIfAborted()
        const { resources, layers } = options.surface
        this.group = resources.createGroup({ layer: layers.foreground, space: 'world' })
        try {
            this.path = resources.createPath(this.group, [])
        } catch (error) {
            resources.release(this.group)
            throw error
        }
        options.surface.signal.addEventListener('abort', this.destroy, { once: true })
    }

    setBounds(bounds: CanvasEngineRect | null, filled = true): void {
        if (this.destroyed) return
        this.bounds = bounds
        this.filled = filled
        this.paint()
    }

    setZoom(zoom: number): void {
        if (this.destroyed || this.zoom === zoom) return
        if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError('Overlay zoom must be finite and positive')
        this.zoom = zoom
        this.paint()
    }

    private paint(): void {
        const { surface: { resources }, stroke, fill, radius, width = 1 } = this.options
        const visible = this.bounds !== null && Object.values(this.bounds).every(Number.isFinite) && this.bounds.width > 0 && this.bounds.height > 0
        resources.setVisible(this.group, visible)
        if (visible) resources.updatePath(this.path, [{ path: roundedRectanglePath(this.bounds!, radius / this.zoom), fill: this.filled ? { color: fill } : undefined, stroke: { color: stroke, width: width / this.zoom } }])
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.options.surface.resources.release(this.group)
    }
}
