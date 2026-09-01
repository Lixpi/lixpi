import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    trashBinIcon,
    downloadIcon,
    triggerNodesConnectionIcon,
    changeNodesConnectorLineCurve,
    infoCircleFilledIcon,
} from '@lixpi/ui-kit/svg'
import {
    type BubbleMenuItem,
} from '@lixpi/ui-kit/components/bubble-menu'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export const CANVAS_IMAGE_CONTEXT = 'canvasImage'
export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'
export const CANVAS_DOCUMENT_CONTEXT = 'canvasDocument'
export const CANVAS_AUDIO_CONTEXT = 'canvasAudio'
export const CANVAS_EDGE_CONTEXT = 'canvasEdge'

export type CanvasBubbleMenuCallbacks = {
    onDeleteNode: (nodeId: string) => void
    onDeleteEdge: (edgeId: string) => void
    onChangeConnectorCurve: (edgeId: string) => void
    onDownloadMedia: (nodeId: string) => void
    onReplaceMedia: (nodeId: string) => void
    onOpenAsset: (nodeId: string) => void
    onTriggerConnection: (nodeId: string) => void
    onHide: () => void
}

type ItemOptions = {
    title: string
    icon: string
    context: string[]
    action: (id: string) => void
    edge?: boolean
    hideFirst?: boolean
    rotate?: boolean
}

export class CanvasBubbleMenuItems {
    readonly items: BubbleMenuItem[]
    private readonly lifetime = new Lifetime()
    private activeNodeId: string | null = null
    private activeEdgeId: string | null = null

    constructor(private readonly callbacks: CanvasBubbleMenuCallbacks, private readonly document: Document) {
        const mediaContexts = [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT]
        try {
            this.items = [
                this.item({ title: 'Replace media', icon: downloadIcon, context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT], action: callbacks.onReplaceMedia, rotate: true }),
                this.item({ title: 'Download media', icon: downloadIcon, context: mediaContexts, action: callbacks.onDownloadMedia }),
                this.item({ title: 'Open Asset details', icon: infoCircleFilledIcon, context: mediaContexts, action: callbacks.onOpenAsset }),
                this.item({ title: 'Connect to node', icon: triggerNodesConnectionIcon, context: mediaContexts, action: callbacks.onTriggerConnection, hideFirst: true }),
                this.item({ title: 'Delete image', icon: trashBinIcon, context: [CANVAS_IMAGE_CONTEXT], action: callbacks.onDeleteNode }),
                this.item({ title: 'Delete video', icon: trashBinIcon, context: [CANVAS_VIDEO_CONTEXT], action: callbacks.onDeleteNode }),
                this.item({ title: 'Delete file', icon: trashBinIcon, context: [CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT], action: callbacks.onDeleteNode }),
                this.item({ title: 'Change connector curve', icon: changeNodesConnectorLineCurve, context: [CANVAS_EDGE_CONTEXT], action: callbacks.onChangeConnectorCurve, edge: true }),
                this.item({ title: 'Delete connection', icon: trashBinIcon, context: [CANVAS_EDGE_CONTEXT], action: callbacks.onDeleteEdge, edge: true }),
            ]
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private item(options: ItemOptions): BubbleMenuItem {
        const html = createDocumentHtml(this.document)
        const element = html`<button className="bubble-menu-button" type="button" aria-label=${options.title} data-help-tooltip="aria-label" innerHTML=${options.icon}></button>` as HTMLButtonElement
        const svg = element.querySelector('svg')
        if (svg) applyStyle(svg, { width: '16px', height: '16px', ...(options.rotate ? { transform: 'rotate(180deg)' } : {}) })
        const click = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            const id = options.edge ? this.activeEdgeId : this.activeNodeId
            if (!id) return
            if (options.hideFirst) this.callbacks.onHide()
            options.action(id)
            if (!options.hideFirst) this.callbacks.onHide()
        }
        element.addEventListener('click', click)
        this.lifetime.own(() => {
            element.removeEventListener('click', click)
            element.remove()
        })
        return { element, context: [...options.context] }
    }

    getActiveNodeId = (): string | null => this.activeNodeId
    getActiveEdgeId = (): string | null => this.activeEdgeId
    setActiveNodeId = (id: string | null): void => {
        if (!this.lifetime.signal.aborted) this.activeNodeId = id
    }
    setActiveEdgeId = (id: string | null): void => {
        if (!this.lifetime.signal.aborted) this.activeEdgeId = id
    }

    destroy(): void {
        this.activeNodeId = null
        this.activeEdgeId = null
        this.lifetime.destroy()
    }
}

export function buildCanvasBubbleMenuItems(callbacks: CanvasBubbleMenuCallbacks, document: Document = globalThis.document): CanvasBubbleMenuItems {
    return new CanvasBubbleMenuItems(callbacks, document)
}
