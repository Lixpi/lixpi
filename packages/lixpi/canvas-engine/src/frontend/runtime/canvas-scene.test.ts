// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasRenderer,
} from '../rendering/canvas-renderer.ts'
import {
    type CanvasDrawingScope,
} from '../rendering/drawing-scope.ts'
import {
    type EngineNode,
    type NodeGeometryPolicy,
    type SceneSnapshot,
} from '../../shared/index.ts'
import { CanvasScene } from './canvas-scene.ts'
import {
    NodeRegistry,
    type ComponentContext,
    type NodeView,
} from './node-registry.ts'
import { GeometryOverrides } from './geometry-overrides.ts'

class RendererFixture {
    scopes: AbortController[] = []
    setViewport = vi.fn()
    createScope(): CanvasDrawingScope {
        const controller = new AbortController()
        this.scopes.push(controller)
        return { signal: controller.signal, destroy: () => controller.abort(), resources: {}, media: {}, layers: {}, requestFrame: vi.fn(), invalidate: vi.fn() } as unknown as CanvasDrawingScope
    }
}

const geometry: NodeGeometryPolicy = {
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
    },
    movable: true,
    resize: { min: { width: 1, height: 1 }, preserveAspectRatio: false },
}

function node(nodeId: string, position = { x: 10, y: 20 }, parentId?: string): EngineNode {
    return { nodeId, type: 'card', data: null, ports: [], position, parentId, dimensions: { width: 50, height: 40 } }
}

function snapshot(nodes: EngineNode[], sceneKey = 'one'): SceneSnapshot {
    return { nodes, sceneKey, revision: '1', edges: [] }
}

function fixture(mount?: (node: EngineNode, context: ComponentContext) => NodeView, overrides?: GeometryOverrides) {
    const renderer = new RendererFixture()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const mounted = new Map<string, { context: ComponentContext; view: NodeView }>()
    const registry = new NodeRegistry().register({
        type: 'card',
        geometry,
        mount: (node, context) => {
            const view = mount?.(node, context) ?? { update: vi.fn(), setGeometry: vi.fn(), setVisible: vi.fn(), setSelected: vi.fn(), destroy: vi.fn() }
            mounted.set(node.nodeId, { view, context })
            return view
        },
    })
    const onError = vi.fn()
    const scene = new CanvasScene({ renderer: renderer as unknown as CanvasRenderer, root, registry, onError, geometry: overrides })
    scene.setViewport({ x: 0, y: 0, zoom: 1 }, { width: 400, height: 300 })
    return { renderer, root, scene, mounted, onError }
}

afterEach(() => document.body.replaceChildren())

describe('CanvasScene', () => {
    it('retains distinct measured footprints without exposing mutable geometry', () => {
        const measure = vi.spyOn(geometry, 'measure').mockImplementation(node => {
            const bounds = { ...node.position, ...node.dimensions }
            return { visualBounds: { ...bounds, width: 80 }, hitBounds: { ...bounds, width: 40 }, selectionBounds: { ...bounds, width: 60 }, collisionBounds: { ...bounds, height: 70 }, connectorBounds: { ...bounds, x: bounds.x + 5 } }
        })
        try {
            const { scene } = fixture()
            scene.setScene(snapshot([node('a')]))
            const measured = scene.getNodeGeometry('a')!
            expect(measured.worldBounds.width).toBe(50)
            expect(measured.visualBounds.width).toBe(80)
            expect(measured.hitBounds.width).toBe(40)
            expect(measured.selectionBounds.width).toBe(60)
            expect(measured.collisionBounds.height).toBe(70)
            expect(measured.connectorBounds.x).toBe(15)
            measured.hitBounds.width = 1000
            expect(scene.getNodeGeometry('a')?.hitBounds.width).toBe(40)
            scene.destroy()
        } finally {
            measure.mockRestore()
        }
    })

    it('shares scoped world geometry and expires writers on a scene change', () => {
        const overrides = new GeometryOverrides()
        const { scene } = fixture(undefined, overrides)
        scene.setScene(snapshot([node('parent'), node('child', { x: 5, y: 5 }, 'parent')]))
        const projection = overrides.createScope()
        projection.set('parent', { position: { x: 100, y: 200 } })
        scene.refreshGeometry()
        expect(scene.getNodeGeometry('child')?.worldBounds.x).toBe(105)
        scene.setScene(snapshot([node('parent'), node('child', { x: 10, y: 10 }, 'parent')]))
        expect(scene.getNodeGeometry('child')?.worldBounds.x).toBe(110)
        const drag = overrides.createScope(1)
        drag.set('child', { position: { x: 500, y: 600 } })
        scene.refreshGeometry()
        expect(scene.getNodeGeometry('child')?.worldBounds.x).toBe(500)
        drag.destroy()
        scene.refreshGeometry()
        expect(scene.getNodeGeometry('child')?.worldBounds.x).toBe(110)
        scene.setScene(snapshot([node('parent')], 'two'))
        projection.set('parent', { position: { x: 900, y: 900 } })
        scene.refreshGeometry()
        expect(scene.getNodeGeometry('parent')?.worldBounds.x).toBe(10)
        scene.destroy()
        overrides.destroy()
    })

    it('rejects invalid snapshots and live geometry before replacing the visible scene', () => {
        const { scene, mounted } = fixture()
        const valid = snapshot([node('a')])
        scene.setScene(valid)
        const view = mounted.get('a')!.view
        expect(() => scene.setScene(snapshot([node('bad', { x: NaN, y: 0 })], 'bad'))).toThrow()
        expect(() => scene.setScene(snapshot([node('a', { x: 0, y: 0 }, 'b'), node('b', { x: 0, y: 0 }, 'a')]))).toThrow()
        expect(() => scene.setLiveBounds('a', { x: 0, y: 0, width: -1, height: 30 })).toThrow()
        expect(scene.scene).toBe(valid)
        expect(scene.getWorldBounds('a')).toEqual({ x: 10, y: 20, width: 50, height: 40 })
        expect(view.destroy).not.toHaveBeenCalled()
        scene.destroy()
    })

    it('keeps prior geometry when a registered measurement fails', () => {
        const { scene, mounted } = fixture()
        scene.setScene(snapshot([node('a')]))
        const measure = vi.spyOn(geometry, 'measure').mockImplementation(() => {
            throw new Error('measurement failed')
        })
        expect(() => scene.setScene(snapshot([node('b')]))).toThrow('measurement failed')
        expect(scene.scene.nodes[0].nodeId).toBe('a')
        expect(mounted.get('a')!.view.destroy).not.toHaveBeenCalled()
        measure.mockRestore()
        scene.destroy()
    })

    it('reports an unknown type while keeping its diagnostic shell and geometry', () => {
        const { scene, onError } = fixture()
        scene.setScene(snapshot([{ ...node('a'), type: 'external-kind' }]))
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: expect.objectContaining({ code: 'unknown-node-type', nodeId: 'a' }) }), 'a')
        expect(scene.getNodeView('a')).toBeDefined()
        expect(scene.getWorldBounds('a')?.width).toBe(50)
        scene.destroy()
    })

    it('presents parent-relative geometry and culled nodes through the same registration', () => {
        const { scene, mounted, root } = fixture()
        scene.setScene(snapshot([node('parent', { x: 100, y: 100 }), node('child', { x: 20, y: 30 }, 'parent'), node('far', { x: 900, y: 0 })]))
        const child = mounted.get('child')!
        expect(child.view.setGeometry).toHaveBeenLastCalledWith({ x: 120, y: 130, width: 50, height: 40 }, { x: 0, y: 0, zoom: 1 })
        expect(child.context.contentRoot.style.left).toBe('120px')
        expect(mounted.get('far')!.view.setVisible).toHaveBeenLastCalledWith(false)
        scene.setLiveBounds('parent', { x: 200, y: 150, width: 100, height: 80 })
        expect(scene.getWorldBounds('child')).toEqual({ x: 220, y: 180, width: 50, height: 40 })
        scene.setViewport({ x: -850, y: 0, zoom: 1 })
        expect(mounted.get('far')!.view.setVisible).toHaveBeenLastCalledWith(true)
        expect(child.view.setVisible).toHaveBeenLastCalledWith(false)
        scene.setSelected(new Set(['far']))
        expect(mounted.get('far')!.view.setSelected).toHaveBeenLastCalledWith(true)
        scene.destroy()
        expect(root.children).toHaveLength(0)
    })

    it('ends subscriptions, overlays and abort signals when the scene replaces a node', () => {
        const { scene, mounted } = fixture()
        scene.setScene(snapshot([node('a')]))
        const context = mounted.get('a')!.context
        const scenes = vi.fn()
        const views = vi.fn()
        context.subscribeScene(scenes)
        context.subscribeView(views)
        const overlay = document.createElement('div')
        context.mountOverlay(overlay, 'screen')
        expect(scenes).toHaveBeenCalledOnce()
        expect(views).toHaveBeenCalledOnce()
        expect(overlay.isConnected).toBe(true)
        scene.setScene(snapshot([node('a')], 'replacement'))
        expect(context.signal.aborted).toBe(true)
        expect(context.contentRoot.isConnected).toBe(false)
        expect(overlay.isConnected).toBe(false)
        scene.setViewport({ x: 20, y: 0, zoom: 2 })
        expect(views).toHaveBeenCalledOnce()
        expect(scenes).toHaveBeenCalledOnce()
        expect(mounted.get('a')!.context.signal.aborted).toBe(false)
        scene.destroy()
    })

    it('cleans up partial component mounts without affecting another canvas', () => {
        const overlay = document.createElement('div')
        const listener = vi.fn()
        const broken = fixture((_node, context) => {
            context.subscribeView(listener)
            context.mountOverlay(overlay, 'screen')
            throw new Error('broken component')
        })
        const other = fixture()
        broken.scene.setScene(snapshot([node('bad')]))
        other.scene.setScene(snapshot([node('good')]))
        expect(broken.onError).toHaveBeenCalledWith(expect.any(Error), 'bad')
        expect(overlay.isConnected).toBe(false)
        broken.scene.setViewport({ x: 10, y: 10, zoom: 1 })
        expect(listener).toHaveBeenCalledOnce()
        broken.renderer.scopes[0].abort()
        expect(broken.root.children).toHaveLength(0)
        expect(other.mounted.get('good')!.context.signal.aborted).toBe(false)
        other.scene.destroy()
    })

    it('preserves the mounted scene after invalid input and shows unknown component types', () => {
        const { scene, mounted, root } = fixture()
        scene.setScene(snapshot([node('good')]))
        const first = mounted.get('good')!
        expect(() => scene.setScene(snapshot([node('same'), node('same')], 'invalid'))).toThrow('unique')
        expect(scene.scene.sceneKey).toBe('one')
        expect(first.context.signal.aborted).toBe(false)
        expect(() => scene.setViewport({ x: 0, y: 0, zoom: 0 })).toThrow('positive zoom')
        scene.setScene(snapshot([{ ...node('unknown'), type: 'custom-widget' }]))
        expect(root.textContent).toBe('Unknown node type: custom-widget')
        scene.destroy()
    })
})
