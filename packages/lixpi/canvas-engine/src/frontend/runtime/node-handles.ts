import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    assertCanvasBounds,
    type CanvasEngineRect,
    type CanvasPort,
    type ResizeHandle,
} from '../../shared/index.ts'
import { Lifetime } from './lifetime.ts'
import { NodeResizeHandles } from './node-shell.ts'

export type NodeHandlesOptions = {
    root: HTMLElement
    nodeId: string
    flowId: string
    size?: number
    onConnect: (event: MouseEvent | TouchEvent, port: CanvasPort, element: HTMLElement, isTarget: boolean) => void
    onResize: (event: MouseEvent, handle: ResizeHandle) => void
}

// Owns structural hit targets only. Node content and appearance belong to registrations.
export class NodeHandles {
    readonly element: HTMLElement
    private readonly lifetime = new Lifetime()
    private children = new Lifetime()
    private key = ''

    constructor(private readonly options: NodeHandlesOptions) {
        if (!Number.isFinite(options.size ?? 10) || (options.size ?? 10) <= 0) throw new Error('Node handle size must be finite and positive')
        const html = createDocumentHtml(options.root.ownerDocument)
        this.element = html`<div className="canvas-node-handles" data=${{ canvasNodeId: options.nodeId }}></div>` as HTMLElement
        options.root.appendChild(this.element)
        this.lifetime.own(() => this.element.remove())
        this.lifetime.own(() => this.children.destroy())
    }

    update(bounds: CanvasEngineRect, ports: readonly CanvasPort[], selected: boolean, zoom: number): void {
        if (this.lifetime.signal.aborted) return
        assertCanvasBounds(bounds, this.options.nodeId)
        if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Node handle zoom must be finite and positive')
        applyStyle(this.element, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
        const size = (this.options.size ?? 10) / zoom
        const key = JSON.stringify([ports, selected, size])
        if (key === this.key) return
        this.children.destroy()
        this.children = new Lifetime()
        this.element.replaceChildren()
        const html = createDocumentHtml(this.element.ownerDocument)
        for (const port of ports) {
            const roles = port.role === 'both' ? ['source', 'target'] as const : [port.role === 'input' ? 'target' : 'source'] as const
            for (const role of roles) {
                const style = { left: `${port.anchor.x}px`, top: `${port.anchor.y}px`, width: `${size}px`, height: `${size}px` }
                const data = { nodeid: this.options.nodeId, handleid: port.id, handlepos: port.direction, id: `${this.options.flowId}-${this.options.nodeId}-${port.id}-${role}` }
                const handle = html`<div className="canvas-port nopan connectable connectableend xy-flow__handle ${role} ${port.direction}" data=${data} style=${style}></div>` as HTMLElement
                const pointer = (event: MouseEvent | TouchEvent) => {
                    event.stopPropagation()
                    this.options.onConnect(event, port, handle, role === 'target')
                }
                handle.addEventListener('mousedown', pointer)
                handle.addEventListener('touchstart', pointer, { passive: false })
                this.children.own(() => {
                    handle.removeEventListener('mousedown', pointer)
                    handle.removeEventListener('touchstart', pointer)
                })
                this.element.appendChild(handle)
            }
        }
        if (selected) {
            const resize = new NodeResizeHandles({
                root: this.element,
                handles: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
                className: () => 'canvas-resize-handle',
                measure: () => ({ size, offset: size / 2 }),
                onPointerDown: (event, corner) => {
                    event.stopPropagation()
                    this.options.onResize(event, corner)
                },
            }, zoom)
            this.children.own(() => resize.destroy())
        }
        this.key = key
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
