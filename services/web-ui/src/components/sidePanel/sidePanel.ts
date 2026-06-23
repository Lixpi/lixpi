// SidePanel — reusable resizable side panel for a canvas-hosted panel.
//
// Renderer: TypeScript `html` DOM (no Svelte). It is meant to be mounted as a
// child of a canvas-hosted panel element, the same way the AI chat thread panel
// uses it. The component renders the "rail" (the internal term for the vertical
// drag handle line + boundary circle) and owns the *entire* resize lifecycle:
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
// variables, dependent layout) — it does not clamp, store, or decide width.
//
// The panel can sit on either edge of the screen:
//   - side: 'right'  → panel lives on the right, its rail hugs the panel's left
//     edge; dragging left grows the panel.
//   - side: 'left'   → panel lives on the left, its rail hugs the panel's right
//     edge; dragging right grows the panel.

import { html, applyStyle } from '$src/utils/domTemplates.ts'

export type SidePanelSide = 'left' | 'right'

export type SidePanelStyles = {
    // Background gradient painted on the visible rail line.
    gradient?: string
    // Visible rail line thickness, e.g. '3px'.
    width?: string
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
    destroy: () => void
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

class SidePanel implements SidePanelInstance {
    readonly element: HTMLDivElement
    readonly backdropElement: HTMLDivElement
    // Single source of truth for the panel width. null = never resized.
    private width: number | null = null
    private readonly listeners = new Set<(width: number) => void>()
    private detachDrag: (() => void) | null = null

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
            className=${`side-panel-rail side-panel-rail-${side} nopan${className ? ` ${className}` : ''}`}
            style=${railStyle}
        ></div>` as HTMLDivElement

        const styles = config.styles
        if (styles?.gradient) this.element.style.setProperty('--side-panel-rail-gradient', styles.gradient)
        if (styles?.width) this.element.style.setProperty('--side-panel-rail-width', styles.width)

        const line = html`<div className="side-panel-rail-line"></div>` as HTMLDivElement
        this.element.appendChild(line)
        this.element.addEventListener('mousedown', this.handleResizeStart)

        // Translucent glass backdrop. It is a sibling that sits behind the panel
        // (lower z-index) and blurs the canvas behind it. Its width tracks the
        // panel width so its inner edge sits flush with the panel edge.
        this.backdropElement = html`<div
            className=${`side-panel-backdrop side-panel-backdrop-${side}`}
            aria-hidden="true"
        ></div>` as HTMLDivElement
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

    private handleResizeStart = (event: MouseEvent): void => {
        if (event.button !== 0) return

        event.preventDefault()
        event.stopPropagation()

        const startX = event.clientX
        const startWidth = this.getDragStartWidth()
        const sign = this.config.side === 'left' ? 1 : -1
        const previousBodyCursor = document.body.style.cursor
        const previousBodyUserSelect = document.body.style.userSelect

        this.setResizing(true)
        applyStyle(document.body, { cursor: 'ew-resize', userSelect: 'none' })
        this.config.onResizeStart?.()

        const handleMouseMove = (moveEvent: MouseEvent): void => {
            this.setWidth(startWidth + sign * (moveEvent.clientX - startX))
        }

        const handleMouseUp = (): void => {
            this.detach()
            this.setResizing(false)
            applyStyle(document.body, { cursor: previousBodyCursor, userSelect: previousBodyUserSelect })
            this.persist()
            this.config.onResizeEnd?.(this.getWidth())
        }

        this.detachDrag = (): void => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            this.detachDrag = null
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    private detach = (): void => {
        this.detachDrag?.()
    }

    destroy = (): void => {
        this.detach()
        this.listeners.clear()
        this.element.removeEventListener('mousedown', this.handleResizeStart)
        this.element.remove()
        this.backdropElement.remove()
    }
}

export function createSidePanel(config: SidePanelConfig): SidePanelInstance {
    return new SidePanel(config)
}
