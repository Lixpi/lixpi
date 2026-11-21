import { select } from 'd3-selection'
import {
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
} from '@lixpi/constants'
import {
    createDocumentHtml,
    ElementStyleLease,
} from '@lixpi/ui-primitives/dom'
import {
    createApplicationPanel,
    type ApplicationPanelInstance,
} from '@lixpi/ui-kit/components/application-panel'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-switch'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

// The conversation panel's content sizing. Its surface, toggle, resize handle
// and slide are the shared ApplicationPanel.
export type WorkspaceRightPanelSettings = {
    defaultDimensions: { width: number }
    dimensions: {
        minWidth: number
        maxPaneMargin: number
    }
    layout: { contentInset: number }
}

export type WorkspaceRightPanelOptions = {
    pane: HTMLElement
    widthHost: HTMLElement
    settings: WorkspaceRightPanelSettings
    switchSettings: {
        height: number
        transitionDurationMs: number
        transitionMinDurationMs: number
        transitionDistanceSpeedupFactor: number
    }
    cssProperties: Readonly<Record<`--${string}`, string>>
    getState: () => CanvasAiChatPanelState
    onWidthChange: (width: number | undefined) => void
    onModeChange: (mode: CanvasRightSidePanelMode) => void
    onOpenChange: (open: boolean) => void
    mountContent: (
        host: HTMLElement,
        mode: CanvasRightSidePanelMode,
        signal: AbortSignal,
    ) => () => void
    acquirePanLock: () => () => void
    requestFrame: (callback: FrameRequestCallback) => number
    cancelFrame: (handle: number) => void
    setTimer: (
        callback: () => void,
        delay: number,
    ) => number
    clearTimer: (handle: number) => void
    onError: (error: unknown) => void
}

export type WorkspaceRightPanelRenderOptions = {
    animateOpen?: boolean
    preserveModeSwitch?: boolean
}

const modes: CanvasRightSidePanelMode[] = ['capabilities', 'artifacts', 'media', 'aiThreads']

// The surface stays mounted, parked off its edge while closed. Content mounts
// into its body while the panel is open and is released when it closes.
export class WorkspaceRightPanel {
    private readonly lifetime = new Lifetime()
    private content = new Lifetime()
    private widthStyles: ElementStyleLease | null = null
    private panel: ApplicationPanelInstance | null = null
    private mounted = false
    private modeSwitch: SlidingSwitchInstance<CanvasRightSidePanelMode> | null = null
    private renderedMode: CanvasRightSidePanelMode | null = null
    private rendered = false
    private opening = false
    private closing = false
    private animationVersion = 0
    private modeTimer: number | null = null
    private modeTimerVersion = 0
    private resizeFrame: number | null = null
    private suppressResize = false
    private releasePan: (() => void) | null = null

    constructor(private readonly options: WorkspaceRightPanelOptions) {
        this.lifetime.own(() => this.widthStyles?.destroy())
        this.lifetime.own(() => this.clear(true))
    }

    // The surface while content is mounted in it.
    get element(): HTMLElement | null {
        return this.mounted ? (this.panel?.element ?? null) : null
    }
    get isClosing(): boolean {
        return this.closing
    }
    get hasRendered(): boolean {
        return this.rendered
    }

    ensure(): ApplicationPanelInstance {
        if (this.lifetime.signal.aborted)
            throw new Error('Workspace right panel is disposed')

        if (this.panel)
            return this.panel

        const { settings } = this.options
        const panel = createApplicationPanel({
            container: this.options.pane,
            side: 'right',
            label: 'Conversation panel',
            open: false,
            body: 'content',
            placement: 'overlay',
            defaultWidth: settings.defaultDimensions.width,
            minWidth: settings.dimensions.minWidth,
            // Content scope for the conversation rules, and canvas gesture opt-outs.
            className: 'workspace-ai-chat-floating-panel nopan nowheel',
            loadState: () => ({ width: this.options.getState().width ?? null }),
            persistState: state => {
                if (!this.lifetime.signal.aborted)
                    this.options.onWidthChange(state.width ?? undefined)
            },
            onResizeStart: () => {
                if (this.lifetime.signal.aborted)
                    return

                this.panel?.element.classList.add('is-resizing')
                this.releasePan ??= this.options.acquirePanLock()
            },
            onResize: width => this.reflectWidth(width),
            onResizeEnd: () => this.endResize(),
            onOpenChange: open => {
                if (!this.lifetime.signal.aborted)
                    this.options.onOpenChange(open)
            },
        })
        this.panel = panel

        // Clicks in the panel belong to the panel, not to the canvas under it.
        for (const type of ['mousedown', 'click']) {
            const stop = (event: Event) => event.stopPropagation()
            panel.element.addEventListener(type, stop)
            this.lifetime.own(() => panel.element.removeEventListener(type, stop))
        }

        for (const [name, value] of Object.entries(this.options.cssProperties))
            panel.element.style.setProperty(name, value)

        this.reflectWidth(
            panel.getWidth(),
        )

        return panel
    }

    syncState(): void {
        if (this.lifetime.signal.aborted)
            return

        const state = this.options.getState()

        if (state.width != null)
            this.panel?.setWidth(state.width, { persist: false })
    }

    applyConstraints(): void {
        if (this.lifetime.signal.aborted)
            return

        this.panel?.applyConstraints()
        this.resizeSwitch()
    }

    render(options: WorkspaceRightPanelRenderOptions = {}): void {
        if (this.lifetime.signal.aborted)
            return

        const state = this.options.getState()

        if (!state.isOpen) {
            if (!this.closing)
                this.clear()

            this.rendered = true

            return
        }

        if (
            this.opening
            && this.mounted
        )
            return

        const preserve = Boolean(options.preserveModeSwitch || (this.modeTimer !== null && this.modeSwitch && this.mounted))
        const wasMounted = this.mounted && !this.closing
        const animate = !wasMounted
            && this.rendered
            && options.animateOpen !== false
        const preservedSwitch = preserve ? (this.panel?.body.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch') ?? null) : null
        preservedSwitch?.remove()
        this.releaseContent(
            Boolean(preservedSwitch),
        )
        this.suppressResize = preserve

        try {
            const panel = this.ensure()
            const html = createDocumentHtml(this.options.pane.ownerDocument)
            const switchElement = preservedSwitch ?? this.createModeSwitch(state.topLevelMode)
            panel.body.appendChild(switchElement)
            const hostClass = state.topLevelMode === 'capabilities'
                ? 'workspace-right-panel-capability-host workspace-right-panel-media-host'
                : state.topLevelMode === 'artifacts'
                    ? 'workspace-right-panel-artifact-host workspace-right-panel-media-host'
                    : state.topLevelMode === 'media'
                        ? 'workspace-right-panel-media-host'
                        : 'workspace-right-panel-details-host'
            // The thread mounts straight into the body, a flex column, so its
            // editor is the flex child that scrolls, as it did when it
            // mounted straight into the panel.
            const host = state.topLevelMode === 'aiThreads' ? panel.body : (html`<div className=${hostClass}></div>` as HTMLDivElement)

            if (host !== panel.body)
                panel.body.appendChild(host)

            this.content.own(
                this.options.mountContent(
                    host,
                    state.topLevelMode,
                    this.content.signal,
                ),
            )
            this.mounted = true
            this.renderedMode = state.topLevelMode
            this.rendered = true
            this.suppressResize = false

            // A new switch takes the panel's current width at once; a kept
            // switch keeps its size through its slide.
            if (!preservedSwitch)
                this.resizeSwitch()

            if (
                !panel.isOpen()
                || this.closing
            ) {
                this.closing = false
                const version = ++this.animationVersion

                if (animate) {
                    this.opening = true
                    void this.playOpen(panel, version)
                } else
                    void panel.setOpen(true, { animate: false })
            }

            const content = this.content
            this.resizeFrame = this.options.requestFrame(() => {
                if (content.signal.aborted)
                    return

                this.resizeFrame = null

                if (!preservedSwitch)
                    this.resizeSwitch()
            })
        } catch (error) {
            try {
                this.clear()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Workspace panel mounting failed')
            }

            throw error
        }
    }

    async close(): Promise<void> {
        if (
            this.lifetime.signal.aborted
            || this.closing
        )
            return

        this.opening = false
        this.closing = true
        const version = ++this.animationVersion

        try {
            await this.panel?.setOpen(false)

            if (
                version !== this.animationVersion
                || this.lifetime.signal.aborted
            )
                return

            if (!this.options.getState().isOpen)
                this.releaseContent()
        } catch (error) {
            if (
                !this.lifetime.signal.aborted
                && version === this.animationVersion
            )
                this.options.onError(error)
        } finally {
            if (version === this.animationVersion)
                this.closing = false
        }
    }

    // Releases the content. The surface parks closed unless the state keeps
    // it open, and `destroyPanel` removes it for good.
    clear(
        destroyPanel = false,
        preserveModeSwitch = false,
    ): void {
        this.animationVersion += 1
        this.opening = false
        this.closing = false
        const cleanup = new Lifetime()
        cleanup.own(() => this.releaseContent(preserveModeSwitch))
        const panel = this.panel

        if (destroyPanel) {
            this.panel = null

            if (panel)
                cleanup.own(() => panel.destroy())
        } else if (
            panel
            && !this.options.getState().isOpen
        )
            cleanup.own(() => void panel.setOpen(false, { animate: false }))

        cleanup.destroy()
    }

    destroy(): void {
        this.lifetime.destroy()
    }

    private releaseContent(preserveModeSwitch = false): void {
        this.suppressResize = false
        this.renderedMode = null
        this.mounted = false
        const cleanup = new Lifetime()
        const content = this.content
        this.content = new Lifetime()
        cleanup.own(() => content.destroy())
        cleanup.own(() => this.endResize())

        if (this.resizeFrame !== null)
            this.options.cancelFrame(this.resizeFrame)

        this.resizeFrame = null

        if (!preserveModeSwitch) {
            this.clearModeTimer()
            const modeSwitch = this.modeSwitch
            this.modeSwitch = null

            if (modeSwitch)
                cleanup.own(() => modeSwitch.destroy())
        }

        // The body holds only this render's content: a kept mode switch is
        // detached before release and appended again by the next render.
        const body = this.panel?.body

        if (body)
            cleanup.own(() => body.replaceChildren())

        cleanup.destroy()
    }

    private maxWidth(): number {
        return Math.max(
            this.options.settings.dimensions.minWidth,
            this.options.pane.getBoundingClientRect().width - this.options.settings.dimensions.maxPaneMargin,
        )
    }

    private switchWidth(): number {
        const width = this.panel?.getWidth() ?? Math.min(
            this.options.settings.defaultDimensions.width,
            this.maxWidth(),
        )
        const source = this.options.widthHost
        const computed = source.ownerDocument.defaultView?.getComputedStyle(source)
        const value = Number.parseFloat(computed?.getPropertyValue('--workspace-right-side-panel-content-inset') ?? '')
        const inset = Number.isFinite(value) ? value : this.options.settings.layout.contentInset

        return Math.max(0, width - inset * 2)
    }

    private switchHeight(): number {
        const source = this.options.pane
        const computed = source.ownerDocument.defaultView?.getComputedStyle(source)
        const value = Number.parseFloat(computed?.getPropertyValue('--canvas-control-height') ?? '')
        const configuredScale = Number.parseFloat(computed?.getPropertyValue('--canvas-lixpi-panel-switch-scale') ?? '')
        const scale = Number.isFinite(configuredScale)
            && configuredScale > 0
            ? configuredScale
            : 1

        return Number.isFinite(value)
            && value > 0
            ? value * scale
            : this.options.switchSettings.height
    }

    private resizeSwitch(): void {
        if (
            this.suppressResize
            || !this.modeSwitch
            || !this.mounted
        )
            return

        const element = this.panel?.body.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch')
        const measuredWidth = element?.clientWidth ?? 0
        this.modeSwitch.resize(
            0,
            0,
            measuredWidth > 0 ? measuredWidth : this.switchWidth(),
            this.switchHeight(),
        )
    }

    // The canvas reads the panel width to keep its own controls clear of it.
    private reflectWidth(width: number): void {
        if (this.lifetime.signal.aborted)
            return

        const previousStyles = this.widthStyles
        this.widthStyles = new ElementStyleLease(this.options.widthHost, { '--workspace-right-side-panel-width': `${width}px` })
        previousStyles?.destroy()
        this.resizeSwitch()
    }

    private endResize(): void {
        this.panel?.element.classList.remove('is-resizing')
        const release = this.releasePan
        this.releasePan = null
        release?.()
    }

    private clearModeTimer(): void {
        this.modeTimerVersion += 1

        if (this.modeTimer !== null)
            this.options.clearTimer(this.modeTimer)

        this.modeTimer = null
    }

    private createModeSwitch(mode: CanvasRightSidePanelMode): HTMLDivElement {
        const html = createDocumentHtml(this.options.pane.ownerDocument)
        const element = html`<div className="workspace-right-panel-mode-switch"></div>` as HTMLDivElement
        const svg = select(element)
            .append('svg:svg')
            .attr('class', 'workspace-right-panel-mode-switch-svg')
            .attr('aria-label', 'Right side panel mode')
        const settings = this.options.switchSettings
        this.modeSwitch = createSlidingSwitch<CanvasRightSidePanelMode>(
            svg,
            {
                id: `workspace-right-panel-mode-${crypto.randomUUID()}`,
                x: 0,
                y: 0,
                width: this.switchWidth(),
                height: this.switchHeight(),
                trackBackgroundColor: 'var(--canvas-surface-hover, rgba(105, 115, 133, 0.09))',
                indicatorBackgroundColor: 'var(--canvas-surface, rgba(255, 255, 255, 0.72))',
                unselectedOptionColor: 'var(--canvas-text-muted, rgba(49, 59, 78, 0.68))',
                hoveredOptionColor: 'var(--canvas-text, #1a2744)',
                selectedOptionColor: 'var(--canvas-text, #1a2744)',
                options: [{
                    label: 'Capabilities',
                    value: 'capabilities',
                }, {
                    label: 'Artifacts',
                    value: 'artifacts',
                }, {
                    label: 'Media',
                    value: 'media',
                }, {
                    label: 'AI Threads',
                    value: 'aiThreads',
                }],
                selectedValue: mode,
                transition: {
                    durationMs: settings.transitionDurationMs,
                    minDurationMs: settings.transitionMinDurationMs,
                    distanceSpeedupFactor: settings.transitionDistanceSpeedupFactor,
                },
                onChange: nextMode => {
                    if (this.lifetime.signal.aborted)
                        return

                    const previous = this.options.getState().topLevelMode

                    if (nextMode === previous)
                        return

                    this.clearModeTimer()
                    const distance = Math.max(
                        1,
                        Math.abs(modes.indexOf(nextMode) - modes.indexOf(previous)),
                    )
                    const duration = Math.max(
                        settings.transitionMinDurationMs,
                        Math.round(settings.transitionDurationMs / (1 + (distance - 1) * settings.transitionDistanceSpeedupFactor)),
                    )
                    const timerVersion = this.modeTimerVersion
                    this.modeTimer = this.options.setTimer(() => {
                        if (timerVersion === this.modeTimerVersion)
                            this.modeTimer = null
                    }, duration)
                    this.options.onModeChange(nextMode)

                    if (this.renderedMode !== nextMode)
                        this.render({ preserveModeSwitch: true })
                },
            },
        )

        return element
    }

    private async playOpen(
        panel: ApplicationPanelInstance,
        version: number,
    ): Promise<void> {
        try {
            await panel.setOpen(true)
        } catch (error) {
            if (
                !this.lifetime.signal.aborted
                && version === this.animationVersion
            )
                this.options.onError(error)
        } finally {
            if (
                !this.lifetime.signal.aborted
                && version === this.animationVersion
            )
                this.opening = false
        }
    }
}
