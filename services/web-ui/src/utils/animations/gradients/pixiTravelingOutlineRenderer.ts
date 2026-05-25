import { Container, Graphics } from 'pixi.js'
import { Easing } from '$src/utils/animations/easing.ts'

export type PixiTravelingOutlineStyle = {
    radius: number
    trackWidth: number
    trackColor: string
    trackAlpha: number
    segmentWidth: number
    segmentLengthFraction: number
    segmentTailAlpha: number
    segmentCount: number
    segmentColors: ReadonlyArray<string>
    durationMs: number
}

export type PixiTravelingOutlineDatum = {
    id: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
}

export type PixiTravelingOutlineRendererOptions = {
    container: Container
    style: PixiTravelingOutlineStyle
    onFrame: () => void
    ease?: (progress: number) => number
}

type OutlineEntry = {
    graphics: Graphics
    width: number
    height: number
}

export type OutlinePoint = {
    x: number
    y: number
}

export function getRoundedOutlinePerimeter(width: number, height: number, radius: number): number {
    const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    return 2 * (width + height - 4 * boundedRadius) + 2 * Math.PI * boundedRadius
}

export function getRoundedOutlinePoint(
    width: number,
    height: number,
    radius: number,
    distance: number
): OutlinePoint {
    const boundedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const perimeter = getRoundedOutlinePerimeter(width, height, boundedRadius)
    const offset = perimeter > 0 ? ((distance % perimeter) + perimeter) % perimeter : 0
    const horizontal = width - 2 * boundedRadius
    const vertical = height - 2 * boundedRadius
    const corner = Math.PI * boundedRadius / 2
    let remaining = offset

    if (remaining <= horizontal) return { x: boundedRadius + remaining, y: 0 }
    remaining -= horizontal
    if (remaining <= corner && boundedRadius > 0) {
        const angle = -Math.PI / 2 + remaining / boundedRadius
        return { x: width - boundedRadius + boundedRadius * Math.cos(angle), y: boundedRadius + boundedRadius * Math.sin(angle) }
    }
    remaining -= corner
    if (remaining <= vertical) return { x: width, y: boundedRadius + remaining }
    remaining -= vertical
    if (remaining <= corner && boundedRadius > 0) {
        const angle = remaining / boundedRadius
        return { x: width - boundedRadius + boundedRadius * Math.cos(angle), y: height - boundedRadius + boundedRadius * Math.sin(angle) }
    }
    remaining -= corner
    if (remaining <= horizontal) return { x: width - boundedRadius - remaining, y: height }
    remaining -= horizontal
    if (remaining <= corner && boundedRadius > 0) {
        const angle = Math.PI / 2 + remaining / boundedRadius
        return { x: boundedRadius + boundedRadius * Math.cos(angle), y: height - boundedRadius + boundedRadius * Math.sin(angle) }
    }
    remaining -= corner
    if (remaining <= vertical) return { x: 0, y: height - boundedRadius - remaining }
    remaining -= vertical

    const angle = Math.PI + (boundedRadius > 0 ? remaining / boundedRadius : 0)
    return { x: boundedRadius + boundedRadius * Math.cos(angle), y: boundedRadius + boundedRadius * Math.sin(angle) }
}

export function getTravelingOutlineHeadDistance(
    elapsed: number,
    durationMs: number,
    perimeter: number,
    ease: (progress: number) => number = Easing.travelingOutlineTransition
): number {
    if (durationMs <= 0 || perimeter <= 0) return 0
    const lapProgress = (((elapsed % durationMs) + durationMs) % durationMs) / durationMs
    return ease(lapProgress) * perimeter
}

export function interpolateTravelingOutlineColor(colors: ReadonlyArray<string>, progress: number): number {
    if (colors.length === 0) return 0xffffff
    if (colors.length === 1) return Number.parseInt(colors[0].slice(1), 16)

    const bounded = Math.max(0, Math.min(1, progress))
    const scaled = bounded * (colors.length - 1)
    const index = Math.min(colors.length - 2, Math.floor(scaled))
    const blend = scaled - index
    const from = Number.parseInt(colors[index].slice(1), 16)
    const to = Number.parseInt(colors[index + 1].slice(1), 16)
    const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * blend)
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

export class PixiTravelingOutlineRenderer {
    private readonly container: Container
    private readonly style: PixiTravelingOutlineStyle
    private readonly onFrame: () => void
    private readonly ease: (progress: number) => number
    private readonly entries = new Map<string, OutlineEntry>()
    private animationRaf: number | null = null
    private animationStartedAt: number | null = null
    private destroyed = false

    constructor(options: PixiTravelingOutlineRendererOptions) {
        this.container = options.container
        this.style = options.style
        this.onFrame = options.onFrame
        this.ease = options.ease ?? Easing.travelingOutlineTransition
    }

    sync(datums: ReadonlyArray<PixiTravelingOutlineDatum>): void {
        if (this.destroyed) return
        const activeIds = new Set(datums.map((datum) => datum.id))
        for (const id of this.entries.keys()) {
            if (!activeIds.has(id)) this.destroyEntry(id)
        }

        for (const datum of datums) {
            const entry = this.entries.get(datum.id) ?? this.createEntry(datum)
            this.entries.set(datum.id, entry)
            this.updateEntryGeometry(entry, datum)
            entry.graphics.renderable = datum.visible
        }

        this.stopIfIdle()
        this.start()
        this.onFrame()
    }

    updateGeometry(
        id: string,
        geometry: Pick<PixiTravelingOutlineDatum, 'x' | 'y' | 'width' | 'height'>
    ): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.updateEntryGeometry(entry, geometry)
    }

    setVisible(id: string, visible: boolean): void {
        const entry = this.entries.get(id)
        if (!entry) return
        entry.graphics.renderable = visible
    }

    destroy(): void {
        this.destroyed = true
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        for (const id of this.entries.keys()) this.destroyEntry(id)
        this.animationStartedAt = null
    }

    private paint(entry: OutlineEntry, elapsed: number): void {
        const { graphics, width, height } = entry
        const perimeter = getRoundedOutlinePerimeter(width, height, this.style.radius)
        const headDistance = getTravelingOutlineHeadDistance(elapsed, this.style.durationMs, perimeter, this.ease)
        const segmentLength = perimeter * this.style.segmentLengthFraction

        graphics.clear()
        graphics.beginPath()
        graphics.roundRect(0, 0, width, height, this.style.radius)
        graphics.stroke({ color: this.style.trackColor, alpha: this.style.trackAlpha, width: this.style.trackWidth })

        for (let index = 0; index < this.style.segmentCount; index++) {
            const tailProgress = index / this.style.segmentCount
            const headProgress = (index + 1) / this.style.segmentCount
            const start = getRoundedOutlinePoint(width, height, this.style.radius, headDistance - segmentLength * (1 - tailProgress))
            const end = getRoundedOutlinePoint(width, height, this.style.radius, headDistance - segmentLength * (1 - headProgress))
            graphics.beginPath()
            graphics.moveTo(start.x, start.y)
            graphics.lineTo(end.x, end.y)
            graphics.stroke({
                color: interpolateTravelingOutlineColor(this.style.segmentColors, headProgress),
                alpha: this.style.segmentTailAlpha + (1 - this.style.segmentTailAlpha) * headProgress,
                width: this.style.segmentWidth,
                cap: 'round',
            })
        }
    }

    private createEntry(datum: PixiTravelingOutlineDatum): OutlineEntry {
        const graphics = new Graphics()
        graphics.label = 'pixi-traveling-outline'
        graphics.eventMode = 'none'
        this.container.addChild(graphics)
        const entry = { graphics, width: datum.width, height: datum.height }
        this.updateEntryGeometry(entry, datum)
        graphics.renderable = datum.visible
        this.paint(entry, 0)
        return entry
    }

    private updateEntryGeometry(
        entry: OutlineEntry,
        geometry: Pick<PixiTravelingOutlineDatum, 'x' | 'y' | 'width' | 'height'>
    ): void {
        entry.width = geometry.width
        entry.height = geometry.height
        entry.graphics.position.set(geometry.x, geometry.y)
    }

    private destroyEntry(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) return
        this.container.removeChild(entry.graphics)
        entry.graphics.destroy()
        this.entries.delete(id)
    }

    private stopIfIdle(): void {
        if (this.entries.size > 0) return
        if (this.animationRaf !== null) {
            cancelAnimationFrame(this.animationRaf)
            this.animationRaf = null
        }
        this.animationStartedAt = null
    }

    private updateFrame = (timestamp: number): void => {
        this.animationRaf = null
        if (this.destroyed || this.entries.size === 0) {
            this.stopIfIdle()
            return
        }

        this.animationStartedAt ??= timestamp
        const elapsed = timestamp - this.animationStartedAt
        for (const entry of this.entries.values()) {
            if (entry.graphics.renderable) this.paint(entry, elapsed)
        }

        this.onFrame()
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }

    private start(): void {
        if (this.destroyed || this.entries.size === 0 || this.animationRaf !== null) return
        this.animationRaf = requestAnimationFrame(this.updateFrame)
    }
}
