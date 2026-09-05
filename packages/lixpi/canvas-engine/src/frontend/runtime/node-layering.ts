import { applyStyle } from '@lixpi/ui-primitives/dom'

export type NodeLayerOptions = {
    initialIndex?: number
    backgroundIndex?: number
}

export class NodeLayerManager {
    private topZIndex: number
    private readonly backgroundZIndex: number

    constructor(options: NodeLayerOptions = {}) {
        this.topZIndex = options.initialIndex ?? 10
        this.backgroundZIndex = options.backgroundIndex ?? 1
    }

    bringToFront(element: HTMLElement): void {
        applyStyle(element, { zIndex: String(++this.topZIndex) })
    }

    sendToBackground(element: HTMLElement): void {
        applyStyle(element, { zIndex: String(this.backgroundZIndex) })
    }

    currentTopIndex(): number {
        return this.topZIndex
    }
    backgroundIndex(): number {
        return this.backgroundZIndex
    }
}

export const createNodeLayerManager = (options?: NodeLayerOptions): NodeLayerManager => new NodeLayerManager(options)
