'use strict'

import type { Dispose } from '@lixpi/canvas-engine/shared'
import type {
    CanvasDrawingSurface,
    CanvasLayer,
    DrawingSpace,
    ResourceHandle,
    TextureInput,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    createTravelingSnakeMeshGeometry,
    writeTravelingOutlineGeometry,
    type OutlineGeometryUpdate,
    type TravelingOutlineDatum,
    type TravelingOutlineStyle,
    type TravelingSnakeMeshGeometry,
} from './outline-geometry.ts'

export type TravelingOutlineOptions = {
    surface: CanvasDrawingSurface
    style: TravelingOutlineStyle
    texture: TextureInput
    layer?: CanvasLayer | ResourceHandle<'group'>
    space?: DrawingSpace
    ease?: (progress: number) => number
    getStrokeScale?: () => number
}

type OutlineEntry = {
    group: ResourceHandle<'group'>
    mesh: ResourceHandle<'mesh'>
    buffers: TravelingSnakeMeshGeometry
    datum: TravelingOutlineDatum
    active: boolean
    version: number
}

export class TravelingOutline {
    private readonly group: ResourceHandle<'group'>
    private readonly texture: ResourceHandle<'texture'>
    private readonly entries = new Map<string, OutlineEntry>()
    private animation: Dispose | null = null
    private elapsed = 0
    private destroyed = false

    constructor(private readonly options: TravelingOutlineOptions) {
        if (options.surface.signal.aborted) throw new Error('Cannot mount an outline in a disposed drawing scope')
        const { resources, layers } = options.surface
        this.group = resources.createGroup({ space: options.space ?? 'world', layer: options.layer ?? layers.foreground })
        try {
            this.texture = resources.createTexture(options.texture)
        } catch (error) {
            resources.release(this.group)
            throw error
        }
        options.surface.signal.addEventListener('abort', this.destroy, { once: true })
    }

    sync(datums: readonly TravelingOutlineDatum[]): void {
        if (this.destroyed) return
        const ids = new Set(datums.map(datum => datum.id))
        for (const [id, entry] of this.entries) {
            if (ids.has(id)) continue
            entry.active = false
            this.options.surface.resources.setVisible(entry.group, false)
        }
        for (const datum of datums) {
            let entry = this.entries.get(datum.id)
            if (!entry) {
                entry = this.createEntry(datum)
                this.entries.set(datum.id, entry)
            } else {
                entry.datum = { ...datum }
                entry.active = true
            }
            this.paint(entry)
            this.options.surface.resources.setVisible(entry.group, datum.visible)
        }
        this.syncAnimation()
    }

    updateGeometry(id: string, geometry: OutlineGeometryUpdate): void {
        if (this.destroyed) return
        const entry = this.entries.get(id)
        if (!entry) return
        entry.datum = { ...entry.datum, ...geometry }
        this.paint(entry)
    }

    setVisible(id: string, visible: boolean): void {
        if (this.destroyed) return
        const entry = this.entries.get(id)
        if (!entry) return
        entry.datum.visible = visible
        this.options.surface.resources.setVisible(entry.group, entry.active && visible)
        this.syncAnimation()
    }

    private createEntry(datum: TravelingOutlineDatum): OutlineEntry {
        const { resources } = this.options.surface
        const group = resources.createGroup({ space: this.options.space ?? 'world', layer: this.group })
        try {
            const buffers = createTravelingSnakeMeshGeometry()
            const position = writeTravelingOutlineGeometry(buffers, datum, this.options.style, this.elapsed, this.options.getStrokeScale?.(), this.options.ease)
            resources.updateGroup(group, { position })
            const mesh = resources.createMesh(group, { ...buffers, version: 0 }, this.texture)
            return { group, mesh, buffers, datum: { ...datum }, active: true, version: 0 }
        } catch (error) {
            resources.release(group)
            throw error
        }
    }

    private paint(entry: OutlineEntry): void {
        const position = writeTravelingOutlineGeometry(
            entry.buffers,
            entry.datum,
            this.options.style,
            this.elapsed,
            this.options.getStrokeScale?.(),
            this.options.ease,
        )
        this.options.surface.resources.updateGroup(entry.group, { position })
        this.options.surface.resources.updateMesh(entry.mesh, { ...entry.buffers, version: ++entry.version })
    }

    private syncAnimation(): void {
        if (Array.from(this.entries.values()).some(entry => entry.active && entry.datum.visible)) {
            this.animation ??= this.options.surface.requestFrame(this.tick)
        } else {
            this.animation?.()
            this.animation = null
            this.elapsed = 0
        }
    }

    private tick = (elapsedMs: number): void => {
        if (this.destroyed) return
        this.elapsed += elapsedMs
        for (const entry of this.entries.values()) {
            if (entry.active && entry.datum.visible) this.paint(entry)
        }
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.animation?.()
        this.animation = null
        this.entries.clear()
        this.options.surface.resources.release(this.group)
        this.options.surface.resources.release(this.texture)
    }
}
