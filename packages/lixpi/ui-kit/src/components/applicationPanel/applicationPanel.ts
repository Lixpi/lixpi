// ApplicationPanel - the one docked panel every Lixpi application uses, on the
// left or the right of the screen.
//
// Renderer: TypeScript `html` DOM. The panel owns its surface (header, body
// and footer), and the SidePanel underneath owns the resize handle, glass
// backdrop, optional overlay, toggle and slide. Every value that decides how
// the panel looks comes from `uiKitSettings.applicationPanel`, which hosts
// cannot override, so a panel looks the same wherever it is mounted. A host
// supplies only the side, the placement, the content and, for wide content, a
// default width.

import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    createSidePanel,
    type SidePanelInstance,
    type SidePanelSetWidthOptions,
    type SidePanelSide,
    type SidePanelState,
} from '../sidePanel/sidePanel.ts'
import { navigationSidePanelToggleIcon } from '../../svg/svgIcons.ts'
import {
    uiKitSettings,
    type UiKitSidePanelPlacement,
} from '../../runtime-settings.ts'

export type ApplicationPanelBody = 'list' | 'content'

export type ApplicationPanelConfig = {
    // Positioned element the panel's pane mounts into. Its width bounds the
    // panel's maximum width.
    container: HTMLElement
    // Content the panel docks beside. It receives
    // `--application-panel-<side>-dock-width`, the space a `push` panel
    // claims, and `--application-panel-<side>-inset`, the width an `overlay`
    // panel covers, so its layout can make room.
    content?: HTMLElement
    side: SidePanelSide
    // Accessible name, such as "Navigation". The toggle reads "Open
    // navigation" and "Close navigation".
    label: string
    open: boolean
    placement?: UiKitSidePanelPlacement
    // Width before the user resizes, for content that needs more room than
    // the shared default.
    defaultWidth?: number
    minWidth?: number
    // `list` lets navigation rows run edge to edge, as rows carry their own
    // inset. `content` insets the body like the header, for forms, text and
    // other content.
    body?: ApplicationPanelBody
    // Extra classes for the surface, for host content rules only.
    className?: string
    loadState?: () => SidePanelState | null | undefined
    persistState?: (state: SidePanelState) => void
    // Requests from the toggle, an outside click or a swipe. Without a
    // handler the panel opens or closes itself.
    onOpenChange?: (open: boolean) => void
    onResizeStart?: () => void
    onResize?: (width: number) => void
    onResizeEnd?: (width: number) => void
}

export type ApplicationPanelSetOpenOptions = {
    // `false` moves the panel without the slide, as on first render.
    animate?: boolean
}

export type ApplicationPanelInstance = {
    readonly element: HTMLElement
    readonly header: HTMLElement
    readonly body: HTMLElement
    readonly footer: HTMLElement
    readonly pane: HTMLElement
    readonly toggleElement: HTMLDivElement | null
    isOpen: () => boolean
    setOpen: (
        open: boolean,
        options?: ApplicationPanelSetOpenOptions,
    ) => Promise<void>
    getWidth: () => number
    setWidth: (
        width: number,
        options?: SidePanelSetWidthOptions,
    ) => number
    applyConstraints: () => void
    destroy: () => void
}

class ApplicationPanel implements ApplicationPanelInstance {
    readonly element: HTMLElement
    readonly header: HTMLElement
    readonly body: HTMLElement
    readonly footer: HTMLElement
    readonly pane: HTMLElement
    private readonly sidePanel: SidePanelInstance
    private readonly placement: UiKitSidePanelPlacement
    private open: boolean
    private width = 0
    // Whether a `push` panel currently claims its space beside the content.
    private docked: boolean
    // Bumped on every open or close so a superseded close does not undock a
    // panel the user reopened while it was still sliding out.
    private motionVersion = 0
    private destroyed = false

    constructor(private readonly config: ApplicationPanelConfig) {
        const settings = uiKitSettings.applicationPanel
        const html = createDocumentHtml(config.container.ownerDocument)
        this.placement = config.placement ?? settings.placement
        this.open = config.open
        this.docked = config.open
        this.pane = html`
            <div
                className="application-panel-pane"
                data-side=${config.side}
            ></div>
        ` as HTMLElement
        this.header = html`<div className="application-panel-header"></div>` as HTMLElement
        this.body = html`<div className="application-panel-body"></div>` as HTMLElement
        this.footer = html`<div className="application-panel-footer"></div>` as HTMLElement
        this.element = html`
            <aside
                className=${`application-panel${config.className ? ` ${config.className}` : ''}`}
                data-side=${config.side}
                data-body=${config.body ?? 'list'}
                aria-label=${config.label}
            >
                ${this.header}
                ${this.body}
                ${this.footer}
            </aside>
        ` as HTMLElement
        const minWidth = config.minWidth ?? settings.dimensions.minWidth
        const openOffset = `calc(var(--application-panel-width, 0px) + ${settings.toggle.gap})`
        const closedOffset = config.side === 'left' ? settings.toggle.closedLeft : settings.toggle.closedRight
        this.sidePanel = createSidePanel({
            root: config.container,
            side: config.side,
            offset: settings.resizeHandle.offset,
            grabWidth: settings.resizeHandle.grabWidth,
            className: 'application-panel-resize-handle',
            styles: settings.resizeHandle.styles,
            overlay: settings.overlay,
            drag: settings.drag,
            toggle: {
                iconSvg: navigationSidePanelToggleIcon,
                className: 'application-panel-toggle',
                motion: settings.toggle.motion,
                openAriaLabel: `Close ${config.label.toLocaleLowerCase()}`,
                closedAriaLabel: `Open ${config.label.toLocaleLowerCase()}`,
                openOffset,
                closedTravel: `calc(${openOffset} - ${closedOffset})`,
                top: settings.toggle.top,
                onToggle: () => this.requestOpen(!this.open),
            },
            minWidth,
            defaultWidth: config.defaultWidth ?? settings.dimensions.defaultWidth,
            getMaxWidth: this.getMaxWidth,
            measureWidth: () => this.element.getBoundingClientRect().width || this.sidePanel.getWidth(),
            loadState: config.loadState,
            persistState: config.persistState,
            onResizeStart: config.onResizeStart,
            onResize: width => {
                this.reflectWidth(width)
                config.onResize?.(width)
            },
            onResizeEnd: width => {
                this.reflectWidth(width)
                config.onResizeEnd?.(width)
            },
            onOpenChange: open => this.requestOpen(open),
        })
        this.pane.style.setProperty('--side-panel-backdrop-fill', settings.backdrop.fill)
        this.pane.style.setProperty('--side-panel-backdrop-fill-opaque', settings.backdrop.fillOpaque)

        if (this.sidePanel.toggleElement)
            this.pane.append(this.sidePanel.toggleElement)

        if (this.sidePanel.overlayElement)
            this.pane.append(this.sidePanel.overlayElement)

        this.pane.append(this.sidePanel.backdropElement, this.element)
        this.element.append(this.sidePanel.element)
        config.container.append(this.pane)
        this.reflectWidth(
            this.sidePanel.getWidth(),
        )

        if (config.open)
            this.sidePanel.mountOpen(this.element)
        else
            this.sidePanel.mountClosed(this.element)

        this.reflectDock()
    }

    get toggleElement(): HTMLDivElement | null {
        return this.sidePanel.toggleElement
    }

    isOpen = (): boolean => this.open

    getWidth = (): number => this.sidePanel.getWidth()

    setWidth = (
        width: number,
        options?: SidePanelSetWidthOptions,
    ): number => {
        const applied = this.sidePanel.setWidth(width, options)
        this.reflectWidth(applied)

        return applied
    }

    applyConstraints = (): void => {
        this.sidePanel.applyConstraints()
        this.reflectWidth(
            this.sidePanel.getWidth(),
        )
    }

    // Opening docks first so a `push` panel slides into its own space.
    // Closing slides the panel out first and only then releases the space, so
    // the content does not jump before the panel has left.
    setOpen = async (
        open: boolean,
        options: ApplicationPanelSetOpenOptions = {},
    ): Promise<void> => {
        if (this.destroyed)
            return

        const version = ++this.motionVersion
        this.open = open

        if (open) {
            this.docked = true
            this.reflectDock()

            if (options.animate === false) {
                this.sidePanel.mountOpen(this.element)

                return
            }

            this.sidePanel.prepareOpen(this.element)
            await this.sidePanel.playOpen(this.element)

            return
        }

        this.sidePanel.setOpen(false)
        this.reflectDock()

        if (options.animate === false)
            this.sidePanel.mountClosed(this.element)
        else
            await this.sidePanel.playClose()

        if (
            this.destroyed
            || this.motionVersion !== version
        )
            return

        this.docked = false
        this.reflectDock()
    }

    private requestOpen(open: boolean): void {
        if (this.config.onOpenChange)
            this.config.onOpenChange(open)
        else
            void this.setOpen(open)
    }

    private getMaxWidth = (): number => {
        const settings = uiKitSettings.applicationPanel
        const containerWidth = this.config.container.getBoundingClientRect().width
            || this.config.container.ownerDocument.defaultView?.innerWidth
            || 0

        return Math.max(this.config.minWidth ?? settings.dimensions.minWidth, containerWidth - settings.dimensions.maxPaneMargin)
    }

    private reflectWidth(width: number): void {
        this.width = width
        const value = `${width}px`
        this.pane.style.setProperty('--application-panel-width', value)
        this.pane.style.setProperty('--side-panel-backdrop-width', value)
        this.reflectDock()
    }

    private reflectDock(): void {
        const content = this.config.content

        if (!content)
            return

        const push = this.placement === 'push'
        content.style.setProperty(`--application-panel-${this.config.side}-dock-width`, `${push
            && this.docked
            ? this.width
            : 0}px`)
        content.style.setProperty(`--application-panel-${this.config.side}-inset`, `${!push
            && this.open
            ? this.width
            : 0}px`)
    }

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.motionVersion += 1
        this.sidePanel.destroy()
        this.config.content?.style.removeProperty(`--application-panel-${this.config.side}-dock-width`)
        this.config.content?.style.removeProperty(`--application-panel-${this.config.side}-inset`)
        this.pane.remove()
    }
}

export const createApplicationPanel = (config: ApplicationPanelConfig): ApplicationPanelInstance => new ApplicationPanel(config)
