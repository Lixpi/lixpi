import { getElementBorderRadius } from '@lixpi/ui-primitives/dom'
import {
    GlassBorder,
    type GlassBorderOptions,
} from './glass-border.ts'
import {
    type GlassBorderDatum,
} from './glass-border-geometry.ts'

export type DomGlassTarget = { id: string; element: HTMLElement }
export type DomGlassBorderOptions = GlassBorderOptions & { root: HTMLElement }

export class DomGlassBorder {
    private readonly border: GlassBorder
    private readonly observer: ResizeObserver
    private targets: readonly DomGlassTarget[] = []
    private readonly radii = new Map<HTMLElement, { width: number; height: number; radius: number }>()
    private destroyed = false

    constructor(private readonly options: DomGlassBorderOptions) {
        this.observer = new ResizeObserver(() => options.surface.invalidate())
        try {
            this.border = new GlassBorder(options)
        } catch (error) {
            this.observer.disconnect()
            throw error
        }
        options.surface.signal.addEventListener('abort', this.destroy, { once: true })
    }

    setTargets(targets: readonly DomGlassTarget[]): void {
        if (this.destroyed) return
        this.observer.disconnect()
        this.targets = [...targets]
        this.radii.clear()
        for (const target of targets) this.observer.observe(target.element)
        this.options.surface.invalidate()
    }

    refresh(): void {
        if (this.destroyed) return
        const root = this.options.root.getBoundingClientRect()
        const datums: GlassBorderDatum[] = []
        for (const { id, element } of this.targets) {
            if (!element.isConnected) continue
            const rect = element.getBoundingClientRect()
            if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) continue
            let cached = this.radii.get(element)
            if (!cached || cached.width !== rect.width || cached.height !== rect.height) {
                cached = { width: rect.width, height: rect.height, radius: getElementBorderRadius(element, rect.width, rect.height) }
                this.radii.set(element, cached)
            }
            datums.push({ id, x: rect.left - root.left, y: rect.top - root.top, width: rect.width, height: rect.height, radius: cached.radius, visible: true })
        }
        this.border.sync(datums, { width: root.width, height: root.height })
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.observer.disconnect()
        this.border.destroy()
        this.targets = []
        this.radii.clear()
    }
}
