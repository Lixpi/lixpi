// SidePanel - reusable resizable side panel for a canvas-hosted panel.
//
// Renderer: TypeScript `html` DOM (no Svelte). It is meant to be mounted as a
// child of a canvas-hosted panel element, the same way the AI chat thread panel
// uses it. The component renders the "rail" (the internal term for the vertical
// drag handle line) and owns the entire resize lifecycle:
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
// variables, dependent layout). It does not clamp, store, or decide width.
//
// The panel can sit on either edge of the screen:
//   - side: 'right'  -> panel lives on the right, its rail hugs the panel's left
//     edge; dragging left grows the panel.
//   - side: 'left'   -> panel lives on the left, its rail hugs the panel's right
//     edge; dragging right grows the panel.

import { html, applyStyle } from '$src/utils/domTemplates.ts'

export type SidePanelSide = 'left' | 'right'

export type SidePanelStyles = {
    // Background gradient painted on the visible rail line.
    gradient?: string
    // Visible rail line thickness, e.g. '3px'.
    width?: string
}

export type SidePanelToggleConfig = {
    iconSvg: string
    className?: string
    openAriaLabel: string
    closedAriaLabel: string
    openOffset?: string
    closedTravel?: string
    top?: string
    size?: string
    onToggle: () => void
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
    // Which edge of the screen the panel (and therefore its rail) hugs.
    side: SidePanelSide
    // Distance in px from the panel edge to the rail center.
    offset: number
    // Screen-pixel width of the invisible drag hit target.
    grabWidth: number
    // Extra class for callers that want to style this panel's rail separately.
    className?: string
    styles?: SidePanelStyles
    toggle?: SidePanelToggleConfig

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
}

export type SidePanelInstance = {
    // The rail element — appended by the host into its panel element.
    element: HTMLDivElement
    // The translucent glass backdrop — a sibling that sits behind the panel and
    // blurs the canvas behind it. Appended by the host into the same container as
    // the panel. The component owns its element and all glass styling.
    backdropElement: HTMLDivElement
    // Optional component-owned open/collapse button. Appended by the host into the
    // same container as the panel and animated by the component.
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
    // Put the panel and backdrop in their off-edge start position before the host
    // appends them. Call immediately before mounting for a visible open slide.
    prepareOpen: (panelElement: HTMLElement) => void
    // Drawer-style reveal. Slides the given panel element (and the glass backdrop)
    // in from the edge this panel hugs. Call once, right after the host mounts the
    // panel — re-renders should not replay it.
    playOpen: (panelElement: HTMLElement) => Promise<void>
    // Slides the panel and backdrop back out to their edge. Resolves once the
    // animation settles so the host can tear the panel down. Safe to call even if
    // `playOpen` was never invoked.
    playClose: () => Promise<void>
    detachPanel: () => void
    destroy: () => void
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

const SLIDE_DURATION_MS = 1000
const SLIDE_FALLBACK_BUFFER_MS = 80
const SLIDE_TRANSITION = 'var(--side-panel-slide-transition)'

type SlideTarget = {
    element: HTMLElement
    startTransform: string
    endTransform: string
}

class SidePanel implements SidePanelInstance {
    readonly element: HTMLDivElement
    readonly backdropElement: HTMLDivElement
    readonly toggleElement: HTMLButtonElement | null
    // Single source of truth for the panel width. null = never resized.
    private width: number | null = null
    private readonly listeners = new Set<(width: number) => void>()
    private detachDrag: (() => void) | null = null
    // The host panel element currently driven by the open/close slide animation.
    private animatedPanel: HTMLElement | null = null
    private slideRunId = 0
    private finishSlideWait: (() => void) | null = null

    constructor(private readonly config: SidePanelConfig) {
        const loaded = config.loadState?.()
        if (loaded && loaded.width != null) this.width = loaded.width

        const { offset, grabWidth, side, className } = config

        const edgeOffset = `${-offset - grabWidth / 2}px`
        const railStyle = {
            position: 'absolute' as const,
            width: `${grabWidth}px`,
            top: '0',
            zIndex: '9990',
            ...(side === 'left' ? { right: edgeOffset } : { left: edgeOffset }),
        }

        this.element = html`<div
            className=${`side-panel-resize-handle side-panel-resize-handle-${side} nopan${className ? ` ${className}` : ''}`}
            style=${railStyle}
        ></div>` as HTMLDivElement

        const styles = config.styles
        if (styles?.gradient) this.element.style.setProperty('--side-panel-resize-handle-gradient', styles.gradient)
        if (styles?.width) this.element.style.setProperty('--side-panel-resize-handle-width', styles.width)

        const line = html`<div className="side-panel-resize-handle-line"></div>` as HTMLDivElement
        this.element.appendChild(line)
        // Pointer events unify mouse, touch, and pen, so the rail resizes on
        // touch devices without a separate touch code path.
        this.element.addEventListener('pointerdown', this.handleResizeStart)

        // Translucent glass backdrop. It is a sibling that sits behind the panel
        // (lower z-index) and blurs the canvas behind it. Its width tracks the
        // panel width so its inner edge sits flush with the panel edge.
        this.backdropElement = html`<div
            className=${`side-panel-backdrop side-panel-backdrop-${side}`}
            aria-hidden="true"
        ></div>` as HTMLDivElement

        this.toggleElement = config.toggle ? this.createToggleElement(config.toggle) : null
        this.setOpen(false)
        if (this.toggleElement) applyStyle(this.toggleElement, { transition: 'none', transform: this.getToggleClosedTransform() })
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
        this.toggleElement?.classList.toggle('side-panel-toggle-open', open)
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

        // Capture the pointer so the drag keeps tracking past the thin rail and
        // outside the window, on both mouse and touch.
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

    private handleToggleClick = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        this.config.toggle?.onToggle()
    }

    mountOpen = (panelElement: HTMLElement): void => {
        this.animatedPanel = panelElement
        this.setOpen(true)
        const targets = this.getSlideTargets(panelElement, 'in')
        for (const target of targets) {
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: 'none', transform: target.endTransform })
        }
    }

    prepareOpen = (panelElement: HTMLElement): void => {
        this.animatedPanel = panelElement
        this.setOpen(true)
        const targets = this.getSlideTargets(panelElement, 'in')
        for (const target of targets) {
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: 'none', transform: target.startTransform })
        }
    }

    playOpen = (panelElement: HTMLElement): Promise<void> => {
        this.animatedPanel = panelElement
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
        this.animatedPanel = null
        this.element.remove()
        this.backdropElement.remove()
    }

    private getOffEdgeTransform = (): string => (
        this.config.side === 'left'
            ? 'translate3d(-100%, 0, 0)'
            : 'translate3d(100%, 0, 0)'
    )

    private getToggleClosedTransform = (): string => {
        const travel = 'var(--side-panel-toggle-closed-travel, var(--side-panel-backdrop-width, var(--workspace-ai-chat-sidebar-width, 0px)))'
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
        if (this.toggleElement) {
            const toggleClosedTransform = this.getToggleClosedTransform()
            targets.push({
                element: this.toggleElement,
                startTransform: direction === 'in' ? toggleClosedTransform : 'translate3d(0, 0, 0)',
                endTransform: direction === 'in' ? 'translate3d(0, 0, 0)' : toggleClosedTransform,
            })
        }
        return targets
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

        for (const target of targets) {
            target.element.classList.add('side-panel-slide')
            applyStyle(target.element, { transition: 'none', transform: target.startTransform })
        }
        this.forceSlideStartFrame(targets)

        await this.waitForSlideFrame()
        if (this.slideRunId !== runId) return
        for (const target of targets) applyStyle(target.element, { transition: SLIDE_TRANSITION, transform: target.endTransform })

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
        const timeoutId = window.setTimeout(finish, SLIDE_DURATION_MS + SLIDE_FALLBACK_BUFFER_MS)

        this.finishSlideWait = finish
        for (const target of targets) target.addEventListener('transitionend', handleTransitionEnd)
    })

    destroy = (): void => {
        this.detach()
        this.detachPanel()
        this.animatedPanel = null
        this.listeners.clear()
        this.element.removeEventListener('pointerdown', this.handleResizeStart)
        this.toggleElement?.remove()
    }
}

export function createSidePanel(config: SidePanelConfig): SidePanelInstance {
    return new SidePanel(config)
}
