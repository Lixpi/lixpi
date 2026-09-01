import RBush from 'rbush'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import {
    assertCanvasBounds,
    CanvasDiagnosticError,
    validateScene,
    buildNodesById,
    computeWorldPosition,
    type CanvasDiagnostic,
    type CanvasEngineRect,
    type CanvasEngineSize,
    type CanvasViewport,
    type Dispose,
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '../../shared/index.ts'
import type { CanvasRenderer } from '../rendering/canvas-renderer.ts'
import type { CanvasDrawingScope } from '../rendering/drawing-scope.ts'
import { IdleTask } from './idle-task.ts'
import {
    NodeViews,
    type NodePresentation,
} from './node-views.ts'
import { SceneContext } from './scene-context.ts'
import type {
    CanvasView,
    ComponentContext,
    NodeRegistry,
    NodeView,
} from './node-registry.ts'
import {
    GeometryOverrides,
    type GeometryOverrideScope,
    type NodeGeometryOverride,
} from './geometry-overrides.ts'

export type MeasuredNodeGeometry = ReturnType<NodeGeometryPolicy['measure']> & { worldBounds: CanvasEngineRect }

export type CanvasSceneOptions = {
    renderer: CanvasRenderer
    root: HTMLElement
    registry: NodeRegistry
    onError: (error: unknown, nodeId?: string) => void
    onDiagnostic?: (diagnostic: CanvasDiagnostic) => void
    visibilityMargin?: number
    prefetchBatchSize?: number
    mountUnknown?: (node: EngineNode, context: ComponentContext) => NodeView
    geometry?: GeometryOverrides
}

type IndexedNode = { nodeId: string; minX: number; minY: number; maxX: number; maxY: number }

// Owns presentation and component lifetimes. Gesture controllers can update live
// bounds without mutating the authoritative scene or component payloads.
export class CanvasScene {
    private readonly worldRoot: HTMLElement
    private readonly screenRoot: HTMLElement
    private readonly views: NodeViews
    private readonly lifetime: CanvasDrawingScope
    private readonly contexts = new Set<SceneContext>()
    private readonly nodeContexts = new Map<string, SceneContext>()
    private readonly sceneSubscribers = new Set<(scene: SceneSnapshot) => void>()
    private readonly viewSubscribers = new Set<(view: CanvasView) => void>()
    private readonly spatial = new RBush<IndexedNode>()
    private readonly bounds = new Map<string, CanvasEngineRect>()
    private readonly measurements = new Map<string, MeasuredNodeGeometry>()
    readonly geometry: GeometryOverrides
    private liveGeometry: GeometryOverrideScope
    private selected: ReadonlySet<string> = new Set()
    private visible = new Set<string>()
    private snapshot: SceneSnapshot = { sceneKey: '', revision: '', nodes: [], edges: [] }
    private view: CanvasView = { viewport: { x: 0, y: 0, zoom: 1 }, screenBounds: { x: 0, y: 0, width: 1, height: 1 } }
    private prefetch: IdleTask | null = null
    private nextScene: SceneSnapshot | null = null
    private syncing = false
    private destroyed = false

    constructor(private readonly options: CanvasSceneOptions) {
        this.geometry = options.geometry ?? new GeometryOverrides()
        this.liveGeometry = this.geometry.createScope()
        const html = createDocumentHtml(options.root.ownerDocument)
        const style = { position: 'absolute', inset: '0', pointerEvents: 'none', transformOrigin: '0 0' }
        this.worldRoot = html`<div style=${style}></div>` as HTMLElement
        this.screenRoot = html`<div style=${style}></div>` as HTMLElement
        this.lifetime = options.renderer.createScope()
        this.views = new NodeViews({
            registry: options.registry,
            createScope: node => {
                const context = this.createContext(node.nodeId)
                return { context, destroy: context.destroy }
            },
            mountUnknown: (node, context) => {
                const diagnostic: CanvasDiagnostic = { code: 'unknown-node-type', nodeId: node.nodeId, message: `Unregistered canvas node type: ${node.type}` }
                if (options.onDiagnostic) options.onDiagnostic(diagnostic)
                else options.onError(new CanvasDiagnosticError(diagnostic), node.nodeId)
                return options.mountUnknown?.(node, context) ?? new UnknownNodeView(node, context)
            },
            onError: options.onError,
        })
        options.root.append(this.worldRoot, this.screenRoot)
        this.lifetime.signal.addEventListener('abort', this.destroy, { once: true })
    }

    get scene(): SceneSnapshot {
        return this.snapshot
    }
    get worldElement(): HTMLElement {
        return this.worldRoot
    }
    get viewport(): CanvasViewport {
        return this.view.viewport
    }
    get screenBounds(): CanvasEngineRect {
        return this.view.screenBounds
    }
    getWorldBounds(nodeId: string): CanvasEngineRect | undefined {
        const bounds = this.bounds.get(nodeId)
        return bounds ? { ...bounds } : undefined
    }
    getNodeGeometry(nodeId: string): MeasuredNodeGeometry | undefined {
        const measurement = this.measurements.get(nodeId)
        return measurement ? structuredClone(measurement) : undefined
    }
    getNodeRoot(nodeId: string): HTMLElement | undefined {
        return this.nodeContexts.get(nodeId)?.contentRoot
    }
    getNodeView(nodeId: string): NodeView | undefined {
        return this.views.get(nodeId)
    }

    setScene(scene: SceneSnapshot): void {
        if (this.destroyed) return
        validateScene(scene)
        this.nextScene = scene
        if (this.syncing) return
        this.syncing = true
        try {
            while (this.nextScene && !this.destroyed) {
                const next = this.nextScene
                this.nextScene = null
                const changedScene = next.sceneKey !== this.snapshot.sceneKey
                const bounds = this.measureGeometry(next, id => changedScene ? undefined : this.geometry.get(id, this.liveGeometry))
                if (changedScene) {
                    this.selected = new Set()
                    this.geometry.clear()
                }
                this.snapshot = next
                this.liveGeometry.destroy()
                this.liveGeometry = this.geometry.createScope()
                this.indexGeometry(bounds)
                this.updateVisibility()
                this.views.sync({ sceneKey: next.sceneKey, nodes: next.nodes, presentation: node => this.presentation(node.nodeId) })
                this.publish(this.sceneSubscribers, next)
                this.schedulePrefetch()
            }
        } finally {
            this.syncing = false
        }
    }

    setViewport(viewport: CanvasViewport, size?: CanvasEngineSize): void {
        if (this.destroyed) return
        if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0) throw new Error('Canvas viewport must be finite with a positive zoom')
        if (size) assertCanvasBounds({ x: 0, y: 0, ...size })
        this.view = { viewport: { ...viewport }, screenBounds: { x: 0, y: 0, ...(size ?? this.view.screenBounds) } }
        this.options.renderer.setViewport(viewport)
        applyStyle(this.worldRoot, { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` })
        this.updateVisibility()
        this.presentAll()
        this.publish(this.viewSubscribers, this.view)
        this.schedulePrefetch()
    }

    setSelected(nodeIds: ReadonlySet<string>): void {
        if (this.destroyed) return
        this.selected = new Set(nodeIds)
        this.presentAll()
    }

    setLiveBounds(nodeId: string, bounds: CanvasEngineRect): void {
        if (this.destroyed || !this.bounds.has(nodeId)) return
        assertCanvasBounds(bounds, nodeId)
        const override = { position: { x: bounds.x, y: bounds.y }, dimensions: { width: bounds.width, height: bounds.height } }
        const measured = this.measureGeometry(this.snapshot, id => id === nodeId ? override : this.geometry.get(id))
        this.liveGeometry.set(nodeId, override)
        this.indexGeometry(measured)
        this.updateVisibility()
        this.presentAll()
        this.schedulePrefetch()
    }

    refreshGeometry(): void {
        if (this.destroyed) return
        this.indexGeometry(this.measureGeometry(this.snapshot, id => this.geometry.get(id)))
        this.updateVisibility()
        this.presentAll()
        this.schedulePrefetch()
    }

    private measureGeometry(scene: SceneSnapshot, getOverride: (nodeId: string) => NodeGeometryOverride | undefined): Map<string, MeasuredNodeGeometry> {
        const boundsById = new Map<string, MeasuredNodeGeometry>()
        const byId = buildNodesById(scene.nodes)
        for (const node of scene.nodes) {
            const worldNode = { ...node, parentId: undefined, position: computeWorldPosition(node, byId, id => getOverride(id)?.position), dimensions: getOverride(node.nodeId)?.dimensions ?? node.dimensions }
            const worldBounds = { ...worldNode.position, ...worldNode.dimensions }
            assertCanvasBounds(worldBounds, node.nodeId)
            const geometry = this.options.registry.get(node.type)?.geometry
            const measurement = geometry?.measure(worldNode) ?? { visualBounds: worldBounds, hitBounds: worldBounds, selectionBounds: worldBounds, collisionBounds: worldBounds, connectorBounds: worldBounds }
            for (const key of ['visualBounds', 'hitBounds', 'selectionBounds', 'collisionBounds', 'connectorBounds'] as const) assertCanvasBounds(measurement[key], node.nodeId)
            boundsById.set(node.nodeId, structuredClone({ ...measurement, worldBounds }))
        }
        return boundsById
    }

    private indexGeometry(boundsById: ReadonlyMap<string, MeasuredNodeGeometry>): void {
        this.bounds.clear()
        this.measurements.clear()
        const entries: IndexedNode[] = []
        for (const [nodeId, measurement] of boundsById) {
            this.measurements.set(nodeId, measurement)
            const bounds = measurement.visualBounds
            this.bounds.set(nodeId, bounds)
            entries.push({ nodeId, minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height })
        }
        this.spatial.clear().load(entries)
    }

    private updateVisibility(): void {
        const { viewport: { x, y, zoom }, screenBounds: { width, height } } = this.view
        const margin = Math.max(0, this.options.visibilityMargin ?? 0)
        this.visible = new Set(this.spatial.search({ minX: -x / zoom - margin, minY: -y / zoom - margin, maxX: (width - x) / zoom + margin, maxY: (height - y) / zoom + margin }).map(entry => entry.nodeId))
    }

    private presentation(nodeId: string): NodePresentation {
        const worldBounds = this.bounds.get(nodeId)!
        const context = this.nodeContexts.get(nodeId)
        context?.setGeometry(worldBounds)
        if (context) context.contentRoot.style.display = this.visible.has(nodeId) ? '' : 'none'
        return { worldBounds, viewport: this.view.viewport, visible: this.visible.has(nodeId), selected: this.selected.has(nodeId) }
    }

    private presentAll(): void {
        for (const node of this.snapshot.nodes) {
            try {
                this.views.present(node.nodeId, this.presentation(node.nodeId))
            } catch (error) {
                this.options.onError(error, node.nodeId)
            }
        }
    }

    createContext(nodeId?: string): SceneContext {
        if (this.destroyed) throw new Error('Canvas scene is disposed')
        const html = createDocumentHtml(this.options.root.ownerDocument)
        const style = { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' }
        const root = html`<div style=${style}></div>` as HTMLElement
        if (nodeId) root.dataset.canvasNodeId = nodeId
        const drawing = this.options.renderer.createScope()
        const context = new SceneContext(root, drawing, this, () => {
            this.contexts.delete(context)
            if (nodeId && this.nodeContexts.get(nodeId) === context) this.nodeContexts.delete(nodeId)
        })
        this.contexts.add(context)
        if (nodeId) this.nodeContexts.set(nodeId, context)
        this.worldRoot.appendChild(root)
        return context
    }

    subscribeScene = (callback: (scene: SceneSnapshot) => void): Dispose => this.subscribe(this.sceneSubscribers, callback, this.snapshot)
    subscribeView = (callback: (view: CanvasView) => void): Dispose => this.subscribe(this.viewSubscribers, callback, this.view)

    private subscribe<Value>(subscribers: Set<(value: Value) => void>, callback: (value: Value) => void, value: Value): Dispose {
        if (this.destroyed) throw new Error('Canvas scene is disposed')
        subscribers.add(callback)
        try {
            callback(value)
        } catch (error) {
            subscribers.delete(callback)
            throw error
        }
        return () => subscribers.delete(callback)
    }

    private publish<Value>(subscribers: Set<(value: Value) => void>, value: Value): void {
        for (const callback of Array.from(subscribers)) {
            if (this.destroyed) return
            if (!subscribers.has(callback)) continue
            try {
                callback(value)
            } catch (error) {
                this.options.onError(error)
            }
        }
    }

    mountOverlay = (element: HTMLElement, space: 'world' | 'screen'): Dispose => {
        if (this.destroyed) throw new Error('Canvas scene is disposed')
        ;(space === 'world' ? this.worldRoot : this.screenRoot).appendChild(element)
        return () => element.remove()
    }

    private schedulePrefetch(): void {
        this.prefetch?.destroy()
        const batchSize = Math.max(0, Math.floor(this.options.prefetchBatchSize ?? 0))
        if (!batchSize || this.destroyed) return
        const { x, y, zoom } = this.view.viewport
        const center = { x: (this.view.screenBounds.width / 2 - x) / zoom, y: (this.view.screenBounds.height / 2 - y) / zoom }
        const candidates = this.snapshot.nodes.filter(node => !this.visible.has(node.nodeId) && this.views.get(node.nodeId)?.prefetch)
        const distance = (node: EngineNode) => {
            const bounds = this.bounds.get(node.nodeId)!
            return (bounds.x + bounds.width / 2 - center.x) ** 2 + (bounds.y + bounds.height / 2 - center.y) ** 2
        }
        candidates.sort((a, b) => distance(a) - distance(b))
        const next = () => {
            this.prefetch = new IdleTask({
                signal: this.lifetime.signal,
                callback: () => {
                    for (const node of candidates.splice(0, batchSize)) void this.prefetchNode(node.nodeId)
                    if (candidates.length && !this.destroyed) next()
                },
            })
        }
        if (candidates.length) next()
    }

    private async prefetchNode(nodeId: string): Promise<void> {
        try {
            await this.views.get(nodeId)?.prefetch?.()
        } catch (error) {
            if (!this.destroyed) this.options.onError(error, nodeId)
        }
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.nextScene = null
        this.prefetch?.destroy()
        this.lifetime.signal.removeEventListener('abort', this.destroy)
        this.views.destroy()
        for (const context of Array.from(this.contexts)) {
            try {
                context.destroy()
            } catch (error) {
                this.options.onError(error)
            }
        }
        this.sceneSubscribers.clear()
        this.viewSubscribers.clear()
        this.worldRoot.remove()
        this.screenRoot.remove()
        this.spatial.clear()
        this.bounds.clear()
        this.measurements.clear()
        this.liveGeometry.destroy()
        if (!this.options.geometry) this.geometry.destroy()
        this.lifetime.destroy()
    }
}

class UnknownNodeView implements NodeView {
    constructor(node: EngineNode, private readonly context: ComponentContext) {
        this.update(node)
    }
    update(node: EngineNode): void {
        this.context.contentRoot.textContent = `Unknown node type: ${node.type}`
    }
    setGeometry(): void {}
    setSelected(): void {}
    setVisible(): void {}
    destroy(): void {
        this.context.contentRoot.replaceChildren()
    }
}
