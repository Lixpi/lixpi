import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    assertCanvasBounds,
    getResizeCursor,
    type CanvasEngineRect,
    type Dispose,
    type ResizeHandle,
} from '../../shared/index.ts'
import { Lifetime } from './lifetime.ts'

export type ResizeHandleSizes = {
    size: number
    offset: number
}
export type NodeResizeHandlesOptions = {
    root: HTMLElement
    handles: readonly ResizeHandle[]
    className?: (handle: ResizeHandle) => string
    content?: (
        element: HTMLElement,
        handle: ResizeHandle,
    ) => Dispose
    measure: (zoom: number) => ResizeHandleSizes
    onPointerDown: (
        event: MouseEvent,
        handle: ResizeHandle,
    ) => void
}

export class NodeResizeHandles {
    private readonly lifetime = new Lifetime()
    private readonly handles = new Map<ResizeHandle, HTMLElement>()

    constructor(
        private readonly options: NodeResizeHandlesOptions,
        zoom: number,
    ) {
        const html = createDocumentHtml(options.root.ownerDocument)

        try {
            for (const corner of options.handles) {
                const handle = html`
                    <div
                        className="canvas-node-resize-handle nopan ${options.className?.(corner) ?? ''}"
                        data=${{ corner }}
                    ></div>
                ` as HTMLElement
                this.lifetime.own(() => handle.remove())

                if (options.content)
                    this.lifetime.own(
                        options.content(handle, corner),
                    )

                const pointer = (event: MouseEvent) => options.onPointerDown(event, corner)
                handle.addEventListener('mousedown', pointer)
                this.lifetime.own(() => handle.removeEventListener('mousedown', pointer))
                this.handles.set(corner, handle)
                options.root.appendChild(handle)
            }

            this.setZoom(zoom)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    setZoom(zoom: number): void {
        if (this.lifetime.signal.aborted)
            return

        if (
            !Number.isFinite(zoom)
            || zoom <= 0
        )
            throw new Error('Resize handles require a finite positive zoom')

        const {
            size,
            offset,
        } = this.options.measure(zoom)

        if (
            !Number.isFinite(size)
            || size < 0
            || !Number.isFinite(offset)
        )
            throw new Error('Resize handle measurements must be finite with a nonnegative size')

        for (const [corner, handle] of this.handles) {
            applyStyle(
                handle,
                {
                    width: `${size}px`,
                    height: `${size}px`,
                    cursor: getResizeCursor(corner),
                    top: corner.includes('top')
                        ? `${-offset}px`
                        : corner === 'left'
                            || corner === 'right'
                            ? `calc(50% - ${size / 2}px)`
                            : '',
                    bottom: corner.includes('bottom') ? `${-offset}px` : '',
                    left: corner.includes('left')
                        ? `${-offset}px`
                        : corner === 'top'
                            || corner === 'bottom'
                            ? `calc(50% - ${size / 2}px)`
                            : '',
                    right: corner.includes('right') ? `${-offset}px` : '',
                },
            )
        }
    }

    destroy(): void {
        this.lifetime.destroy()
        this.handles.clear()
    }
}

export type NodeShellOptions = {
    document: Document
    nodeId: string
    bounds: CanvasEngineRect
    layer: number
    className?: string
    data?: Record<string, string>
    dragClassName?: string
    onClick: (event: MouseEvent) => void
    onDragStart: (event: MouseEvent) => void
    resize?: Omit<NodeResizeHandlesOptions, 'root'>
    zoom: number
}

// The shell provides canvas placement and input surfaces without node content,
// product selection policy, artwork or a visual theme.
export class NodeShell {
    readonly element: HTMLElement
    readonly dragOverlay: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly resize: NodeResizeHandles | undefined

    constructor(options: NodeShellOptions) {
        assertCanvasBounds(options.bounds, options.nodeId)
        const html = createDocumentHtml(options.document)
        const style = {
            position: 'absolute',
            left: `${options.bounds.x}px`,
            top: `${options.bounds.y}px`,
            width: `${options.bounds.width}px`,
            height: `${options.bounds.height}px`,
            zIndex: String(options.layer),
        }
        this.element = html`
            <div
                className="canvas-node-shell ${options.className ?? ''}"
                data=${{
                    nodeId: options.nodeId,
                    ...options.data,
                }}
                style=${style}
            ></div>
        ` as HTMLElement
        this.dragOverlay = html`<div className="canvas-node-drag-overlay nopan ${options.dragClassName ?? ''}"></div>` as HTMLElement

        try {
            this.lifetime.own(() => this.element.remove())
            this.element.addEventListener('click', options.onClick)
            this.lifetime.own(() => this.element.removeEventListener('click', options.onClick))
            this.dragOverlay.addEventListener('mousedown', options.onDragStart)
            this.lifetime.own(() => this.dragOverlay.removeEventListener('mousedown', options.onDragStart))

            if (options.resize) {
                this.resize = new NodeResizeHandles(
                    {
                        ...options.resize,
                        root: this.element,
                    },
                    options.zoom,
                )
                this.lifetime.own(() => this.resize?.destroy())
            }

            this.element.appendChild(this.dragOverlay)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    setZoom(zoom: number): void {
        this.resize?.setZoom(zoom)
    }
    destroy(): void {
        this.lifetime.destroy()
    }
}
