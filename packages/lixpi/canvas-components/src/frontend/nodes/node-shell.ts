import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    Lifetime,
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getCanvasChromeScreenLayout,
    type BoundedZoomScalingOptions,
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'

export type NodeShellSettings = {
    gap: number
    zoomScaling: BoundedZoomScalingOptions
}

export type NodeShellOptions = {
    document: Document
    getSettings: () => NodeShellSettings
    mountTitle?: (host: HTMLElement) => () => void
    mountMetadata?: (host: HTMLElement) => () => void
    mountActions?: (host: HTMLElement) => () => void
}

// Content stays with its component. This shell owns the shared title and footer layout.
export class CanvasNodeShell {
    readonly element: HTMLElement
    readonly title: HTMLElement
    readonly metadata: HTMLElement
    readonly actions: HTMLElement
    private readonly lifetime = new Lifetime()

    constructor(private readonly options: NodeShellOptions) {
        const html = createDocumentHtml(options.document)
        this.title = html`<div className="canvas-node-shell-title"></div>` as HTMLElement
        this.metadata = html`<div className="canvas-node-shell-metadata"></div>` as HTMLElement
        this.actions = html`<div className="canvas-node-shell-actions"></div>` as HTMLElement
        this.element = html`
            <div className="canvas-node-shell">
                ${this.title}
                ${this.metadata}
                ${this.actions}
            </div>
        ` as HTMLElement
        this.lifetime.own(() => this.element.remove())

        try {
            for (const [host, mount] of [
                [this.title, options.mountTitle],
                [this.metadata, options.mountMetadata],
                [this.actions, options.mountActions],
            ] as const) {
                host.hidden = !mount

                if (mount)
                    this.lifetime.own(
                        mount(host),
                    )
            }
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    setGeometry(
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
        extraTopOffsetScreen = 0,
    ): void {
        if (this.lifetime.signal.aborted)
            return

        const settings = this.options.getSettings()
        const layout = getCanvasChromeScreenLayout({
            viewport,
            worldPosition: bounds,
            worldDimensions: bounds,
            baseGap: settings.gap,
            zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.zoomScaling),
        })
        applyStyle(
            this.element,
            {
                left: `${layout.left}px`,
                top: `${layout.top + extraTopOffsetScreen}px`,
                width: `${layout.layoutWidth}px`,
                transform: `scale(${layout.screenScale})`,
            },
        )
        const nodeTop = viewport.y + bounds.y * viewport.zoom
        this.title.style.top = `${(nodeTop - layout.top - extraTopOffsetScreen) / layout.screenScale - 2}px`
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible
    }

    setSelected(selected: boolean): void {
        this.element.dataset.selected = String(selected)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export type NodeShellSlot<Data> = (
    host: HTMLElement,
    node: EngineNode<Data>,
    context: ComponentContext,
) => {
    update?: (node: EngineNode<Data>) => void
    destroy: () => void
}

export type NodeShellRegistrationOptions<Data> = {
    enabled?: (node: EngineNode<Data>) => boolean
    getFooterOffsetScreen?: (
        node: EngineNode<Data>,
        viewport: CanvasViewport,
    ) => number
    getSettings: () => NodeShellSettings
    title?: NodeShellSlot<Data>
    metadata?: NodeShellSlot<Data>
    actions?: NodeShellSlot<Data>
}

class ShelledNodeView<Data> implements NodeView<Data> {
    readonly prefetch?: () => Promise<void>
    private readonly lifetime = new Lifetime()
    private readonly content: NodeView<Data>
    private readonly shell: CanvasNodeShell
    private readonly slots: Array<ReturnType<NodeShellSlot<Data>>> = []
    private current: EngineNode<Data>
    private visible = false

    constructor(
        registration: NodeRegistration<Data>,
        node: EngineNode<Data>,
        private readonly context: ComponentContext,
        private readonly options: NodeShellRegistrationOptions<Data>,
    ) {
        context.signal.throwIfAborted()
        this.current = node
        context.signal.addEventListener(
            'abort',
            this.destroy,
            { once: true },
        )
        this.lifetime.own(() => context.signal.removeEventListener('abort', this.destroy))

        try {
            this.content = registration.mount(node, context)
            this.lifetime.own(() => this.content.destroy())
            this.prefetch = this.content.prefetch ? () => this.content.prefetch!() : undefined
            this.shell = new CanvasNodeShell({
                document: context.contentRoot.ownerDocument,
                getSettings: options.getSettings,
                mountTitle: this.mountSlot(options.title),
                mountMetadata: this.mountSlot(options.metadata),
                mountActions: this.mountSlot(options.actions),
            })
            this.shell.setVisible(false)
            this.lifetime.own(() => this.shell.destroy())
            this.lifetime.own(
                context.mountOverlay(this.shell.element, 'screen'),
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private mountSlot(slot?: NodeShellSlot<Data>): NodeShellOptions['mountTitle'] {
        if (!slot)
            return undefined

        return host => {
            const mounted = slot(
                host,
                this.current,
                this.context,
            )
            this.slots.push(mounted)

            return () => mounted.destroy()
        }
    }

    update(node: EngineNode<Data>): void {
        if (this.lifetime.signal.aborted)
            return

        this.current = node
        this.content.update(node)

        for (const slot of this.slots)
            slot.update?.(node)

        this.syncVisibility()
    }

    setGeometry(
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
    ): void {
        if (this.lifetime.signal.aborted)
            return

        this.content.setGeometry(bounds, viewport)
        this.shell.setGeometry(
            bounds,
            viewport,
            this.options.getFooterOffsetScreen?.(this.current, viewport) ?? 0,
        )
    }

    setVisible(visible: boolean): void {
        if (this.lifetime.signal.aborted)
            return

        this.visible = visible
        this.content.setVisible(visible)
        this.syncVisibility()
    }

    private syncVisibility(): void {
        this.shell.setVisible(this.visible && (this.options.enabled?.(this.current) ?? true))
    }

    setSelected(selected: boolean): void {
        if (this.lifetime.signal.aborted)
            return

        this.content.setSelected(selected)
        this.shell.setSelected(selected)
    }

    destroy = (): void => void this.lifetime.destroy()
}

// Decorates any registration without changing its content, geometry or connection policy.
export const withNodeShell = <Data>(
    registration: NodeRegistration<Data>,
    options: NodeShellRegistrationOptions<Data>,
): NodeRegistration<Data> => ({
    ...registration,
    mount: (node, context) => new ShelledNodeView(
        registration,
        node,
        context,
        options,
    ),
})
