import { getElementBorderRadius } from '@lixpi/ui-primitives/dom'
import {
    GlassBorder,
    type GlassBorderOptions,
} from './glass-border.ts'
import {
    type GlassBorderDatum,
} from './glass-border-geometry.ts'

export type DomGlassTarget = {
    id: string
    element: HTMLElement
}
export type DomGlassBorderOptions = GlassBorderOptions & { root: HTMLElement }

export class DomGlassBorder {
    private readonly border: GlassBorder
    private readonly observer: ResizeObserver
    private targets: readonly DomGlassTarget[] = []
    private readonly radii = new Map<HTMLElement, {
        width: number
        height: number
        radius: number
    }>()
    // Properties each target is transitioning. A ResizeObserver misses a target
    // that slides by transform, so the border redraws every frame until the
    // transitions settle.
    private readonly moving = new Map<HTMLElement, Set<string>>()
    private frame: number | null = null
    private destroyed = false

    constructor(private readonly options: DomGlassBorderOptions) {
        this.observer = new ResizeObserver(() => options.surface.invalidate())

        try {
            this.border = new GlassBorder(options)
        } catch (error) {
            this.observer.disconnect()

            throw error
        }

        options.surface.signal.addEventListener(
            'abort',
            this.destroy,
            { once: true },
        )
    }

    setAppearance(
        style: GlassBorderOptions['style'],
        texture: GlassBorderOptions['texture'],
    ): void {
        if (this.destroyed)
            return

        this.border.setAppearance(style, texture)
        this.radii.clear()
        this.refresh()
    }

    setTargets(targets: readonly DomGlassTarget[]): void {
        if (this.destroyed)
            return

        this.observer.disconnect()
        this.stopFollowing()
        this.targets = [...targets]
        this.radii.clear()

        for (const target of targets) {
            this.observer.observe(target.element)
            target.element.addEventListener('transitionrun', this.handleTransitionRun)
            target.element.addEventListener('transitionend', this.handleTransitionStop)
            target.element.addEventListener('transitioncancel', this.handleTransitionStop)
        }

        this.options.surface.invalidate()
    }

    refresh(): void {
        if (this.destroyed)
            return

        const root = this.options.root.getBoundingClientRect()
        const datums: GlassBorderDatum[] = []

        for (const {
            id,
            element,
        } of this.targets) {
            if (!element.isConnected)
                continue

            const rect = element.getBoundingClientRect()

            if (
                !Number.isFinite(rect.width)
                || !Number.isFinite(rect.height)
                || rect.width <= 0
                || rect.height <= 0
            )
                continue

            let cached = this.radii.get(element)

            if (
                !cached
                || cached.width !== rect.width
                || cached.height !== rect.height
            ) {
                cached = {
                    width: rect.width,
                    height: rect.height,
                    radius: getElementBorderRadius(
                        element,
                        rect.width,
                        rect.height,
                    ),
                }
                this.radii.set(element, cached)
            }

            datums.push({
                id,
                x: rect.left - root.left,
                y: rect.top - root.top,
                width: rect.width,
                height: rect.height,
                radius: cached.radius,
                visible: true,
            })
        }

        this.border.sync(
            datums,
            {
                width: root.width,
                height: root.height,
            },
        )
    }

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.options.surface.signal.removeEventListener('abort', this.destroy)
        this.observer.disconnect()
        this.stopFollowing()
        this.border.destroy()
        this.targets = []
        this.radii.clear()
    }

    private readonly handleTransitionRun = (event: Event): void => {
        const element = event.currentTarget as HTMLElement

        if (
            this.destroyed
            || event.target !== element
        )
            return

        const properties = this.moving.get(element) ?? new Set<string>()
        properties.add((event as TransitionEvent).propertyName)
        this.moving.set(element, properties)
        this.follow()
    }

    private readonly handleTransitionStop = (event: Event): void => {
        const element = event.currentTarget as HTMLElement
        const properties = this.moving.get(element)

        if (
            this.destroyed
            || event.target !== element
            || !properties
        )
            return

        properties.delete((event as TransitionEvent).propertyName)

        if (properties.size === 0)
            this.moving.delete(element)

        this.options.surface.invalidate()
    }

    private follow(): void {
        const view = this.options.root.ownerDocument.defaultView

        if (
            this.frame !== null
            || this.moving.size === 0
            || !view
        )
            return

        this.frame = view.requestAnimationFrame(() => {
            this.frame = null

            if (
                this.destroyed
                || this.moving.size === 0
            )
                return

            this.options.surface.invalidate()
            this.follow()
        })
    }

    private stopFollowing(): void {
        for (const { element } of this.targets) {
            element.removeEventListener('transitionrun', this.handleTransitionRun)
            element.removeEventListener('transitionend', this.handleTransitionStop)
            element.removeEventListener('transitioncancel', this.handleTransitionStop)
        }

        this.moving.clear()

        if (this.frame !== null)
            this.options.root.ownerDocument.defaultView?.cancelAnimationFrame(this.frame)

        this.frame = null
    }
}
