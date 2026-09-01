import { select } from 'd3-selection'
import type {
    CanvasAiChatPanelState,
    CanvasRightSidePanelMode,
} from '@lixpi/constants'
import {
    createDocumentHtml,
    ElementStyleLease,
} from '@lixpi/ui-primitives/dom'
import {
    createSidePanel,
    type SidePanelConfig,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-switch'
import { aiChatPanelCollapseIcon } from '@lixpi/ui-kit/svg'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export type WorkspaceRightPanelSettings = {
    defaultDimensions: { width: number }
    dimensions: { minWidth: number; maxPaneMargin: number }
    layout: { contentInset: number }
    resizeHandle: Pick<SidePanelConfig, 'offset' | 'grabWidth' | 'styles'>
    toggle: Omit<NonNullable<SidePanelConfig['toggle']>, 'iconSvg' | 'className' | 'onToggle'>
    animation: SidePanelConfig['animation']
    overlay: SidePanelConfig['overlay']
    drag: SidePanelConfig['drag']
}

export type WorkspaceRightPanelOptions = {
    pane: HTMLElement
    widthHost: HTMLElement
    settings: WorkspaceRightPanelSettings
    switchSettings: { height: number; transitionDurationMs: number; transitionMinDurationMs: number; transitionDistanceSpeedupFactor: number }
    cssProperties: Readonly<Record<`--${string}`, string>>
    getState: () => CanvasAiChatPanelState
    onWidthChange: (width: number | undefined) => void
    onModeChange: (mode: CanvasRightSidePanelMode) => void
    onOpenChange: (open: boolean) => void
    mountContent: (host: HTMLElement, mode: CanvasRightSidePanelMode, signal: AbortSignal) => () => void
    acquirePanLock: () => () => void
    requestFrame: (callback: FrameRequestCallback) => number
    cancelFrame: (handle: number) => void
    setTimer: (callback: () => void, delay: number) => number
    clearTimer: (handle: number) => void
    onError: (error: unknown) => void
}

export type WorkspaceRightPanelRenderOptions = { animateOpen?: boolean; preserveModeSwitch?: boolean }

const modes: CanvasRightSidePanelMode[] = ['capabilities', 'artifacts', 'media', 'aiThreads']

export class WorkspaceRightPanel {
    private readonly lifetime = new Lifetime()
    private content = new Lifetime()
    private widthStyles: ElementStyleLease | null = null
    private panel: HTMLDivElement | null = null
    private sidePanel: SidePanelInstance | null = null
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

    get element(): HTMLDivElement | null {
        return this.panel
    }
    get isClosing(): boolean {
        return this.closing
    }
    get hasRendered(): boolean {
        return this.rendered
    }

    ensure(): SidePanelInstance {
        if (this.lifetime.signal.aborted) throw new Error('Workspace right panel is disposed')
        if (this.sidePanel) return this.sidePanel
        const { settings, pane } = this.options
        const panel = createSidePanel({
            root: pane,
            side: 'right',
            offset: settings.resizeHandle.offset,
            grabWidth: settings.resizeHandle.grabWidth,
            className: 'workspace-ai-chat-side-panel-resize-handle',
            styles: settings.resizeHandle.styles,
            overlay: settings.overlay,
            drag: settings.drag,
            animation: settings.animation,
            toggle: {
                ...settings.toggle,
                iconSvg: aiChatPanelCollapseIcon,
                className: 'workspace-ai-chat-panel-toggle',
                onToggle: () => {
                    if (!this.lifetime.signal.aborted) this.options.onOpenChange(!this.options.getState().isOpen)
                },
            },
            minWidth: settings.dimensions.minWidth,
            defaultWidth: settings.defaultDimensions.width,
            getMaxWidth: () => this.maxWidth(),
            measureWidth: () => this.panel?.getBoundingClientRect().width ?? settings.defaultDimensions.width,
            loadState: () => ({ width: this.options.getState().width ?? null }),
            persistState: state => {
                if (!this.lifetime.signal.aborted) this.options.onWidthChange(state.width ?? undefined)
            },
            onResizeStart: () => {
                if (this.lifetime.signal.aborted) return
                this.panel?.classList.add('is-resizing')
                this.releasePan ??= this.options.acquirePanLock()
            },
            onResize: width => this.reflectWidth(width),
            onResizeEnd: () => this.endResize(),
            onOpenChange: open => {
                if (!this.lifetime.signal.aborted) this.options.onOpenChange(open)
            },
        })
        this.sidePanel = panel
        if (panel.toggleElement) pane.appendChild(panel.toggleElement)
        panel.setOpen(this.options.getState().isOpen)
        this.reflectWidth(panel.getWidth())
        return panel
    }

    syncState(): void {
        if (this.lifetime.signal.aborted) return
        const state = this.options.getState()
        if (state.width != null) this.sidePanel?.setWidth(state.width, { persist: false })
        this.sidePanel?.setOpen(state.isOpen)
    }

    applyConstraints(): void {
        if (this.lifetime.signal.aborted) return
        this.sidePanel?.applyConstraints()
        this.resizeSwitch()
    }

    render(options: WorkspaceRightPanelRenderOptions = {}): void {
        if (this.lifetime.signal.aborted) return
        const state = this.options.getState()
        if (!state.isOpen) {
            if (!this.closing) this.clear()
            this.rendered = true
            return
        }
        if (this.opening && this.panel) return
        const preserve = Boolean(options.preserveModeSwitch || (this.modeTimer !== null && this.modeSwitch && this.panel))
        const wasMounted = this.panel !== null && !this.closing
        const animate = !wasMounted && this.rendered && options.animateOpen !== false
        const preservedSwitch = preserve ? this.panel?.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch') ?? null : null
        preservedSwitch?.remove()
        this.clear(false, Boolean(preservedSwitch))
        this.suppressResize = preserve
        const html = createDocumentHtml(this.options.pane.ownerDocument)
        const panel = html`<div className="workspace-ai-chat-floating-panel workspace-ai-chat-thread-node nopan nowheel"></div>` as HTMLDivElement
        this.panel = panel
        this.content.own(() => panel.remove())
        for (const type of ['mousedown', 'click']) {
            const stop = (event: Event) => event.stopPropagation()
            panel.addEventListener(type, stop)
            this.content.own(() => panel.removeEventListener(type, stop))
        }
        try {
            for (const [name, value] of Object.entries(this.options.cssProperties)) panel.style.setProperty(name, value)
            const switchElement = preservedSwitch ?? this.createModeSwitch(state.topLevelMode)
            panel.appendChild(switchElement)
            const hostClass = state.topLevelMode === 'capabilities'
                ? 'workspace-right-panel-capability-host workspace-right-panel-media-host'
                : state.topLevelMode === 'artifacts'
                ? 'workspace-right-panel-artifact-host workspace-right-panel-media-host'
                : state.topLevelMode === 'media'
                ? 'workspace-right-panel-media-host'
                : 'workspace-right-panel-details-host'
            const host = state.topLevelMode === 'aiThreads' ? panel : html`<div className=${hostClass}></div>` as HTMLDivElement
            if (host !== panel) panel.appendChild(host)
            this.content.own(this.options.mountContent(host, state.topLevelMode, this.content.signal))
            const sidePanel = this.ensure()
            panel.appendChild(sidePanel.element)
            this.renderedMode = state.topLevelMode
            if (animate) {
                this.opening = true
                sidePanel.prepareOpen(panel)
            } else sidePanel.mountOpen(panel)
            if (sidePanel.overlayElement) this.options.pane.appendChild(sidePanel.overlayElement)
            this.options.pane.append(sidePanel.backdropElement, panel)
            if (sidePanel.getRawWidth() !== null) this.reflectWidth(sidePanel.getWidth())
            this.rendered = true
            this.suppressResize = false
            if (animate) void this.playOpen(sidePanel, panel, this.animationVersion)
            const content = this.content
            this.resizeFrame = this.options.requestFrame(() => {
                if (content.signal.aborted) return
                this.resizeFrame = null
                if (!preservedSwitch) this.resizeSwitch()
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
        if (this.lifetime.signal.aborted || this.closing) return
        this.opening = false
        this.closing = true
        const version = ++this.animationVersion
        try {
            await this.sidePanel?.playClose()
            if (version !== this.animationVersion || this.lifetime.signal.aborted) return
            if (!this.options.getState().isOpen) this.clear()
        } catch (error) {
            if (!this.lifetime.signal.aborted && version === this.animationVersion) this.options.onError(error)
        } finally {
            if (version === this.animationVersion) this.closing = false
        }
    }

    clear(destroySidePanel = false, preserveModeSwitch = false): void {
        this.animationVersion += 1
        this.opening = false
        this.closing = false
        this.suppressResize = false
        this.renderedMode = null
        const cleanup = new Lifetime()
        const content = this.content
        this.content = new Lifetime()
        cleanup.own(() => content.destroy())
        cleanup.own(() => this.endResize())
        if (this.resizeFrame !== null) this.options.cancelFrame(this.resizeFrame)
        this.resizeFrame = null
        if (!preserveModeSwitch) {
            this.clearModeTimer()
            const modeSwitch = this.modeSwitch
            this.modeSwitch = null
            if (modeSwitch) cleanup.own(() => modeSwitch.destroy())
        }
        const sidePanel = this.sidePanel
        if (destroySidePanel) {
            this.sidePanel = null
            if (sidePanel) cleanup.own(() => sidePanel.destroy())
        } else if (sidePanel) {
            cleanup.own(() => {
                sidePanel.detachPanel()
                if (!this.options.getState().isOpen) sidePanel.setOpen(false)
            })
        }
        this.panel = null
        cleanup.destroy()
    }

    destroy(): void {
        this.lifetime.destroy()
    }

    private maxWidth(): number {
        return Math.max(this.options.settings.dimensions.minWidth, this.options.pane.getBoundingClientRect().width - this.options.settings.dimensions.maxPaneMargin)
    }

    private switchWidth(): number {
        const width = this.sidePanel?.getWidth() ?? Math.min(this.options.settings.defaultDimensions.width, this.maxWidth())
        const source = this.options.widthHost
        const computed = source.ownerDocument.defaultView?.getComputedStyle(source)
        const value = Number.parseFloat(computed?.getPropertyValue('--workspace-right-side-panel-content-inset') ?? '')
        const inset = Number.isFinite(value) ? value : this.options.settings.layout.contentInset
        return Math.max(0, width - inset * 2)
    }

    private resizeSwitch(): void {
        if (this.suppressResize || !this.modeSwitch || !this.panel) return
        const element = this.panel.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch')
        this.modeSwitch.resize(0, 0, element?.clientWidth ?? this.switchWidth(), this.options.switchSettings.height)
    }

    private reflectWidth(width: number): void {
        if (this.lifetime.signal.aborted) return
        const value = `${width}px`
        const previousStyles = this.widthStyles
        this.widthStyles = new ElementStyleLease(this.options.widthHost, { '--workspace-right-side-panel-width': value, '--side-panel-backdrop-width': value })
        previousStyles?.destroy()
        this.panel?.style.setProperty('--workspace-right-side-panel-width', value)
        this.panel?.style.setProperty('--side-panel-backdrop-width', value)
        this.resizeSwitch()
    }

    private endResize(): void {
        this.panel?.classList.remove('is-resizing')
        const release = this.releasePan
        this.releasePan = null
        release?.()
    }

    private clearModeTimer(): void {
        this.modeTimerVersion += 1
        if (this.modeTimer !== null) this.options.clearTimer(this.modeTimer)
        this.modeTimer = null
    }

    private createModeSwitch(mode: CanvasRightSidePanelMode): HTMLDivElement {
        const html = createDocumentHtml(this.options.pane.ownerDocument)
        const element = html`<div className="workspace-right-panel-mode-switch"></div>` as HTMLDivElement
        const svg = select(element).append('svg:svg').attr('class', 'workspace-right-panel-mode-switch-svg').attr('aria-label', 'Right side panel mode')
        const settings = this.options.switchSettings
        this.modeSwitch = createSlidingSwitch<CanvasRightSidePanelMode>(svg, {
            id: `workspace-right-panel-mode-${crypto.randomUUID()}`,
            x: 0,
            y: 0,
            width: this.switchWidth(),
            height: settings.height,
            options: [{ label: 'Capabilities', value: 'capabilities' }, { label: 'Artifacts', value: 'artifacts' }, { label: 'Media', value: 'media' }, { label: 'AI Threads', value: 'aiThreads' }],
            selectedValue: mode,
            transition: { durationMs: settings.transitionDurationMs, minDurationMs: settings.transitionMinDurationMs, distanceSpeedupFactor: settings.transitionDistanceSpeedupFactor },
            onChange: nextMode => {
                if (this.lifetime.signal.aborted) return
                const previous = this.options.getState().topLevelMode
                if (nextMode === previous) return
                this.clearModeTimer()
                const distance = Math.max(1, Math.abs(modes.indexOf(nextMode) - modes.indexOf(previous)))
                const duration = Math.max(settings.transitionMinDurationMs, Math.round(settings.transitionDurationMs / (1 + (distance - 1) * settings.transitionDistanceSpeedupFactor)))
                const timerVersion = this.modeTimerVersion
                this.modeTimer = this.options.setTimer(() => {
                    if (timerVersion === this.modeTimerVersion) this.modeTimer = null
                }, duration)
                this.options.onModeChange(nextMode)
                if (this.renderedMode !== nextMode) this.render({ preserveModeSwitch: true })
            },
        })
        return element
    }

    private async playOpen(sidePanel: SidePanelInstance, panel: HTMLElement, version: number): Promise<void> {
        try {
            await sidePanel.playOpen(panel)
        } catch (error) {
            if (!this.lifetime.signal.aborted && version === this.animationVersion) this.options.onError(error)
        } finally {
            if (!this.lifetime.signal.aborted && version === this.animationVersion) this.opening = false
        }
    }
}
