import {
    type CanvasEngineRect,
    type CanvasViewport,
    type Dispose,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '../../shared/index.ts'
import {
    type CanvasDrawingSurface,
} from '../rendering/drawing-scope.ts'

export type CanvasView = { viewport: CanvasViewport; screenBounds: CanvasEngineRect }

export type CanvasDrawingContext = CanvasDrawingSurface & {
    subscribeScene: (callback: (scene: SceneSnapshot) => void) => Dispose
    subscribeView: (callback: (view: CanvasView) => void) => Dispose
    mountOverlay: (element: HTMLElement, space: 'world' | 'screen') => Dispose
}

export type ComponentContext = CanvasDrawingContext & { contentRoot: HTMLElement }

export type NodeView<Data = unknown> = {
    update: (node: EngineNode<Data>) => void
    setGeometry: (worldBounds: CanvasEngineRect, viewport: CanvasViewport) => void
    setSelected: (selected: boolean) => void
    setVisible: (visible: boolean) => void
    prefetch?: () => Promise<void>
    destroy: Dispose
}

export type NodeRegistration<Data = unknown> = {
    type: string
    geometry: NodeGeometryPolicy<Data>
    mount: (node: EngineNode<Data>, context: ComponentContext) => NodeView<Data>
}

export class NodeRegistry {
    private readonly registrations = new Map<string, NodeRegistration>()

    register<Data>(registration: NodeRegistration<Data>): this {
        if (!registration.type.trim()) throw new Error('Node registrations require a nonempty type')
        if (this.registrations.has(registration.type)) throw new Error(`Node type is already registered: ${registration.type}`)
        this.registrations.set(registration.type, registration as NodeRegistration)
        return this
    }

    get(type: string): NodeRegistration | undefined {
        return this.registrations.get(type)
    }
}
