import { ElementStyleLease } from '@lixpi/ui-primitives/dom'
import {
    type CanvasViewport,
} from '../../shared/scene/types.ts'
import { assertViewport } from '../../shared/viewport/coordinates.ts'
import {
    type CanvasPanZoomConfig,
} from './viewport-input-config.ts'
import { Lifetime } from '../runtime/lifetime.ts'

type InputOptions = {
    root: HTMLElement
    viewport: CanvasViewport
    minZoom: number
    maxZoom: number
    onDraggingChange: (dragging: boolean) => void
}
type Point = {
    x: number
    y: number
}
type Contact = {
    point: Point
    anchor: Point
    start: Point
    pointerType: string
    tap: boolean
    startedAt: number
}

export class ViewportInput {
    private readonly lifetime = new Lifetime()
    private readonly view: Window
    private readonly contacts = new Map<number, Contact>()
    private config: CanvasPanZoomConfig | null = null
    private viewport: CanvasViewport
    private gesture: Lifetime | null = null
    private touchStyle: ElementStyleLease | null = null
    private dragging = false
    private moved = false
    private animationFrame: number | null = null
    private animationVersion = 0
    private lastTap: {
        point: Point
        time: number
    } | null = null
    private lastTouchEnd = -Infinity
    private clickGuard: Lifetime | null = null

    constructor(private readonly options: InputOptions) {
        assertViewport(options.viewport)
        const view = options.root.ownerDocument.defaultView

        if (!view)
            throw new Error('Viewport input requires a browser document')

        this.view = view
        this.viewport = { ...options.viewport }

        try {
            const tapStyle = new ElementStyleLease(options.root, { '-webkit-tap-highlight-color': 'rgba(0,0,0,0)' })
            this.lifetime.own(() => tapStyle.destroy())
            this.lifetime.own(() => this.touchStyle?.destroy())
            this.lifetime.own(this.cancel)
            this.listen(
                this.lifetime,
                options.root,
                'wheel',
                this.wheel as EventListener,
                { passive: false },
            )
            this.listen(
                this.lifetime,
                options.root,
                'pointerdown',
                this.pointerDown as EventListener,
            )
            this.listen(
                this.lifetime,
                options.root,
                'dblclick',
                this.doubleClick as EventListener,
            )
            this.listen(
                this.lifetime,
                view,
                'blur',
                this.cancel,
            )
            this.listen(
                this.lifetime,
                options.root.ownerDocument,
                'keydown',
                this.keyDown as EventListener,
                true,
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private listen(
        lifetime: Lifetime,
        target: EventTarget,
        type: string,
        handler: EventListener,
        options?: AddEventListenerOptions | boolean,
    ): void {
        if (lifetime.signal.aborted)
            return

        lifetime.own(
            () => target.removeEventListener(
                type,
                handler,
                options,
            ),
        )
        target.addEventListener(
            type,
            handler,
            options,
        )
    }

    update(config: CanvasPanZoomConfig): void {
        if (this.lifetime.signal.aborted)
            return

        this.config = config
        const needsTouchStyle = config.panOnDrag && !config.userSelectionActive

        if (
            needsTouchStyle
            && !this.touchStyle
        )
            this.touchStyle = new ElementStyleLease(this.options.root, { 'touch-action': 'none' })
        else if (
            !needsTouchStyle
            && this.touchStyle
        ) {
            this.touchStyle.destroy()
            this.touchStyle = null
        }

        if (
            config.userSelectionActive
            || config.connectionInProgress
        )
            this.cancel()
    }

    private excluded(
        event: Event,
        className: string,
    ): boolean {
        const element = event.target as Element | null

        return Boolean(className && element?.closest?.(`.${className}`))
    }

    private admit(event: MouseEvent): boolean {
        const config = this.config

        if (
            !config
            || this.lifetime.signal.aborted
            || config.userSelectionActive
        )
            return false

        const wheel = event.type === 'wheel'
        const zoomScroll = config.zoomActivationKeyPressed || config.zoomOnScroll

        if (
            !config.panOnDrag
            && !zoomScroll
            && !config.panOnScroll
            && !config.zoomOnDoubleClick
            && !config.zoomOnPinch
        )
            return false

        if (
            config.connectionInProgress
            && !wheel
        )
            return false

        if (
            wheel
            && this.excluded(event, config.noWheelClassName)
        )
            return false

        if (
            this.excluded(event, config.noPanClassName)
            && (!wheel || (config.panOnScroll && !config.zoomActivationKeyPressed))
        )
            return false

        if (
            !config.zoomOnPinch
            && event.ctrlKey
            && wheel
        )
            return false

        if (
            wheel
            && !zoomScroll
            && !config.panOnScroll
            && !(config.zoomOnPinch && event.ctrlKey)
        )
            return false

        if (
            !config.panOnDrag
            && event.type === 'pointerdown'
        )
            return false

        return (!event.ctrlKey || wheel) && event.button <= 1
    }

    private localPoint(event: MouseEvent): Point {
        const root = this.options.root
        const rect = root.getBoundingClientRect()

        return {
            x: event.clientX - rect.left - root.clientLeft,
            y: event.clientY - rect.top - root.clientTop,
        }
    }

    private worldPoint(point: Point): Point {
        return {
            x: (point.x - this.viewport.x) / this.viewport.zoom,
            y: (point.y - this.viewport.y) / this.viewport.zoom,
        }
    }

    private clampZoom(zoom: number): number {
        return Math.min(
            Math.max(zoom, this.options.minZoom),
            this.options.maxZoom,
        )
    }

    private publish(viewport: CanvasViewport): void {
        assertViewport(viewport)
        this.viewport = viewport
        this.config?.onTransformChange([viewport.x, viewport.y, viewport.zoom])
    }

    private anchored(
        point: Point,
        anchor: Point,
        zoom: number,
    ): CanvasViewport {
        return {
            x: point.x - anchor.x * zoom,
            y: point.y - anchor.y * zoom,
            zoom,
        }
    }

    private rebase(): void {
        for (const contact of this.contacts.values())
            contact.anchor = this.worldPoint(contact.point)
    }

    private wheel = (event: WheelEvent): void => {
        const config = this.config

        if (
            !config
            || this.lifetime.signal.aborted
            || config.userSelectionActive
        )
            return

        if (this.excluded(event, config.noWheelClassName)) {
            if (event.ctrlKey)
                event.preventDefault()

            return
        }

        const pan = config.panOnScroll && !config.zoomActivationKeyPressed

        if (
            !pan
            && !config.preventScrolling
            && !event.ctrlKey
        )
            return

        if (
            !pan
            && !this.admit(event)
        ) {
            event.preventDefault()

            return
        }

        event.preventDefault()
        const mac = this.view.navigator.userAgent.includes('Mac')
        const current = this.viewport.zoom

        if (
            (pan && event.ctrlKey && config.zoomOnPinch)
            || !pan
        ) {
            const delta = -event.deltaY * (event.deltaMode === 1
                ? 0.05
                : event.deltaMode
                    ? 1
                    : 0.002) * (event.ctrlKey
                        && mac
                        ? 10
                        : 1)
            const nextZoom = this.clampZoom(current * 2 ** delta)

            if (
                !pan
                && nextZoom === current
            )
                return

            event.stopImmediatePropagation()
            this.stopAnimation()
            const point = this.localPoint(event)
            this.publish(
                this.anchored(
                    point,
                    this.worldPoint(point),
                    nextZoom,
                ),
            )
            this.rebase()

            return
        }

        const normalize = event.deltaMode === 1 ? 20 : 1
        event.stopImmediatePropagation()
        this.stopAnimation()
        let x = config.panOnScrollMode === 'vertical' ? 0 : event.deltaX * normalize
        let y = config.panOnScrollMode === 'horizontal' ? 0 : event.deltaY * normalize

        if (
            !mac
            && event.shiftKey
            && config.panOnScrollMode !== 'vertical'
        ) {
            x = event.deltaY * normalize
            y = 0
        }

        this.publish({
            x: this.viewport.x - x * config.panOnScrollSpeed,
            y: this.viewport.y - y * config.panOnScrollSpeed,
            zoom: current,
        })
        this.rebase()
    }

    private pointerDown = (event: PointerEvent): void => {
        if (
            event.defaultPrevented
            || !this.admit(event)
            || this.contacts.has(event.pointerId)
        )
            return

        const pointerType = event.pointerType || 'mouse'
        const first = this.contacts.values().next().value as Contact | undefined

        if (
            first
            && (first.pointerType !== 'touch' || pointerType !== 'touch')
        )
            return

        if (
            first
            && !this.config?.zoomOnPinch
        ) {
            event.preventDefault()

            return
        }

        this.stopAnimation()
        this.clickGuard?.destroy()
        this.clickGuard = null
        const point = this.localPoint(event)

        if (!this.gesture) {
            this.moved = false
            const gesture = this.lifetime.child()
            this.gesture = gesture
            const selectionStyle = new ElementStyleLease(this.options.root.ownerDocument.documentElement, { 'user-select': 'none' })
            gesture.own(() => selectionStyle.destroy())
            this.listen(
                gesture,
                this.view,
                'pointermove',
                this.pointerMove as EventListener,
                true,
            )
            this.listen(
                gesture,
                this.view,
                'pointerup',
                this.pointerUp as EventListener,
                true,
            )
            this.listen(
                gesture,
                this.view,
                'pointercancel',
                this.pointerCancel as EventListener,
                true,
            )
            this.listen(
                gesture,
                this.options.root,
                'lostpointercapture',
                this.pointerCancel as EventListener,
            )
            this.listen(
                gesture,
                this.view,
                'dragstart',
                this.preventNativeDrag,
                true,
            )
            this.listen(
                gesture,
                this.view,
                'selectstart',
                this.preventNativeDrag,
                true,
            )
        }

        this.contacts.set(
            event.pointerId,
            {
                point,
                anchor: this.worldPoint(point),
                start: point,
                pointerType,
                tap: pointerType === 'touch' && !first,
                startedAt: this.view.performance.now(),
            },
        )

        if (first) {
            this.lastTap = null

            for (const contact of this.contacts.values())
                contact.tap = false
        }

        this.rebase()

        try {
            this.options.root.setPointerCapture(event.pointerId)
        } catch {
            // Window listeners still own the gesture if the pointer was already released.
        }

        event.stopPropagation()

        if (
            pointerType !== 'touch'
            && !this.dragging
        ) {
            this.dragging = true
            this.options.onDraggingChange(true)
        }
    }

    private preventNativeDrag = (event: Event): void => {
        const target = event.target as Node | null

        if (
            target
            && this.options.root.contains(target)
        )
            event.preventDefault()
    }

    private pointerMove = (event: PointerEvent): void => {
        const contact = this.contacts.get(event.pointerId)

        if (!contact)
            return

        // A release outside the WebView may arrive only as a later hover event.
        if (
            contact.pointerType !== 'touch'
            && event.buttons === 0
        ) {
            this.cancel()

            return
        }

        event.preventDefault()
        contact.point = this.localPoint(event)
        const distance = Math.hypot(contact.point.x - contact.start.x, contact.point.y - contact.start.y)
        const configuredDistance = this.config?.paneClickDistance ?? 0
        const clickDistance = this.config?.selectionOnDrag ? Infinity : Math.max(0, Number.isFinite(configuredDistance) ? configuredDistance : 0)
        this.moved ||= distance > clickDistance
        contact.tap &&= distance < 10
        const [first, second] = this.contacts.values()

        if (!first)
            return

        let point = first.point
        let anchor = first.anchor
        let zoom = this.viewport.zoom
        let rebaseCoincidentContacts = false

        if (second) {
            const worldDistance = Math.hypot(second.anchor.x - first.anchor.x, second.anchor.y - first.anchor.y)

            if (worldDistance > 0)
                zoom = this.clampZoom(Math.hypot(second.point.x - first.point.x, second.point.y - first.point.y) / worldDistance)
            else
                rebaseCoincidentContacts = true

            point = {
                x: (first.point.x + second.point.x) / 2,
                y: (first.point.y + second.point.y) / 2,
            }
            anchor = {
                x: (first.anchor.x + second.anchor.x) / 2,
                y: (first.anchor.y + second.anchor.y) / 2,
            }
        }

        this.publish(
            this.anchored(
                point,
                anchor,
                zoom,
            ),
        )

        if (rebaseCoincidentContacts)
            this.rebase()
    }

    private releaseCapture(id: number): void {
        const root = this.options.root

        if (root.hasPointerCapture?.(id))
            root.releasePointerCapture(id)
    }

    private pointerUp = (event: PointerEvent): void => {
        const contact = this.contacts.get(event.pointerId)

        if (!contact)
            return

        this.contacts.delete(event.pointerId)
        this.releaseCapture(event.pointerId)
        this.rebase()

        if (this.contacts.size)
            return

        this.finishGesture()

        if (
            this.lifetime.signal.aborted
            || this.config?.userSelectionActive
        )
            return

        if (this.moved)
            this.suppressClick()

        const now = this.view.performance.now()
        const point = this.localPoint(event)

        if (contact.pointerType === 'touch')
            this.lastTouchEnd = now

        if (
            !contact.tap
            || now - contact.startedAt > 500
            || Math.hypot(point.x - contact.start.x, point.y - contact.start.y) >= 10
        ) {
            this.lastTap = null

            return
        }

        const previous = this.lastTap
        this.lastTap = {
            point,
            time: now,
        }

        if (
            previous
            && now - previous.time < 500
            && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 10
        ) {
            this.lastTap = null

            if (this.config?.zoomOnDoubleClick) {
                event.preventDefault()
                this.animateZoom(point, false)
            }
        }
    }

    private pointerCancel = (event: PointerEvent): void => {
        if (this.contacts.has(event.pointerId))
            this.cancel()
    }

    private keyDown = (event: KeyboardEvent): void => {
        if (
            event.key === 'Escape'
            && (this.gesture || this.animationFrame !== null)
        )
            this.cancel()
    }

    private suppressClick(): void {
        this.clickGuard?.destroy()
        const guard = this.lifetime.child()
        this.clickGuard = guard
        this.listen(
            guard,
            this.options.root,
            'click',
            event => {
                event.preventDefault()
                event.stopImmediatePropagation()
            },
            true,
        )
        const timer = this.view.setTimeout(() => {
            guard.destroy()

            if (this.clickGuard === guard)
                this.clickGuard = null
        }, 0)
        guard.own(() => this.view.clearTimeout(timer))
    }

    private finishGesture(): void {
        const ids = [...this.contacts.keys()]
        this.contacts.clear()
        this.gesture?.destroy()
        this.gesture = null

        for (const id of ids)
            this.releaseCapture(id)

        if (this.dragging) {
            this.dragging = false
            this.options.onDraggingChange(false)
        }
    }

    private doubleClick = (event: MouseEvent): void => {
        if (
            !this.config?.zoomOnDoubleClick
            || !this.admit(event)
        )
            return

        event.preventDefault()
        event.stopImmediatePropagation()

        if (this.view.performance.now() - this.lastTouchEnd < 500)
            return

        this.animateZoom(
            this.localPoint(event),
            event.shiftKey,
        )
    }

    private animateZoom(
        point: Point,
        reverse: boolean,
    ): void {
        this.stopAnimation()
        const version = this.animationVersion
        const startZoom = this.viewport.zoom
        const endZoom = this.clampZoom(startZoom * (reverse ? 0.5 : 2))
        const anchor = this.worldPoint(point)
        const startedAt = this.view.performance.now()
        const frame = (time: number): void => {
            if (
                version !== this.animationVersion
                || this.lifetime.signal.aborted
            )
                return

            this.animationFrame = null
            const progress = Math.min(
                1,
                Math.max(0, (time - startedAt) / 250),
            )
            const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
            const zoom = progress === 1 ? endZoom : startZoom * (endZoom / startZoom) ** eased
            this.publish(
                this.anchored(
                    point,
                    anchor,
                    zoom,
                ),
            )
            this.rebase()

            if (
                progress < 1
                && version === this.animationVersion
                && !this.lifetime.signal.aborted
            )
                this.animationFrame = this.view.requestAnimationFrame(frame)
        }
        this.animationFrame = this.view.requestAnimationFrame(frame)
    }

    private stopAnimation(): void {
        this.animationVersion++

        if (this.animationFrame !== null)
            this.view.cancelAnimationFrame(this.animationFrame)

        this.animationFrame = null
    }

    syncViewport(viewport: CanvasViewport): void {
        if (this.lifetime.signal.aborted)
            return

        assertViewport(viewport)

        // Hosts echo accepted intents synchronously; those must not interrupt animation.
        if (
            viewport.x === this.viewport.x
            && viewport.y === this.viewport.y
            && viewport.zoom === this.viewport.zoom
        )
            return

        this.stopAnimation()
        this.viewport = { ...viewport }
        this.rebase()
    }

    async setViewport(viewport: CanvasViewport): Promise<boolean> {
        if (
            this.lifetime.signal.aborted
            || this.config?.userSelectionActive
        )
            return false

        assertViewport(viewport)
        this.stopAnimation()
        this.publish({ ...viewport })
        this.rebase()

        return true
    }

    private cancel = (): void => {
        this.stopAnimation()
        this.lastTap = null
        this.clickGuard?.destroy()
        this.clickGuard = null
        this.finishGesture()
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
