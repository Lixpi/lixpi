import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    EngineNode,
    NodeGeometryPolicy,
} from '../../shared/index.ts'
import {
    NodeRegistry,
    type ComponentContext,
    type NodeView,
} from './node-registry.ts'
import {
    NodeViews,
    type NodeMountScope,
    type NodePresentation,
} from './node-views.ts'

function node(nodeId = 'one', type = 'card', label = 'First'): EngineNode<{ label: string }> {
    return { nodeId, type, data: { label }, position: { x: 10, y: 20 }, dimensions: { width: 100, height: 50 }, ports: [] }
}

function view(): NodeView {
    return { update: vi.fn(), setGeometry: vi.fn(), setSelected: vi.fn(), setVisible: vi.fn(), destroy: vi.fn() }
}

const geometry: NodeGeometryPolicy = {
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
    },
    movable: true,
    resize: { min: { width: 1, height: 1 }, preserveAspectRatio: false },
}

function presentation(node: EngineNode): NodePresentation {
    return { worldBounds: { ...node.position, ...node.dimensions }, viewport: { x: 0, y: 0, zoom: 1 }, selected: false, visible: true }
}

function fixture() {
    const registry = new NodeRegistry()
    const scopes: NodeMountScope[] = []
    const createScope = vi.fn(() => {
        const controller = new AbortController()
        const scope = { context: { signal: controller.signal } as ComponentContext, destroy: vi.fn(() => controller.abort()) }
        scopes.push(scope)
        return scope
    })
    const mountUnknown = vi.fn(() => view())
    const onError = vi.fn()
    const views = new NodeViews({ registry, createScope, mountUnknown, onError })
    return { views, registry, scopes, mountUnknown, onError }
}

describe('NodeViews', () => {
    it('keeps a mounted view through data updates and scopes node and scene removal', () => {
        const { views, registry, scopes } = fixture()
        const mount = vi.fn(() => view())
        registry.register({ type: 'card', geometry, mount })
        views.sync({ sceneKey: 'a', nodes: [node()], presentation })
        const first = views.get('one')!
        views.sync({ sceneKey: 'a', nodes: [node('one', 'card', 'Updated')], presentation })
        expect(mount).toHaveBeenCalledOnce()
        expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ data: { label: 'Updated' } }))
        views.sync({ sceneKey: 'b', nodes: [node()], presentation })
        expect(first.destroy).toHaveBeenCalledOnce()
        expect(scopes[0].context.signal.aborted).toBe(true)
        expect(views.get('one')).not.toBe(first)
        views.destroy()
        views.destroy()
        expect(scopes[1].destroy).toHaveBeenCalledOnce()
    })

    it('remounts changed types and supplies unknown types to the diagnostic view', () => {
        const { views, registry, mountUnknown, scopes } = fixture()
        registry.register({ type: 'card', geometry, mount: () => view() })
        views.sync({ sceneKey: 'a', nodes: [node()], presentation })
        const first = views.get('one')!
        views.sync({ sceneKey: 'a', nodes: [node('one', 'custom')], presentation })
        expect(first.destroy).toHaveBeenCalledOnce()
        expect(mountUnknown).toHaveBeenCalledWith(expect.objectContaining({ type: 'custom' }), scopes[1].context)
        views.destroy()
    })

    it('disposes partial mounts and keeps sibling components running', () => {
        const { views, registry, scopes, onError } = fixture()
        const failure = new Error('Mount failed')
        registry.register({
            type: 'broken',
            geometry,
            mount: () => {
                throw failure
            },
        })
        registry.register({ type: 'card', geometry, mount: () => view() })
        views.sync({ sceneKey: 'a', nodes: [node('broken', 'broken'), node('sibling')], presentation })
        expect(scopes[0].destroy).toHaveBeenCalledOnce()
        expect(onError).toHaveBeenCalledExactlyOnceWith(failure, 'broken')
        expect(views.get('sibling')).toBeDefined()
        expect(views.get('broken')).toBeUndefined()
        views.destroy()
    })

    it('finishes scope cleanup even when a component destructor fails', () => {
        const { views, registry, scopes, onError } = fixture()
        const failure = new Error('Destroy failed')
        registry.register({
            type: 'card',
            geometry,
            mount: () => ({
                ...view(),
                destroy: () => {
                    throw failure
                },
            }),
        })
        views.sync({ sceneKey: 'a', nodes: [node('one'), node('two')], presentation })
        views.destroy()
        expect(scopes.every(scope => scope.context.signal.aborted)).toBe(true)
        expect(onError).toHaveBeenCalledTimes(2)
    })

    it('rejects duplicate IDs without mutating the mounted scene', () => {
        const { views, registry } = fixture()
        registry.register({ type: 'card', geometry, mount: () => view() })
        views.sync({ sceneKey: 'a', nodes: [node()], presentation })
        const first = views.get('one')!
        expect(() => views.sync({ sceneKey: 'b', nodes: [node(), node()], presentation })).toThrow('Duplicate node ID')
        expect(views.get('one')).toBe(first)
        expect(first.destroy).not.toHaveBeenCalled()
        views.destroy()
    })

    it('queues scene updates requested during a mount and does not retain the old scope', () => {
        const { views, registry, scopes } = fixture()
        registry.register({
            type: 'card',
            geometry,
            mount: () => {
                views.sync({ sceneKey: 'b', nodes: [], presentation })
                return view()
            },
        })
        views.sync({ sceneKey: 'a', nodes: [node()], presentation })
        expect(views.get('one')).toBeUndefined()
        expect(scopes[0].destroy).toHaveBeenCalledOnce()
        views.destroy()
    })

    it('stops presentation callbacks after the view removes itself', () => {
        const { views, registry } = fixture()
        const mounted = view()
        mounted.setGeometry = () => views.remove('one')
        registry.register({ type: 'card', geometry, mount: () => mounted })
        views.sync({ sceneKey: 'a', nodes: [node()], presentation })
        expect(mounted.destroy).toHaveBeenCalledOnce()
        expect(mounted.setSelected).not.toHaveBeenCalled()
        expect(mounted.setVisible).not.toHaveBeenCalled()
        views.destroy()
    })
})
