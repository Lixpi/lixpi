import {
    type CanvasNode,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { BubbleMenu } from '@lixpi/ui-kit/components/bubble-menu'
import {
    CanvasBubbleMenuItems,
    CANVAS_IMAGE_CONTEXT,
    CANVAS_VIDEO_CONTEXT,
    CANVAS_DOCUMENT_CONTEXT,
    CANVAS_AUDIO_CONTEXT,
    CANVAS_EDGE_CONTEXT,
    type CanvasBubbleMenuCallbacks,
} from './canvas-bubble-menu-items.ts'

type MenuActions = Omit<CanvasBubbleMenuCallbacks, 'onHide'>
export type WorkspaceCanvasMenuPorts = {
    pane: HTMLElement
    viewport: HTMLElement
    getNode: (nodeId: string) => CanvasNode | undefined
    getEdgeRect: (edgeId: string) => DOMRect | null
    getVisualScale: () => number
    actions: MenuActions
}

const contexts: Partial<Record<CanvasNode['type'], string>> = {
    image: CANVAS_IMAGE_CONTEXT,
    video: CANVAS_VIDEO_CONTEXT,
    mediaDocument: CANVAS_DOCUMENT_CONTEXT,
    audio: CANVAS_AUDIO_CONTEXT,
}

// Supplies canvas contexts and geometry to UI-kit's generic floating menu.
export class WorkspaceCanvasMenu {
    private readonly lifetime = new Lifetime()
    private readonly items: CanvasBubbleMenuItems
    private readonly menu: BubbleMenu

    constructor(private readonly ports: WorkspaceCanvasMenuPorts) {
        try {
            this.items = new CanvasBubbleMenuItems({
                onDeleteNode: id => this.dispatch('onDeleteNode', id),
                onDeleteEdge: id => this.dispatch('onDeleteEdge', id),
                onChangeConnectorCurve: id => this.dispatch('onChangeConnectorCurve', id),
                onDownloadMedia: id => this.dispatch('onDownloadMedia', id),
                onReplaceMedia: id => this.dispatch('onReplaceMedia', id),
                onOpenAsset: id => this.dispatch('onOpenAsset', id),
                onTriggerConnection: id => this.dispatch('onTriggerConnection', id),
                onHide: () => this.hide(true),
            }, ports.pane.ownerDocument)
            this.lifetime.own(() => this.items.destroy())
            this.menu = new BubbleMenu({ parentEl: ports.pane, items: this.items.items, getVisualScale: ports.getVisualScale })
            this.lifetime.own(() => this.menu.destroy())
        } catch (error) {
            try {
                this.lifetime.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Canvas menu mounting failed')
            }
            throw error
        }
    }

    showNode(nodeId: string): void {
        if (this.lifetime.signal.aborted) return
        const node = this.ports.getNode(nodeId)
        const context = node ? contexts[node.type] : undefined
        const targetRect = this.nodeRect(nodeId)
        if (!context || !targetRect) {
            this.hide()
            return
        }
        this.items.setActiveEdgeId(null)
        this.items.setActiveNodeId(nodeId)
        this.menu.show(context, { targetRect, placement: 'below', clampToParent: false, animateOnShow: false })
        this.menu.refreshState()
    }

    showEdge(edgeId: string): void {
        if (this.lifetime.signal.aborted) return
        const targetRect = this.ports.getEdgeRect(edgeId)
        if (!targetRect) {
            this.hide()
            return
        }
        this.items.setActiveNodeId(null)
        this.items.setActiveEdgeId(edgeId)
        this.menu.show(CANVAS_EDGE_CONTEXT, { targetRect, placement: 'below' })
    }

    repositionNode(nodeId: string | null): void {
        if (this.lifetime.signal.aborted || !this.menu.isVisible || !nodeId) return
        const targetRect = this.nodeRect(nodeId)
        if (targetRect) this.menu.reposition({ targetRect, placement: 'below', clampToParent: false, animateOnShow: false })
        else this.hide()
    }

    repositionEdge(edgeId: string | null): void {
        if (this.lifetime.signal.aborted || !this.menu.isVisible || !edgeId) return
        const targetRect = this.ports.getEdgeRect(edgeId)
        if (targetRect) this.menu.reposition({ targetRect, placement: 'below' })
        else this.hide()
    }

    hide(force = false): void {
        if (this.lifetime.signal.aborted) return
        this.items.setActiveNodeId(null)
        this.items.setActiveEdgeId(null)
        if (force) this.menu.forceHide()
        else this.menu.hide()
    }

    destroy(): void {
        this.lifetime.destroy()
    }

    private nodeRect(nodeId: string): DOMRect | null {
        const element = [...this.ports.viewport.querySelectorAll<HTMLElement>('[data-node-id]')].find(candidate => candidate.dataset.nodeId === nodeId)
        return element?.getBoundingClientRect() ?? null
    }

    private dispatch(action: keyof MenuActions, id: string): void {
        if (!this.lifetime.signal.aborted) this.ports.actions[action](id)
    }
}
