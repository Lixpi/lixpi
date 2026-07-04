// SidePanel - reusable resizable side panel for a canvas-hosted panel.
//
// Renderer: TypeScript `html` DOM (no Svelte). It is meant to be mounted as a
// child of any canvas-hosted panel element. The component renders the resize
// handle, optional overlay, optional toggle, and owns the resize lifecycle:
//
//   - It is the single source of truth for the panel width.
//   - It tracks every resize gesture (drag) and clamps the width to its
//     min / dynamic-max constraints.
//   - It persists the width through an injected adapter (`loadState` /
//     `persistState`) so storage stays host-owned but the *when* is owned here.
//   - It exposes that state to external sources that can both modify it
//     (`setWidth`) and consume it (`getWidth`, `getState`, `subscribe`,
//     `onResize`).
//
// The host's only job is to reflect the reported width into its own DOM (CSS
// variables, dependent layout), append the optional overlay/backdrop surfaces,
// and apply requested open-state changes. It does not clamp, store, or decide
// width.
//
// The panel can sit on either edge of the screen:
//   - side: 'right'  -> panel lives on the right, its resize handle hugs the
//     panel's left edge; dragging left grows the panel.
//   - side: 'left'   -> panel lives on the left, its resize handle hugs the
//     panel's right edge; dragging right grows the panel.

import { html, applyStyle } from '$src/utils/domTemplates.ts'

export type SidePanelSide = 'left' | 'right'

export type SidePanelToggleMotion = 'slide' | 'fixed'

export type SidePanelStyles = {
    // Background gradient painted on the visible resize handle line.
    gradient?: string
    // Visible resize handle line thickness, e.g. '3px'.
    width?: string
}

export type SidePanelToggleConfig = {
    iconSvg: string
    className?: string
    // `slide` keeps the existing drawer behavior: the toggle travels with the
    // panel edge. `fixed` leaves the toggle anchored so the panel opens under it.
    motion?: SidePanelToggleMotion
    openAriaLabel: string
    closedAriaLabel: string
    openOffset?: string
    closedTravel?: string
    top?: string
    size?: string
    onToggle: () => void
}

export type SidePanelAnimationConfig = {
    durationMs: number
    easing?: string
    openEasing?: string
    closeEasing?: string
}

export type SidePanelOverlayConfig = {
    enabled: boolean
    className?: string
    fill?: string
    fillOpaque?: string
    opacity?: number
    closeOnPointerDown?: boolean
}

export type SidePanelDragConfig = {
    enabled: boolean
    closeThreshold?: number
    velocityThreshold?: number
    pointerSwipeStartThreshold?: number
    touchSwipeStartThreshold?: number
}

// Persisted resize state. `width` is null when the user has never resized the
// panel (the panel then renders at its default width).
export type SidePanelState = {
    width: number | null
}

export type SidePanelSetWidthOptions = {
    // Persist the new width through the configured `persistState` adapter.
    persist?: boolean
    // Skip emitting change notifications (callbacks + subscribers).
    silent?: boolean
}

export type SidePanelConfig = {
    // Which edge of the screen the panel (and therefore its resize handle) hugs.
    side: SidePanelSide
    // Distance in px from the panel edge to the resize handle center.
    offset: number
    // Screen-pixel width of the invisible drag hit target.
    grabWidth: number
    // Extra class for callers that want to style this panel's resize handle separately.
    className?: string
    styles?: SidePanelStyles
    toggle?: SidePanelToggleConfig
    animation?: SidePanelAnimationConfig
    overlay?: SidePanelOverlayConfig
    drag?: SidePanelDragConfig

    // Resize constraints. `getMaxWidth` is a getter because the upper bound is
    // dynamic (it depends on the available canvas/pane width).
    minWidth: number
    defaultWidth: number
    getMaxWidth: () => number
    // Optional measurement of the panel's actual rendered width, used as the
    // start width for the first drag before any width has been set.
    measureWidth?: () => number

    // Persistence adapter. The component decides *when* to load and save; the
    // host owns *where* the state lives.
    loadState?: () => SidePanelState | null | undefined
    persistState?: (state: SidePanelState) => void

    // Resize lifecycle. `onResize` fires for every applied width change (drag
    // moves and programmatic `setWidth`); use it, or `subscribe`, to reflect the
    // width into host DOM.
    onResizeStart?: () => void
    onResize?: (width: number) => void
    onResizeEnd?: (width: number) => void
    onOpenChange?: (open: boolean) => void
}

export type SidePanelInstance = {
    // The resize handle element appended by the host into its panel element.
    element: HTMLDivElement
    // The translucent glass backdrop — a sibling that sits behind the panel and
    // blurs the canvas behind it. Appended by the host into the same container as
    // the panel. The component owns its element and all glass styling.
    backdropElement: HTMLDivElement
    // Optional full-container overlay behind the panel. Appended by the host into
    // the same container as the panel, before the backdrop/panel surfaces.
    overlayElement: HTMLDivElement | null
    // Optional component-owned open/collapse button. Appended by the host into the
    // same container as the panel; it either slides with the drawer or stays fixed.
    toggleElement: HTMLButtonElement | null
    // Resolved, clamped current width (always a concrete number).
    getWidth: () => number
    // Raw stored width: null when the user has never resized.
    getRawWidth: () => number | null
    // The persistable state snapshot.
    getState: () => SidePanelState
    // Modify the width from an external source. Returns the clamped value.
    setWidth: (width: number, options?: SidePanelSetWidthOptions) => number
    // Re-clamp the current width against the (possibly changed) constraints.
    applyConstraints: () => void
    // Consume width changes. Returns an unsubscribe function.
    subscribe: (listener: (width: number) => void) => () => void
    setSelected: (selected: boolean) => void
    setResizing: (resizing: boolean) => void
    setOpen: (open: boolean) => void
    mountOpen: (panelElement: HTMLElement) => void
    // Put the panel/backdrop and optional overlay in their start state before the
    // host appends them. Call immediately before mounting for a visible open slide.
    prepareOpen: (panelElement: HTMLElement) => void
    // Drawer-style reveal. Slides the given panel element and glass backdrop in
    // from the edge this panel hugs, and fades the optional overlay. Call once,
    // right after the host mounts the panel — re-renders should not replay it.
    playOpen: (panelElement: HTMLElement) => Promise<void>
    // Slides the panel and backdrop back out to their edge and fades the optional
    // overlay. Resolves once the animation settles so the host can tear the panel
    // down. Safe to call even if `playOpen` was never invoked.
    playClose: () => Promise<void>
    detachPanel: () => void
    destroy: () => void
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

const SLIDE_DEFAULT_DURATION_MS = 500
const SLIDE_DEFAULT_OPEN_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SLIDE_DEFAULT_CLOSE_EASING = 'cubic-bezier(0.64, 0, 0.78, 0)'
const SLIDE_FALLBACK_BUFFER_MS = 80
const SLIDE_TRANSITION = 'var(--side-panel-slide-transition)'
const OVERLAY_TRANSITION = 'var(--side-panel-overlay-transition)'
const OVERLAY_DEFAULT_OPACITY = 1
const DRAG_CLOSE_THRESHOLD = 0.25
const DRAG_VELOCITY_THRESHOLD = 0.4
const DRAG_MOUSE_START_THRESHOLD = 2
const DRAG_TOUCH_START_THRESHOLD = 10
const OVERLAY_CLICK_DISTANCE = 4

type SlideTarget = {
    element: HTMLElement
    startTransform: string
    endTransform: string
}

type PanelDragState = {
    pointerId: number
    startX: number
    startY: number
    startTimeMs: number
    panelWidth: number
    pointerType: string
    hasStarted: boolean
    lastEvent: PointerEvent
}

type OverlayPointerStart = {
    clientX: number
    clientY: number
}

class SidePanel implements SidePanelInstance {
    readonly element: HTMLDivElement
    readonly backdropElement: HTMLDivElement
    readonly overlayElement: HTMLDivElement | null
    readonly toggleElement: HTMLButtonElement | null
    // Single source of truth for the panel width. null = never resized.
    private width: number | null = null
    private readonly listeners = new Set<(width: number) => void>()
    private detachDrag: (() => void) | null = null
    private detachPanelDrag: (() => void) | null = null
    // The host panel element currently driven by the open/close slide animation.
    private animatedPanel: HTMLElement | null = null
    private slideRunId = 0
    private finishSlideWait: (() => void) | null = null
    private isOpen = false
    private panelDragState: PanelDragState | null = null
    private overlayPointerStart: OverlayPointerStart | null = null
    private closeFromCurrentTransforms = false

    constructor(private readonly config: SidePanelConfig) {
        const loaded = config.loadState?.()
        if (loaded && loaded.width != null) this.width = loaded.width

        const { offset, grabWidth, side, className } = config

        const edgeOffset = `${-offset - grabWidth / 2}px`
        const resizeHandleStyle = {
            position: 'absolute' as const,
            width: `${grabWidth}px`,
            top: '0',
            ...(side === 'left' ? { right: edgeOffset } : { left: edgeOffset }),
        }

        this.element = html`<div
            className=${`side-panel-resize-handle side-panel-resize-handle-${side} nopan${className ? ` ${className}` : ''}`}
            style=${resizeHandleStyle}
        ></div>` as HTMLDivElement

        const styles = config.styles
        if (styles?.gradient) this.element.style.setProperty('--side-panel-resize-handle-gradient', styles.gradient)
        if (styles?.width) this.element.style.setProperty('--side-panel-resize-handle-width', styles.width)

        const resizeHandleLine = html`<div className="side-panel-resize-handle-line"></div>` as HTMLDivElement
        this.element.appendChild(resizeHandleLine)
        this.applyAnimationSettings(this.element)
        // Pointer events unify mouse, touch, and pen, so the resize handle works
        // on touch devices without a separate touch code path.
        this.element.addEventListener('pointerdown', this.handleResizeStart)

        // Translucent glass backdrop. It is a sibling that sits behind the panel
        // (lower z-index) and blurs the canvas behind it. Its width tracks the
        // panel width so its inner edge sits flush with the panel edge.
        this.backdropElement = html`<div
            className=${`side-panel-backdrop side-panel-backdrop-${side}`}
            aria-hidden="true"
        ></div>` as HTMLDivElement

        this.overlayElement = config.overlay?.enabled ? this.createOverlayElement(config.overlay) : null
        this.toggleElement = config.toggle ? this.createToggleElement(config.toggle) : null
        this.applyAnimationSettings(this.backdropElement)
        if (this.overlayElement) this.applyOverlaySettings(this.overlayElement)
        if (this.toggleElement) this.applyAnimationSettings(this.toggleElement)
        if (this.overlayElement) {
            document.addEventListener('pointerdown', this.handleOverlayPointerDown, true)
            document.addEventListener('click', this.handleOverlayClick, true)
        }
        this.setOpen(false)
        if (this.toggleElement) {
            applyStyle(this.toggleElement, {
                transition: this.config.toggle?.motion === 'fixed' ? '' : 'none',
                transform: this.getToggleClosedTransform(),
            })
        }
    }

    getWidth = (): number => {
        const max = this.config.getMaxWidth()
        if (this.width !== null) return clamp(this.width, this.config.minWidth, max)
        return Math.min(this.config.defaultWidth, max)
    }

    getRawWidth = (): number | null => this.width

    getState = (): SidePanelState => ({ width: this.width })

    setWidth = (width: number, options: SidePanelSetWidthOptions = {}): number => {
        const next = clamp(width, this.config.minWidth, this.config.getMaxWidth())
        this.width = next
        if (!options.silent) this.emit(next)
        if (options.persist) this.persist()
        return next
    }

    applyConstraints = (): void => {
        if (this.width === null) return
        this.setWidth(this.width)
    }

    subscribe = (listener: (width: number) => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    private emit = (width: number): void => {
        this.config.onResize?.(width)
        for (const listener of this.listeners) listener(width)
    }

    private persist = (): void => {
        this.config.persistState?.(this.getState())
    }

    private getSlideDurationMs = (): number => {
        const durationMs = this.config.animation?.durationMs
        return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
            ? durationMs
            : SLIDE_DEFAULT_DURATION_MS
    }

    private getSlideEasing = (direction?: 'in' | 'out'): string => {
        const easing = direction === 'in'
            ? this.config.animation?.openEasing?.trim()
            : direction === 'out'
                ? this.config.animation?.closeEasing?.trim()
                : this.config.animation?.easing?.trim()
        const fallback = this.config.animation?.easing?.trim()
        if (easing) return easing
        if (fallback) return fallback
        return direction === 'in' ? SLIDE_DEFAULT_OPEN_EASING : SLIDE_DEFAULT_CLOSE_EASING
    }

    private applyAnimationSettings = (element: HTMLElement, direction?: 'in' | 'out'): void => {
        element.style.setProperty('--side-panel-slide-duration', `${this.getSlideDurationMs()}ms`)
        element.style.setProperty('--side-panel-slide-easing', this.getSlideEasing(direction))
    }

    private applyOverlaySettings = (element: HTMLElement, direction?: 'in' | 'out'): void => {
        this.applyAnimationSettings(element, direction)
        const overlay = this.config.overlay
        if (overlay?.fill) element.style.setProperty('--side-panel-overlay-fill', overlay.fill)
        if (overlay?.fillOpaque) element.style.setProperty('--side-panel-overlay-fill-opaque', overlay.fillOpaque)
    }

    private getOverlayOpacity = (): number => {
        const opacity = this.config.overlay?.opacity
        return typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0
            ? opacity
            : OVERLAY_DEFAULT_OPACITY
    }

    // Resolve the width to start a drag from. Prefer the stored width; otherwise
    // measure the actual rendered panel, falling back to the resolved default.
    private getDragStartWidth = (): number => {
        if (this.width !== null) return clamp(this.width, this.config.minWidth, this.config.getMaxWidth())
        return this.config.measureWidth?.() ?? this.getWidth()
    }

    setSelected = (selected: boolean): void => {
        this.element.classList.toggle('is-selected', selected)
    }

    setResizing = (resizing: boolean): void => {
        this.element.classList.toggle('is-resizing', resizing)
    }

    setOpen = (open: boolean): void => {
        this.isOpen = open
        this.toggleElement?.classList.toggle('side-panel-toggle-open', open)
        this.overlayElement?.classList.toggle('side-panel-overlay-open', open)
        if (this.toggleElement && this.config.toggle) {
            this.toggleElement.ariaLabel = open
                ? this.config.toggle.openAriaLabel
                : this.config.toggle.closedAriaLabel
        }
    }

    private handleResizeStart = (event: PointerEvent): void => {
        // Only the primary button/contact starts a resize; ignore secondary
        // mouse buttons and multi-touch.
        if (event.button !== 0) return

        event.preventDefault()
        event.stopPropagation()

        const startX = event.clientX
        const startWidth = this.getDragStartWidth()
        const sign = this.config.side === 'left' ? 1 : -1
        const previousBodyCursor = document.body.style.cursor
        const previousBodyUserSelect = document.body.style.userSelect
        const pointerId = event.pointerId

        this.setResizing(true)
        applyStyle(document.body, { cursor: 'ew-resize', userSelect: 'none' })
        this.config.onResizeStart?.()

        // Capture the pointer so the drag keeps tracking past the thin resize
        // handle and outside the window, on both mouse and touch.
        const canCapture = Number.isFinite(pointerId) && typeof this.element.setPointerCapture === 'function'
        if (canCapture) this.element.setPointerCapture(pointerId)

        const handlePointerMove = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) return
            this.setWidth(startWidth + sign * (moveEvent.clientX - startX))
        }

        const handlePointerUp = (upEvent: PointerEvent): void => {
            if (upEvent.pointerId !== pointerId) return
            this.detach()
            this.setResizing(false)
            applyStyle(document.body, { cursor: previousBodyCursor, userSelect: previousBodyUserSelect })
            this.persist()
            this.config.onResizeEnd?.(this.getWidth())
        }

        this.detachDrag = (): void => {
            if (canCapture && this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId)
            document.removeEventListener('pointermove', handlePointerMove)
            document.removeEventListener('pointerup', handlePointerUp)
            document.removeEventListener('pointercancel', handlePointerUp)
            this.detachDrag = null
        }

        document.addEventListener('pointermove', handlePointerMove)
        document.addEventListener('pointerup', handlePointerUp)
        document.addEventListener('pointercancel', handlePointerUp)
    }

    private detach = (): void => {
        this.detachDrag?.()
    }

    private createToggleElement(toggleConfig: SidePanelToggleConfig): HTMLButtonElement {
        const toggleStyle: Partial<CSSStyleDeclaration> = {
            ...(toggleConfig.top ? { top: toggleConfig.top } : {}),
            ...(toggleConfig.size ? { width: toggleConfig.size, height: toggleConfig.size } : {}),
            ...(this.config.side === 'left'
                ? { left: toggleConfig.openOffset ?? '20px' }
                : { right: toggleConfig.openOffset ?? '20px' }),
        }
        const toggleElement = html`<button
            className=${`side-panel-toggle side-panel-toggle-${this.config.side} nopan${toggleConfig.className ? ` ${toggleConfig.className}` : ''}`}
            type="button"
            style=${toggleStyle}
            innerHTML=${toggleConfig.iconSvg}
            onclick=${this.handleToggleClick}
        ></button>` as HTMLButtonElement
        if (toggleConfig.closedTravel) toggleElement.style.setProperty('--side-panel-toggle-closed-travel', toggleConfig.closedTravel)
        return toggleElement
    }

    private createOverlayElement(overlayConfig: SidePanelOverlayConfig): HTMLDivElement {
        const overlayElement = html`<div
            className=${`side-panel-overlay side-panel-overlay-${this.config.side}${overlayConfig.closeOnPointerDown === false ? '' : ' side-panel-overlay-dismissible'}${overlayConfig.className ? ` ${overlayConfig.className}` : ''}`}
            aria-hidden="true"
        ></div>` as HTMLDivElement
        return overlayElement
    }

    private handleToggleClick = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        this.config.toggle?.onToggle()
    }

    private handleOverlayPointerDown = (event: PointerEvent): void => {
        this.overlayPointerStart = null
        if (!this.isOpen) return
        if (this.config.overlay?.closeOnPointerDown === false) return
        if (event.button !== 0 || event.isPrimary === false) return
        if (!this.isEventInsideOverlay(event)) return
        if (this.shouldIgnoreOverlayCloseTarget(event.target)) return
        this.overlayPointerStart = {
            clientX: event.clientX,
            clientY: event.clientY,
        }
    }

    private handleOverlayClick = (event: MouseEvent): void => {
        if (!this.isOpen) return
        if (this.config.overlay?.closeOnPointerDown === false) return
        if (event.button !== 0) return
        if (!this.isEventInsideOverlay(event)) return
        if (this.shouldIgnoreOverlayCloseTarget(event.target)) return

        event.preventDefault()
        event.stopPropagation()

        const start = this.overlayPointerStart
        this.overlayPointerStart = null
        if (start) {
            const distance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY)
            if (distance > OVERLAY_CLICK_DISTANCE) return
        }

        this.config.onOpenChange?.(false)
    }

    private isEventInsideOverlay = (event: MouseEvent | PointerEvent): boolean => {
        if (!this.overlayElement) return false
        const rect = this.overlayElement.getBoundingClientRect()
        return (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
        )
    }

    private shouldIgnoreOverlayCloseTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Node)) return false
        if (this.animatedPanel?.contains(target)) return true
        if (this.toggleElement?.contains(target)) return true
        if (this.element.contains(target)) return true
        return false
    }

    mountOpen = (panelElement: HTMLElement): void => {
        this.setAnimatedPanel(panelElement)
        this.setOpen(true)
        const targets = this.getSlideTargets(panelElement, 'in')
        for (const target of targets) {
            this.applyAnimationSettings(target.element, 'in')
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: 'none', transform: target.endTransform })
        }
        this.prepareOverlayOpen()
    }

    prepareOpen = (panelElement: HTMLElement): void => {
        this.setAnimatedPanel(panelElement)
        this.setOpen(true)
        const targets = this.getSlideTargets(panelElement, 'in')
        for (const target of targets) {
            this.applyAnimationSettings(target.element, 'in')
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: 'none', transform: target.startTransform })
        }
        this.prepareOverlayClosed()
    }

    playOpen = (panelElement: HTMLElement): Promise<void> => {
        this.setAnimatedPanel(panelElement)
        // Slide both the panel and its glass backdrop in together so the reveal
        // reads as one surface gliding out from the edge.
        return this.runSlide(panelElement, 'in')
    }

    playClose = (): Promise<void> => {
        return this.runSlide(this.animatedPanel, 'out')
    }

    detachPanel = (): void => {
        this.finishSlideWait?.()
        this.finishSlideWait = null
        this.slideRunId++
        this.setAnimatedPanel(null)
        this.element.remove()
        this.backdropElement.remove()
        this.overlayElement?.remove()
    }

    private getOffEdgeTransform = (): string => (
        this.config.side === 'left'
            ? 'translate3d(-100%, 0, 0)'
            : 'translate3d(100%, 0, 0)'
    )

    private getToggleClosedTransform = (): string => {
        if (this.config.toggle?.motion === 'fixed') return 'translate3d(0, 0, 0)'
        const travel = 'var(--side-panel-toggle-closed-travel, var(--side-panel-backdrop-width, 0px))'
        return this.config.side === 'left'
            ? `translate3d(calc(-1 * ${travel}), 0, 0)`
            : `translate3d(${travel}, 0, 0)`
    }

    private getSlideTargets = (panelElement: HTMLElement | null, direction: 'in' | 'out'): SlideTarget[] => {
        const offEdge = this.getOffEdgeTransform()
        const panelStartTransform = direction === 'in' ? offEdge : 'translate3d(0, 0, 0)'
        const panelEndTransform = direction === 'in' ? 'translate3d(0, 0, 0)' : offEdge
        const targets: SlideTarget[] = [
            { element: this.backdropElement, startTransform: panelStartTransform, endTransform: panelEndTransform },
        ]
        if (panelElement) {
            targets.unshift({ element: panelElement, startTransform: panelStartTransform, endTransform: panelEndTransform })
        }
        if (this.toggleElement && this.config.toggle?.motion !== 'fixed') {
            const toggleClosedTransform = this.getToggleClosedTransform()
            targets.push({
                element: this.toggleElement,
                startTransform: direction === 'in' ? toggleClosedTransform : 'translate3d(0, 0, 0)',
                endTransform: direction === 'in' ? 'translate3d(0, 0, 0)' : toggleClosedTransform,
            })
        }
        return targets
    }

    private getOverlayOpacityForDirection = (direction: 'in' | 'out', phase: 'start' | 'end'): string => {
        const openOpacity = `${this.getOverlayOpacity()}`
        if (direction === 'in') return phase === 'start' ? '0' : openOpacity
        return phase === 'start' ? openOpacity : '0'
    }

    private prepareOverlayOpen = (): void => {
        if (!this.overlayElement) return
        this.applyOverlaySettings(this.overlayElement)
        applyStyle(this.overlayElement, { transition: 'none', opacity: `${this.getOverlayOpacity()}` })
    }

    private prepareOverlayClosed = (): void => {
        if (!this.overlayElement) return
        this.applyOverlaySettings(this.overlayElement)
        applyStyle(this.overlayElement, { transition: 'none', opacity: '0' })
    }

    private forceSlideStartFrame = (targets: SlideTarget[]): void => {
        for (const target of targets) void target.element.offsetWidth
    }

    private nextAnimationFrame = (): Promise<void> => new Promise((resolve) => {
        requestAnimationFrame(() => resolve())
    })

    private waitForSlideFrame = async (): Promise<void> => {
        await this.nextAnimationFrame()
        await this.nextAnimationFrame()
    }

    // Edge slide through inline transforms. The start transform is committed
    // without transition, then the end transform is applied after paint.
    private runSlide = async (panelElement: HTMLElement | null, direction: 'in' | 'out'): Promise<void> => {
        const runId = ++this.slideRunId
        this.finishSlideWait?.()
        this.finishSlideWait = null
        this.setOpen(direction === 'in')
        const targets = this.getSlideTargets(panelElement, direction)
        const shouldStartCloseFromCurrent = direction === 'out' && this.closeFromCurrentTransforms
        this.closeFromCurrentTransforms = false

        for (const target of targets) {
            this.applyAnimationSettings(target.element, direction)
            target.element.classList.add('side-panel-slide')
            const startTransform = shouldStartCloseFromCurrent
                ? target.element.style.transform || target.startTransform
                : target.startTransform
            applyStyle(target.element, { transition: 'none', transform: startTransform })
        }
        if (this.overlayElement) {
            this.applyOverlaySettings(this.overlayElement, direction)
            const startOpacity = shouldStartCloseFromCurrent
                ? this.overlayElement.style.opacity || this.getOverlayOpacityForDirection(direction, 'start')
                : this.getOverlayOpacityForDirection(direction, 'start')
            applyStyle(this.overlayElement, { transition: 'none', opacity: startOpacity })
        }
        this.forceSlideStartFrame(targets)

        await this.waitForSlideFrame()
        if (this.slideRunId !== runId) return
        for (const target of targets) applyStyle(target.element, { transition: SLIDE_TRANSITION, transform: target.endTransform })
        if (this.overlayElement) {
            applyStyle(this.overlayElement, {
                transition: OVERLAY_TRANSITION,
                opacity: this.getOverlayOpacityForDirection(direction, 'end'),
            })
        }

        await this.waitForSlideEnd(targets.map((target) => target.element), runId)
    }

    private waitForSlideEnd = (targets: HTMLElement[], runId: number): Promise<void> => new Promise((resolve) => {
        const pendingTargets = new Set(targets)
        const handleTransitionEnd = (event: TransitionEvent): void => {
            if (event.target !== event.currentTarget) return
            if (event.propertyName !== 'transform') return
            pendingTargets.delete(event.currentTarget as HTMLElement)
            if (pendingTargets.size === 0) finish()
        }
        const finish = (): void => {
            for (const target of targets) target.removeEventListener('transitionend', handleTransitionEnd)
            window.clearTimeout(timeoutId)
            if (this.slideRunId === runId) this.finishSlideWait = null
            resolve()
        }
        const timeoutId = window.setTimeout(finish, this.getSlideDurationMs() + SLIDE_FALLBACK_BUFFER_MS)

        this.finishSlideWait = finish
        for (const target of targets) target.addEventListener('transitionend', handleTransitionEnd)
    })

    private setAnimatedPanel = (panelElement: HTMLElement | null): void => {
        if (this.animatedPanel === panelElement) return
        this.detachPanelDrag?.()
        this.detachPanelDrag = null
        this.animatedPanel?.classList.remove('side-panel-touch-drag', 'side-panel-touch-dragging')
        this.animatedPanel = panelElement
        if (!panelElement || !this.config.drag?.enabled) return
        panelElement.classList.add('side-panel-touch-drag')
        panelElement.addEventListener('pointerdown', this.handlePanelPointerDown)
        panelElement.addEventListener('pointermove', this.handlePanelPointerMove)
        panelElement.addEventListener('pointerup', this.handlePanelPointerUp)
        panelElement.addEventListener('pointercancel', this.handlePanelPointerUp)
        panelElement.addEventListener('pointerout', this.handlePanelPointerOut)
        panelElement.addEventListener('contextmenu', this.handlePanelContextMenu)
        this.detachPanelDrag = (): void => {
            panelElement.removeEventListener('pointerdown', this.handlePanelPointerDown)
            panelElement.removeEventListener('pointermove', this.handlePanelPointerMove)
            panelElement.removeEventListener('pointerup', this.handlePanelPointerUp)
            panelElement.removeEventListener('pointercancel', this.handlePanelPointerUp)
            panelElement.removeEventListener('pointerout', this.handlePanelPointerOut)
            panelElement.removeEventListener('contextmenu', this.handlePanelContextMenu)
            panelElement.classList.remove('side-panel-touch-drag', 'side-panel-touch-dragging')
            this.panelDragState = null
        }
    }

    private getPanelDragStartThreshold = (pointerType: string): number => {
        const drag = this.config.drag
        if (pointerType === 'touch') return drag?.touchSwipeStartThreshold ?? DRAG_TOUCH_START_THRESHOLD
        return drag?.pointerSwipeStartThreshold ?? DRAG_MOUSE_START_THRESHOLD
    }

    private getPanelDragCloseDistance = (event: PointerEvent, state: PanelDragState): number => {
        const sign = this.config.side === 'left' ? -1 : 1
        return (event.clientX - state.startX) * sign
    }

    private shouldIgnorePanelDragTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) return true
        if (target.closest('[data-side-panel-no-drag]')) return true
        if (target.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [contenteditable="true"]')) return true
        return false
    }

    private handlePanelPointerDown = (event: PointerEvent): void => {
        if (!this.isOpen || !this.animatedPanel || !this.config.drag?.enabled) return
        if (event.button !== 0 || event.isPrimary === false) return
        if (this.shouldIgnorePanelDragTarget(event.target)) return
        this.panelDragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startTimeMs: Date.now(),
            panelWidth: Math.max(this.animatedPanel.getBoundingClientRect().width, 1),
            pointerType: event.pointerType,
            hasStarted: false,
            lastEvent: event,
        }
        if (typeof this.animatedPanel.setPointerCapture === 'function') this.animatedPanel.setPointerCapture(event.pointerId)
    }

    private handlePanelPointerMove = (event: PointerEvent): void => {
        const state = this.panelDragState
        if (!state || event.pointerId !== state.pointerId || !this.animatedPanel) return
        state.lastEvent = event
        const closeDistance = this.getPanelDragCloseDistance(event, state)
        const absX = Math.abs(event.clientX - state.startX)
        const absY = Math.abs(event.clientY - state.startY)
        const threshold = this.getPanelDragStartThreshold(state.pointerType)

        if (!state.hasStarted) {
            if (absX <= threshold && absY <= threshold) return
            if (closeDistance <= 0 || absY > absX) {
                this.cancelPanelDrag(false)
                return
            }
            state.hasStarted = true
            this.animatedPanel.classList.add('side-panel-touch-dragging')
        }

        event.preventDefault()
        event.stopPropagation()
        const dragDistance = clamp(closeDistance, 0, state.panelWidth)
        this.applyPanelDragTransform(dragDistance, dragDistance / state.panelWidth)
    }

    private handlePanelPointerUp = (event: PointerEvent): void => {
        const state = this.panelDragState
        if (!state || event.pointerId !== state.pointerId) return
        state.lastEvent = event
        this.releasePanelDrag(state, event)
    }

    private handlePanelPointerOut = (event: PointerEvent): void => {
        const state = this.panelDragState
        if (!state || !state.hasStarted) return
        const relatedTarget = event.relatedTarget
        if (relatedTarget instanceof Node && this.animatedPanel?.contains(relatedTarget)) return
        this.releasePanelDrag(state, state.lastEvent)
    }

    private handlePanelContextMenu = (event: Event): void => {
        if (!this.panelDragState) return
        event.preventDefault()
        this.releasePanelDrag(this.panelDragState, this.panelDragState.lastEvent)
    }

    private applyPanelDragTransform = (dragDistance: number, percentageDragged: number): void => {
        if (!this.animatedPanel) return
        const sign = this.config.side === 'left' ? -1 : 1
        const panelTransform = `translate3d(${dragDistance * sign}px, 0, 0)`
        const overlayOpacity = Math.max(0, this.getOverlayOpacity() * (1 - percentageDragged))
        const targets = this.getSlideTargets(this.animatedPanel, 'out')
        for (const target of targets) applyStyle(target.element, { transition: 'none', transform: panelTransform })
        if (this.overlayElement) applyStyle(this.overlayElement, { transition: 'none', opacity: `${overlayOpacity}` })
    }

    private releasePanelDrag = (state: PanelDragState, event: PointerEvent): void => {
        if (!this.animatedPanel) {
            this.cancelPanelDrag(false)
            return
        }
        const closeDistance = Math.max(this.getPanelDragCloseDistance(event, state), 0)
        const timeTakenMs = Math.max(Date.now() - state.startTimeMs, 1)
        const velocity = closeDistance / timeTakenMs
        const closeThreshold = this.config.drag?.closeThreshold ?? DRAG_CLOSE_THRESHOLD
        const velocityThreshold = this.config.drag?.velocityThreshold ?? DRAG_VELOCITY_THRESHOLD
        const shouldClose = state.hasStarted && (
            velocity > velocityThreshold ||
            closeDistance >= state.panelWidth * closeThreshold
        )
        if (typeof this.animatedPanel.releasePointerCapture === 'function' && this.animatedPanel.hasPointerCapture(state.pointerId)) {
            this.animatedPanel.releasePointerCapture(state.pointerId)
        }
        this.animatedPanel.classList.remove('side-panel-touch-dragging')
        this.panelDragState = null
        if (!state.hasStarted) return
        if (shouldClose && this.config.onOpenChange) {
            this.closeFromCurrentTransforms = true
            this.config.onOpenChange(false)
            return
        }
        this.resetPanelDrag()
    }

    private resetPanelDrag = (): void => {
        if (!this.animatedPanel) return
        const targets = this.getSlideTargets(this.animatedPanel, 'in')
        for (const target of targets) {
            this.applyAnimationSettings(target.element, 'in')
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: SLIDE_TRANSITION, transform: target.endTransform })
        }
        if (this.overlayElement) {
            this.applyOverlaySettings(this.overlayElement, 'in')
            applyStyle(this.overlayElement, { transition: OVERLAY_TRANSITION, opacity: `${this.getOverlayOpacity()}` })
        }
    }

    private cancelPanelDrag = (reset: boolean): void => {
        if (this.animatedPanel && this.panelDragState && this.animatedPanel.hasPointerCapture(this.panelDragState.pointerId)) {
            this.animatedPanel.releasePointerCapture(this.panelDragState.pointerId)
        }
        this.animatedPanel?.classList.remove('side-panel-touch-dragging')
        this.panelDragState = null
        if (reset) this.resetPanelDrag()
    }

    destroy = (): void => {
        this.detach()
        this.detachPanel()
        this.animatedPanel = null
        this.listeners.clear()
        this.element.removeEventListener('pointerdown', this.handleResizeStart)
        if (this.overlayElement) {
            document.removeEventListener('pointerdown', this.handleOverlayPointerDown, true)
            document.removeEventListener('click', this.handleOverlayClick, true)
        }
        this.toggleElement?.remove()
    }
}

export function createSidePanel(config: SidePanelConfig): SidePanelInstance {
    return new SidePanel(config)
}
