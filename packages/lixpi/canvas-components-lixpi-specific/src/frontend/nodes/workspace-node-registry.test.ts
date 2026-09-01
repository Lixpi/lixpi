// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasNode,
} from '@lixpi/constants'
import {
    type EngineNode,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasRenderer,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    NodeRegistry,
    CanvasScene,
    type NodeView,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspaceMediaNodes,
} from '../media/workspace-media-nodes.ts'
import {
    WorkspaceNodeRegistry,
    type WorkspaceDomNodeView,
    type WorkspaceRegisteredNodeData,
} from './workspace-node-registry.ts'

const owners: CanvasScene[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

const geometry: NodeGeometryPolicy<WorkspaceRegisteredNodeData> = {
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: bounds, collisionBounds: bounds, connectorBounds: bounds }
    },
    movable: true,
    resize: { min: { width: 1, height: 1 }, preserveAspectRatio: false },
}

function node(type: CanvasNode['type'], nodeId: string = type): CanvasNode {
    return { type, nodeId, assetId: nodeId, parentId: 'parent', position: { x: 10, y: 20 }, dimensions: { width: 100, height: 80 } } as CanvasNode
}

function fixture(failDom = false) {
    const mediaRegistry = new NodeRegistry()
    const mediaViews: NodeView[] = []
    for (const type of ['image', 'video', 'audio', 'mediaDocument']) {
        mediaRegistry.register({
            type,
            geometry,
            mount: () => {
                const view = { update: vi.fn(), setGeometry: vi.fn(), setSelected: vi.fn(), setVisible: vi.fn(), prefetch: vi.fn(async () => {}), destroy: vi.fn() }
                mediaViews.push(view)
                return view
            },
        })
    }
    const project: WorkspaceMediaNodes['project'] = (node, framePending = false) => ({ nodeId: node.nodeId, type: node.type, parentId: node.parentId, position: node.position, dimensions: node.dimensions, ports: [], data: { node, media: null, framePending } })
    const domViews: WorkspaceDomNodeView[] = []
    const roots: HTMLElement[] = []
    const registry = new WorkspaceNodeRegistry({
        media: { registry: mediaRegistry, project },
        geometry: () => geometry,
        mountDom: (_node, context) => {
            roots.push(context.contentRoot)
            if (failDom) throw new Error('DOM failed')
            const element = document.createElement('section')
            element.style.left = '500px'
            element.style.top = '600px'
            const view = { element, update: vi.fn(), setGeometry: vi.fn(), setSelected: vi.fn(), setVisible: vi.fn(), destroy: vi.fn() }
            domViews.push(view)
            return view
        },
    })
    const onError = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const renderer = {
        setViewport: vi.fn(),
        createScope: () => {
            const controller = new AbortController()
            return { signal: controller.signal, resources: {}, media: {}, layers: {}, requestFrame: vi.fn(), invalidate: vi.fn(), destroy: () => controller.abort() }
        },
    } as unknown as CanvasRenderer
    const views = new CanvasScene({ registry: registry.registry, renderer, root, onError })
    owners.push(views)
    const sync = (nodes: CanvasNode[], sceneKey = 'scene') => {
        views.setViewport({ x: 4, y: 5, zoom: 2 }, { width: 1, height: 1 })
        views.setScene({ sceneKey, revision: '1', edges: [], nodes: nodes.map(node => ({ ...registry.project(node), parentId: undefined, position: { x: 510, y: 620 } })) })
        views.setSelected(new Set(nodes.map(node => node.nodeId)))
    }
    return { views, registry, roots, onError, mediaViews, domViews, sync }
}

describe('WorkspaceNodeRegistry', () => {
    it('registers every canvas node kind and keeps media and DOM geometry in their respective coordinate spaces', () => {
        const test = fixture()
        const types: CanvasNode['type'][] = ['document', 'image', 'video', 'audio', 'mediaDocument', 'operationStatus', 'branchOrigin', 'branchFork', 'branchLine', 'capabilityArtifact']
        test.sync(types.map(type => node(type)))
        expect(test.onError).not.toHaveBeenCalled()
        expect(test.domViews).toHaveLength(10)
        expect(test.mediaViews).toHaveLength(4)
        for (const dom of test.domViews) {
            expect(dom.element.style.left).toBe('0px')
            expect(dom.element.style.top).toBe('0px')
            expect(dom.setGeometry).toHaveBeenCalledWith({ x: 0, y: 0, width: 100, height: 80 }, { x: 4, y: 5, zoom: 2 })
            expect(dom.element.classList.contains('is-selected')).toBe(true)
            expect(dom.setVisible).toHaveBeenCalledWith(false)
        }
        for (const media of test.mediaViews) expect(media.setGeometry).toHaveBeenCalledWith({ x: 510, y: 620, width: 100, height: 80 }, { x: 4, y: 5, zoom: 2 })
        const projected = test.registry.project(node('video'), true)
        expect(projected.parentId).toBe('parent')
        expect(projected.data.framePending).toBe(true)
    })

    it('updates content without remounting and releases media and DOM together on type or scene replacement', () => {
        const test = fixture()
        const initial = node('video', 'same')
        test.sync([initial])
        test.sync([initial])
        expect(test.domViews[0]!.update).not.toHaveBeenCalled()
        const updated = { ...initial, assetId: 'replacement' } as CanvasNode
        test.sync([updated])
        expect(test.domViews[0]!.update).toHaveBeenCalledExactlyOnceWith(updated)
        expect(test.mediaViews[0]!.update).toHaveBeenCalledTimes(2)
        test.sync([node('document', 'same')])
        expect(test.mediaViews[0]!.destroy).toHaveBeenCalledOnce()
        expect(test.domViews[0]!.destroy).toHaveBeenCalledOnce()
        test.sync([node('document', 'same')], 'next-workspace')
        expect(test.domViews[1]!.destroy).toHaveBeenCalledOnce()
        expect(test.domViews[2]!.element.isConnected).toBe(true)
    })

    it('cleans the already-mounted media when DOM mounting fails', () => {
        const test = fixture(true)
        test.sync([node('video')])
        expect(test.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'DOM failed' }), 'video')
        expect(test.mediaViews[0]!.destroy).toHaveBeenCalledOnce()
        expect(test.roots[0]!.isConnected).toBe(false)
        expect(test.views.getNodeView('video')).toBeUndefined()
    })

    it('keeps two canvases with identical IDs independent', async () => {
        const a = fixture(), b = fixture()
        a.sync([node('image')])
        b.sync([node('image')])
        const first = a.views.getNodeView('image')!
        await first.prefetch?.()
        a.views.destroy()
        first.update(a.registry.project(node('image')) as EngineNode<WorkspaceRegisteredNodeData>)
        expect(a.mediaViews[0]!.prefetch).toHaveBeenCalledOnce()
        expect(a.mediaViews[0]!.update).not.toHaveBeenCalled()
        expect(a.domViews[0]!.element.isConnected).toBe(false)
        expect(b.domViews[0]!.element.isConnected).toBe(true)
        expect(b.mediaViews[0]!.destroy).not.toHaveBeenCalled()
    })
})
