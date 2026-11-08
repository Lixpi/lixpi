import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    Lifetime,
    type ComponentContext,
    type NodeRegistration,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    createCanvasTheme,
    type CanvasTheme,
    type CanvasThemeSource,
} from '../theme/canvas-theme.ts'
import {
    createFixedDiagramNodeGeometry,
    DiagramNodeSurface,
    type DiagramNodeAppearance,
} from './diagram-node-surface.ts'

export type DiagramNodeContent = {
    title: string
    tag?: string
    lines?: readonly string[]
    ariaLabel?: string
}

export type DiagramNodeLabelAppearance = DiagramNodeAppearance & {
    text: string
    muted: string
    accent?: string
    tagBackground?: string
    tagText?: string
    shadow?: string
    selectedShadow?: string
    alignment?: 'start' | 'center'
    heading?: 'title' | 'metric'
}

export type DiagramNodeViewOptions<Data> = {
    theme?: CanvasThemeSource
    getContent: (node: EngineNode<Data>) => DiagramNodeContent
    getAppearance?: (node: EngineNode<Data>) => DiagramNodeLabelAppearance
    onActivate?: (nodeId: string) => void
}

export type DiagramNodeRegistrationOptions<Data> = DiagramNodeViewOptions<Data> & {
    type: string
}

export const createDiagramNodeAppearance = (
    shape: DiagramNodeAppearance['shape'] = 'rounded-rectangle',
    theme: CanvasTheme = createCanvasTheme(),
): DiagramNodeLabelAppearance => ({
    shape,
    fill: shape === 'circle' ? theme.colors.raised : theme.colors.surface,
    stroke: theme.colors.border,
    strokeWidth: theme.shape.borderWidth,
    cornerRadius: theme.shape.nodeRadius,
    shadow: theme.shadows.node,
    selectedShadow: theme.shadows.selected,
    text: theme.colors.text,
    muted: theme.colors.muted,
    accent: theme.colors.accent,
    tagBackground: theme.colors.hover,
    tagText: theme.colors.muted,
    alignment: shape === 'circle' ? 'center' : 'start',
})

// IDBD and embedded research diagrams share this compact heading, tag and
// secondary-line presentation. Domain adapters supply only labels and colors.
export class DiagramNodeView<Data> implements NodeView<Data> {
    private readonly lifetime = new Lifetime()
    private readonly surface: DiagramNodeSurface
    private readonly labels: HTMLDivElement
    private readonly title: HTMLSpanElement
    private readonly tag: HTMLSpanElement
    private readonly lines: HTMLDivElement[] = []
    private readonly html: ReturnType<typeof createDocumentHtml>
    private node: EngineNode<Data>
    private selected = false

    constructor(
        node: EngineNode<Data>,
        context: ComponentContext,
        private readonly options: DiagramNodeViewOptions<Data>,
    ) {
        this.node = node
        const html = createDocumentHtml(context.contentRoot.ownerDocument)
        this.html = html
        this.title = html`<span className="diagram-node-title"></span>` as HTMLSpanElement
        this.tag = html`<span className="diagram-node-tag"></span>` as HTMLSpanElement
        this.labels = html`
            <div className="diagram-node-labels">
                <div className="diagram-node-heading">
                    ${this.title}
                    ${this.tag}
                </div>
            </div>
        ` as HTMLDivElement
        this.lifetime.own(() => this.labels.remove())

        try {
            this.surface = new DiagramNodeSurface({
                surface: context,
                bounds: {
                    ...node.position,
                    ...node.dimensions,
                },
                appearance: this.getAppearance(node),
            })
            this.lifetime.own(() => this.surface.destroy())

            if (options.onActivate) {
                this.labels.role = 'button'
                this.labels.tabIndex = 0
                this.labels.addEventListener('keydown', this.activate)
                this.lifetime.own(() => this.labels.removeEventListener('keydown', this.activate))
            }

            context.contentRoot.append(this.labels)
            this.update(node)

            if (options.theme)
                this.lifetime.own(
                    options.theme.subscribe(() => this.update(this.node)),
                )

            this.setGeometry(
                {
                    ...node.position,
                    ...node.dimensions,
                },
                {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
            )
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    update(node: EngineNode<Data>): void {
        this.node = node
        const content = this.options.getContent(node)
        const appearance = this.getAppearance(node)
        const lines = content.lines ?? []
        this.title.textContent = content.title
        this.title.dataset.heading = appearance.heading ?? 'title'
        this.tag.textContent = content.tag ?? ''
        this.tag.hidden = !content.tag

        while (this.lines.length > lines.length)
            this.lines.pop()?.remove()

        for (let index = 0; index < lines.length; index += 1) {
            if (!this.lines[index]) {
                const line = this.html`<div className="diagram-node-line"></div>` as HTMLDivElement
                this.lines.push(line)
                this.labels.append(line)
            }

            this.lines[index].textContent = lines[index]
        }

        this.labels.dataset.shape = appearance.shape ?? 'rounded-rectangle'
        this.labels.dataset.alignment = appearance.alignment ?? (appearance.shape === 'circle' ? 'center' : 'start')
        this.labels.ariaLabel = content.ariaLabel ?? [
            content.title,
            content.tag,
            ...lines,
        ].filter(Boolean).join('. ')
        this.labels.style.setProperty('--diagram-node-radius', `${appearance.cornerRadius ?? 12}px`)
        this.labels.style.setProperty('--diagram-node-text', appearance.text)
        this.labels.style.setProperty('--diagram-node-muted', appearance.muted)
        this.labels.style.setProperty('--diagram-node-accent', appearance.accent ?? appearance.text)
        this.labels.style.setProperty('--diagram-node-tag-background', appearance.tagBackground ?? 'transparent')
        this.labels.style.setProperty('--diagram-node-tag-text', appearance.tagText ?? appearance.muted)
        this.updateBodyPresentation(appearance)

        if (this.options.onActivate)
            this.labels.ariaPressed = String(this.selected || Boolean(appearance.selected))

        this.surface.setAppearance(appearance)
    }

    private getAppearance(node: EngineNode<Data>): DiagramNodeLabelAppearance {
        return this.options.getAppearance?.(node) ?? createDiagramNodeAppearance('rounded-rectangle', this.options.theme?.value)
    }

    setGeometry(
        bounds: CanvasEngineRect,
        _viewport: CanvasViewport,
    ): void {
        this.surface.setBounds(bounds)
        applyStyle(
            this.labels,
            {
                width: `${bounds.width}px`,
                height: `${bounds.height}px`,
            },
        )
    }

    setSelected(selected: boolean): void {
        this.selected = selected
        this.surface.setSelected(selected)
        this.updateBodyPresentation(
            this.getAppearance(this.node),
        )

        if (this.options.onActivate)
            this.labels.ariaPressed = String(selected || Boolean(this.getAppearance(this.node).selected))
    }

    private updateBodyPresentation(appearance: DiagramNodeLabelAppearance): void {
        applyStyle(
            this.labels,
            {
                borderRadius: appearance.shape === 'circle' ? '50%' : `${appearance.cornerRadius ?? 12}px`,
                boxShadow: this.selected
                    || appearance.selected
                    ? appearance.selectedShadow ?? appearance.shadow ?? 'none'
                    : appearance.shadow ?? 'none',
            },
        )
    }

    setVisible(visible: boolean): void {
        this.surface.setVisible(visible)
    }

    private activate = (event: KeyboardEvent): void => {
        if (
            event.key !== 'Enter'
            && event.key !== ' '
        )
            return

        event.preventDefault()
        event.stopPropagation()

        if (!event.repeat)
            this.options.onActivate?.(this.node.nodeId)
    }

    destroy = (): void => void this.lifetime.destroy()
}

export const createDiagramNodeRegistration = <Data>(options: DiagramNodeRegistrationOptions<Data>): NodeRegistration<Data> => ({
    type: options.type,
    geometry: createFixedDiagramNodeGeometry<Data>(),
    mount: (node, context) => new DiagramNodeView(
        node,
        context,
        options,
    ),
})
