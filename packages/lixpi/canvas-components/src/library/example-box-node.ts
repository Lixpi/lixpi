import {
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    Lifetime,
    type ComponentContext,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import { roundedRectanglePath } from '@lixpi/ui-primitives/svg'
import {
    type CanvasThemeSource,
} from '../frontend/theme/canvas-theme.ts'

export type ExampleBoxContent = {
    title: string
    tag?: string
    lines?: readonly string[]
    raised?: boolean
}

export type ExampleBoxViewOptions<Data> = {
    theme: CanvasThemeSource
    getContent: (node: EngineNode<Data>) => ExampleBoxContent
}

// Engine examples need a plain labeled rectangle to show dragging, resizing,
// connecting and layout. It is documentation presentation, not a product
// node; product canvases register their own node views.
export class ExampleBoxView<Data> implements NodeView<Data> {
    private readonly lifetime = new Lifetime()
    private readonly group
    private readonly path
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly title: HTMLSpanElement
    private readonly tag: HTMLSpanElement
    private readonly labels: HTMLDivElement
    private readonly lines: HTMLDivElement[] = []
    private bounds: CanvasEngineRect
    private content: ExampleBoxContent
    private selected = false

    constructor(
        private node: EngineNode<Data>,
        private readonly context: ComponentContext,
        private readonly options: ExampleBoxViewOptions<Data>,
    ) {
        this.bounds = {
            ...node.position,
            ...node.dimensions,
        }
        this.content = options.getContent(node)
        this.html = createDocumentHtml(context.contentRoot.ownerDocument)
        this.title = this.html`<span className="canvas-example-box-title"></span>` as HTMLSpanElement
        this.tag = this.html`<span className="canvas-example-box-tag"></span>` as HTMLSpanElement
        this.labels = this.html`
            <div className="canvas-example-box">
                <div className="canvas-example-box-heading">
                    ${this.title}
                    ${this.tag}
                </div>
            </div>
        ` as HTMLDivElement
        this.group = context.resources.createGroup({
            space: 'world',
            layer: context.layers.media,
        })
        this.lifetime.own(() => context.resources.release(this.group))

        try {
            this.path = context.resources.createPath(this.group, [])
            context.contentRoot.append(this.labels)
            this.lifetime.own(() => this.labels.remove())
            this.lifetime.own(
                options.theme.subscribe(() => this.paint()),
            )
            this.update(node)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    update(node: EngineNode<Data>): void {
        this.node = node
        this.content = this.options.getContent(node)
        const lines = this.content.lines ?? []
        this.title.textContent = this.content.title
        this.tag.textContent = this.content.tag ?? ''
        this.tag.hidden = !this.content.tag

        while (this.lines.length > lines.length)
            this.lines.pop()?.remove()

        for (let index = 0; index < lines.length; index += 1) {
            if (!this.lines[index]) {
                const line = this.html`<div className="canvas-example-box-line"></div>` as HTMLDivElement
                this.lines.push(line)
                this.labels.append(line)
            }

            this.lines[index].textContent = lines[index]
        }

        this.paint()
    }

    setGeometry(
        bounds: CanvasEngineRect,
        _viewport: CanvasViewport,
    ): void {
        this.bounds = bounds
        this.paint()
    }

    setSelected(selected: boolean): void {
        this.selected = selected
        this.paint()
    }

    setVisible(visible: boolean): void {
        this.context.resources.setVisible(this.group, visible)
    }

    destroy = (): void => void this.lifetime.destroy()

    private paint(): void {
        const theme = this.options.theme.value
        const {
            x,
            y,
            width,
            height,
        } = this.bounds
        this.context.resources.updateGroup(
            this.group,
            { position: {
                x,
                y,
            } },
        )
        this.context.resources.updatePath(
            this.path,
            [{
                path: roundedRectanglePath(
                    {
                        x: 0,
                        y: 0,
                        width,
                        height,
                    },
                    theme.shape.nodeRadius,
                ),
                fill: { color: this.content.raised ? theme.colors.raised : theme.colors.surface },
                stroke: {
                    color: theme.colors.border,
                    width: theme.shape.borderWidth,
                },
            }],
        )
        applyStyle(
            this.labels,
            {
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: `${theme.shape.nodeRadius}px`,
                boxShadow: this.selected ? theme.shadows.selected : theme.shadows.node,
            },
        )
    }
}
