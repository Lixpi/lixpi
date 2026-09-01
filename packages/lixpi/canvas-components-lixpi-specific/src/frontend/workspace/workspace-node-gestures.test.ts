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
    type CanvasState,
    type ImageCanvasNode,
} from '@lixpi/constants'
import {
    computeWorldPosition,
    type CanvasEngineRect as Rect,
} from '@lixpi/canvas-engine/shared'
import {
    type NodeTransformOptions,
    type NodeResizeOptions,
} from '@lixpi/canvas-engine/frontend/runtime'
import { WorkspaceGeometry } from '../../shared/branch-tree-layout/workspace-geometry.ts'
import { createLixpiCanvasSettings } from '../settings/canvas-settings.ts'
import {
    WorkspaceNodeGestures,
    type WorkspaceNodeGesturesPorts,
} from './workspace-node-gestures.ts'

function image(nodeId = 'image', overrides: Partial<ImageCanvasNode> = {}): ImageCanvasNode {
    return { nodeId, type: 'image', assetId: nodeId, position: { x: 20, y: 30 }, dimensions: { width: 200, height: 100 }, ...overrides }
}
const owners: WorkspaceNodeGestures[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
})

function setup(nodes: CanvasNode[] = [image()]) {
    const pane = document.createElement('div')
    const elements = new Map(nodes.map(node => [node.nodeId, document.createElement('div')]))
    const bounds = new Map<string, Rect>(nodes.map(node => [node.nodeId, { ...computeWorldPosition(node, new Map(nodes.map(item => [item.nodeId, item]))), ...node.dimensions }]))
    let state: CanvasState | null = { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    let sceneKey = 'scene'
    let workspaceId = 'workspace'
    const selected = new Set<string>()
    const timers: Array<{ callback: () => void; cancel: ReturnType<typeof vi.fn> }> = []
    const drags: NodeTransformOptions[] = []
    const resizes: NodeResizeOptions[] = []
    const unlock = vi.fn()
    const settings = createLixpiCanvasSettings()
    const geometry = new WorkspaceGeometry({
        workspaceId,
        settings,
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getPaneSize: () => ({ width: 1000, height: 800 }),
        getWorldPosition: computeWorldPosition,
        getWorldRect: (node, byId) => ({ ...computeWorldPosition(node, byId), ...node.dimensions }),
        getLiveDimensions: nodeId => bounds.get(nodeId),
        isPending: () => false,
    })
    const connections = { checkProximity: vi.fn(), commitProximityConnection: vi.fn(), cancelTransientConnection: vi.fn() }
    const media: NonNullable<ReturnType<WorkspaceNodeGesturesPorts['media']>> = {
        getNodeBounds: nodeId => bounds.get(nodeId),
        setNodeLiveTransform: vi.fn((nodeId, position, dimensions) => {
            bounds.set(nodeId, { ...position, ...dimensions })
        }),
        setSelectedImageNodes: vi.fn(),
        setSelectionOverlayBounds: vi.fn(),
    }
    const ports: WorkspaceNodeGesturesPorts = {
        pane,
        readScope: () => ({ workspaceId, sceneKey }),
        readState: () => state,
        runtime: {
            cancelInteraction: vi.fn(),
            startNodeDrag: vi.fn(options => {
                drags.push(options)
            }),
            startNodeResize: vi.fn(options => {
                resizes.push(options)
            }),
        },
        findElement: nodeId => elements.get(nodeId) ?? null,
        media: () => media,
        connections: () => connections,
        geometry,
        collisionSettings: settings.workspaceCollision.dragRelease,
        selectedNodeIds: () => selected,
        isSelected: nodeId => selected.has(nodeId),
        select: vi.fn(nodeId => {
            selected.clear()
            selected.add(nodeId)
        }),
        toggleSelection: vi.fn(nodeId => {
            if (selected.has(nodeId)) selected.delete(nodeId)
            else selected.add(nodeId)
        }),
        bringToFront: vi.fn(),
        lockPan: vi.fn(() => unlock),
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        updateChromeTransform: vi.fn(),
        updateChromeLayout: vi.fn(),
        scheduleEdges: vi.fn(),
        cancelEdges: vi.fn(),
        repositionMenu: vi.fn(),
        updateSelectionOverlay: vi.fn(),
        getSelectionBounds: () => null,
        shouldFillSelectionBounds: () => false,
        syncNodeGeometry: vi.fn(),
        syncMedia: vi.fn(),
        rememberManualMarker: vi.fn(),
        commit: vi.fn(next => {
            state = next
        }),
        setTimer: callback => {
            const cancel = vi.fn()
            timers.push({ callback, cancel })
            return cancel
        },
    }
    const owner = new WorkspaceNodeGestures(ports)
    owners.push(owner)
    const event = () => new MouseEvent('mousedown', { bubbles: true })
    return {
        owner,
        ports,
        media,
        connections,
        elements,
        pane,
        bounds,
        selected,
        timers,
        drags,
        resizes,
        geometry,
        unlock,
        event,
        setScene: (value: string) => {
            sceneKey = value
        },
        setWorkspace: (value: string) => {
            workspaceId = value
        },
        setState: (value: CanvasState | null) => {
            state = value
        },
        get state() {
            return state
        },
    }
}

describe('WorkspaceNodeGestures', () => {
    it('defers selection until a gesture starts and treats an unmoved release as a click', () => {
        const fixture = setup()
        const clicked = vi.fn()
        const collision = vi.spyOn(fixture.geometry, 'createCollisionPlan')
        fixture.owner.startDrag(fixture.event(), 'image', { onClick: clicked, suppressPaneClick: true })
        expect(fixture.ports.select).not.toHaveBeenCalled()
        expect(fixture.drags[0].threshold).toBe(6)
        fixture.drags[0].onEnd(fixture.event(), fixture.bounds, false)
        expect(fixture.ports.select).toHaveBeenCalledWith('image')
        expect(clicked).toHaveBeenCalledOnce()
        expect(collision).not.toHaveBeenCalled()
        expect(fixture.ports.commit).not.toHaveBeenCalled()
        expect(fixture.owner.consumeNodeClick()).toBe(true)
        expect(fixture.owner.consumeNodeClick()).toBe(false)
        expect(fixture.owner.consumePaneClick()).toBe(true)
        expect(fixture.unlock).toHaveBeenCalledOnce()
    })

    it('toggles modified selection without starting a drag or changing geometry', () => {
        const fixture = setup()
        fixture.owner.startDrag(new MouseEvent('mousedown', { ctrlKey: true }), 'image')
        expect(fixture.selected.has('image')).toBe(true)
        expect(fixture.drags).toHaveLength(0)
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })

    it('keeps a selected media group rigid and suppresses the following click', () => {
        const fixture = setup([image('first'), image('second', { position: { x: 420, y: 30 } })])
        fixture.selected.add('first')
        fixture.selected.add('second')
        const collision = vi.spyOn(fixture.geometry, 'createCollisionPlan')
        fixture.owner.startDrag(fixture.event(), 'first')
        expect(fixture.drags[0].targets.map(target => target.nodeId)).toEqual(['first', 'second'])
        fixture.drags[0].onStart?.()
        const moved = new Map([['first', { x: 70, y: 50, width: 200, height: 100 }], ['second', { x: 470, y: 50, width: 200, height: 100 }]])
        fixture.drags[0].onChange(moved)
        fixture.drags[0].onEnd(fixture.event(), moved, true)
        expect(collision).not.toHaveBeenCalled()
        expect(fixture.state!.nodes.map(node => node.position)).toEqual([{ x: 70, y: 50 }, { x: 470, y: 50 }])
        expect(fixture.ports.select).not.toHaveBeenCalled()
        expect(fixture.owner.consumeNodeClick()).toBe(true)
    })

    it('moves a selected parent and child together while retaining child-local coordinates', () => {
        const parent = image('parent', { dimensions: { width: 400, height: 300 } })
        const child = image('child', { parentId: 'parent', position: { x: 30, y: 40 } })
        const fixture = setup([parent, child])
        fixture.selected.add('parent')
        fixture.selected.add('child')
        fixture.owner.startDrag(fixture.event(), 'parent')
        expect(fixture.drags[0].targets.map(target => target.nodeId)).toEqual(['parent', 'child'])
        fixture.drags[0].onStart?.()
        const moved = new Map([['parent', { x: 120, y: 130, width: 400, height: 300 }], ['child', { x: 150, y: 170, width: 200, height: 100 }]])
        fixture.drags[0].onChange(moved)
        fixture.drags[0].onEnd(fixture.event(), moved, true)
        expect(fixture.state!.nodes[0].position).toEqual({ x: 120, y: 130 })
        expect(fixture.state!.nodes[1].position).toEqual(child.position)
        expect(fixture.state!.nodes[1].parentId).toBe('parent')
        expect(fixture.connections.checkProximity).toHaveBeenCalledOnce()
        expect(fixture.connections.commitProximityConnection).toHaveBeenCalledOnce()
    })

    it('remembers manually moved branch-marker geometry', () => {
        const marker: CanvasNode = { nodeId: 'marker', type: 'branchOrigin', branchId: 'branch', generationRequestId: 'request', temporary: true, position: { x: 0, y: 0 }, dimensions: { width: 150, height: 90 } }
        const fixture = setup([marker])
        fixture.owner.startDrag(fixture.event(), marker.nodeId)
        fixture.drags[0].onStart?.()
        const moved = new Map([['marker', { x: 40, y: 60, width: 150, height: 90 }]])
        fixture.drags[0].onChange(moved)
        fixture.drags[0].onEnd(fixture.event(), moved, true)
        expect(fixture.ports.rememberManualMarker).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'marker', position: { x: 40, y: 60 } }), expect.any(Object))
    })

    it('locks image aspect ratio and persists resized child coordinates relative to its parent', () => {
        const fixture = setup([image('parent', { dimensions: { width: 500, height: 400 } }), image('child', { parentId: 'parent', position: { x: 30, y: 40 } })])
        fixture.owner.startResize(fixture.event(), 'child', 'bottom-right')
        expect(fixture.resizes[0].constraints).toEqual({ min: { width: 50, height: 25 }, preserveAspectRatio: true, aspectRatio: 2 })
        const moved = new Map([['child', { x: 50, y: 70, width: 300, height: 150 }]])
        fixture.resizes[0].onChange(moved)
        fixture.resizes[0].onEnd(fixture.event(), moved, true)
        expect(fixture.state!.nodes[1]).toMatchObject({ parentId: 'parent', position: { x: 30, y: 40 }, dimensions: { width: 300, height: 150 } })
        expect(fixture.owner.resizingNodeId).toBeNull()
    })

    it.each(['workspace', 'scene', 'state'] as const)('rejects a drag release after %s replacement', kind => {
        const fixture = setup()
        fixture.owner.startDrag(fixture.event(), 'image')
        fixture.drags[0].onStart?.()
        if (kind === 'workspace') fixture.setWorkspace('other')
        if (kind === 'scene') fixture.setScene('other')
        if (kind === 'state') fixture.setState(null)
        fixture.drags[0].onEnd(fixture.event(), fixture.bounds, true)
        expect(fixture.ports.commit).not.toHaveBeenCalled()
        fixture.owner.clear()
        expect(fixture.elements.get('image')!.classList.contains('is-dragging')).toBe(false)
        expect(fixture.pane.classList.contains('nopan')).toBe(false)
    })

    it('stops release after proximity commit navigates to another scene', () => {
        const fixture = setup()
        fixture.connections.commitProximityConnection.mockImplementation(() => fixture.setScene('replacement'))
        fixture.owner.startDrag(fixture.event(), 'image')
        fixture.drags[0].onEnd(fixture.event(), fixture.bounds, true)
        expect(fixture.ports.commit).not.toHaveBeenCalled()
        expect(fixture.timers).toHaveLength(0)
    })

    it('stops a resize update when a chrome callback replaces the scene', () => {
        const fixture = setup()
        fixture.ports.updateChromeTransform = () => fixture.setScene('replacement')
        fixture.owner.startResize(fixture.event(), 'image', 'bottom-right')
        fixture.resizes[0].onChange(new Map([['image', { x: 10, y: 20, width: 400, height: 200 }]]))
        expect(fixture.media.setSelectedImageNodes).not.toHaveBeenCalled()
        expect(fixture.media.setSelectionOverlayBounds).not.toHaveBeenCalled()
        expect(fixture.ports.scheduleEdges).not.toHaveBeenCalled()
        fixture.resizes[0].onEnd(fixture.event(), fixture.bounds, true)
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })

    it('ignores obsolete gesture callbacks after another gesture starts on the same node', () => {
        const fixture = setup()
        fixture.owner.startDrag(fixture.event(), 'image')
        const obsolete = fixture.drags[0]
        obsolete.onStart?.()
        fixture.owner.startResize(fixture.event(), 'image', 'bottom-right')
        obsolete.onChange(new Map([['image', { x: 900, y: 900, width: 1, height: 1 }]]))
        obsolete.onCancel('escape')
        expect(fixture.owner.resizingNodeId).toBe('image')
        expect(fixture.elements.get('image')!.classList.contains('is-resizing')).toBe(true)
        expect(fixture.media.setNodeLiveTransform).not.toHaveBeenCalled()
    })

    it('cleans up failed engine allocation without retaining locks or dragging classes', () => {
        const fixture = setup()
        fixture.ports.runtime.startNodeDrag = options => {
            options.onStart?.()
            throw new Error('allocation')
        }
        expect(() => fixture.owner.startDrag(fixture.event(), 'image')).toThrow('allocation')
        expect(fixture.unlock).toHaveBeenCalledOnce()
        expect(fixture.owner.draggingNodeId).toBeNull()
        expect(fixture.elements.get('image')!.classList.contains('is-dragging')).toBe(false)
        expect(fixture.pane.classList.contains('nopan')).toBe(false)
    })

    it('cancels suppression timers and stays closed even when engine cancellation fails', () => {
        const fixture = setup()
        fixture.owner.startDrag(fixture.event(), 'image', { onClick: vi.fn() })
        fixture.drags[0].onEnd(fixture.event(), fixture.bounds, false)
        fixture.ports.runtime.cancelInteraction = () => {
            throw new Error('cancel')
        }
        expect(() => fixture.owner.destroy()).toThrow(AggregateError)
        expect(fixture.timers[0].cancel).toHaveBeenCalledOnce()
        fixture.timers[0].callback()
        fixture.owner.startDrag(fixture.event(), 'image')
        fixture.owner.startResize(fixture.event(), 'image', 'bottom-right')
        expect(fixture.drags).toHaveLength(1)
        expect(fixture.resizes).toHaveLength(0)
    })

    it('keeps independent canvas locks, selection and gestures', () => {
        const first = setup()
        const second = setup()
        first.owner.startDrag(first.event(), 'image')
        second.owner.startDrag(second.event(), 'image')
        first.owner.destroy()
        second.drags[0].onStart?.()
        expect(second.owner.draggingNodeId).toBe('image')
        expect(second.unlock).not.toHaveBeenCalled()
        expect(second.pane.classList.contains('nopan')).toBe(true)
    })
})
