// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ConnectionManager } from './connection-manager.ts'
import type {
    ConnectionManagerConfig,
    ConnectionNode,
    ConnectionEdge,
} from './connection-types.ts'
import { flattenSvgPath } from '@lixpi/ui-primitives/svg'

const nodes: ConnectionNode[] = [
    { nodeId: 'a', position: { x: 100, y: 100 }, dimensions: { width: 100, height: 100 } },
    { nodeId: 'b', position: { x: 400, y: 100 }, dimensions: { width: 100, height: 100 } },
]
const existingEdge: ConnectionEdge = { edgeId: 'ab', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: 'right', targetHandle: 'left' }
const managers: ConnectionManager[] = []
const frames = new Map<number, FrameRequestCallback>()

function setup(left = 0, overrides: Partial<ConnectionManagerConfig<ConnectionNode>> = {}) {
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    paneEl.append(viewportEl)
    document.body.append(paneEl)
    vi.spyOn(paneEl, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, 0, 700, 500))
    const onEdgesChange = vi.fn()
    const onConnectorGeometry = vi.fn()
    const panBy = vi.fn(async () => true)
    const config: ConnectionManagerConfig<ConnectionNode> = {
        paneEl,
        viewportEl,
        getTransform: () => [0, 0, 1],
        panBy,
        onEdgesChange,
        onConnectorGeometry,
        onError: vi.fn(),
        markerBodyLengthFraction: 0.7,
        isCentered: () => false,
        settings: {
            lineCurve: 'straight',
            useZoomCompensatedScaling: false,
            scaling: { strokeWidth: 2, markerSize: 12, markerOffset: { source: 5, target: 5 }, clickAreaWidth: 12, zoomScaling: { minZoom: 0.1 } },
            proximityConnectThreshold: 40,
            menuConnectionSnapRadius: 30,
            autoAlign: { minSlideHeight: 60, edgeMargin: 0.1 },
            styles: { lineDefaultColor: '#000000', lineFocusColor: '#ffffff' },
        },
        ...overrides,
    }
    const manager = new ConnectionManager(config)
    managers.push(manager)
    manager.syncNodes(nodes)
    const start = (reconnecting = false) =>
        manager.onHandlePointerDown(new MouseEvent('mousedown', { clientX: left + 205, clientY: 155 }), {
            nodeId: 'a',
            handleId: 'right',
            isTarget: false,
            handleDomNode: viewportEl,
            ...(reconnecting ? { reconnectingEdgeId: 'ab', edgeUpdaterType: 'target' as const } : {}),
        })
    return { manager, config, paneEl, start, onEdgesChange, onConnectorGeometry, panBy }
}

function move(x: number, y = 155) {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
}
function release(x: number, y = 155) {
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }))
}

beforeEach(() => {
    let id = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        frames.set(++id, callback)
        return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
        frames.delete(id)
    })
})

afterEach(() => {
    for (const manager of managers.splice(0)) manager.destroy()
    document.body.replaceChildren()
    frames.clear()
    vi.restoreAllMocks()
})

describe('ConnectionManager gesture ownership', () => {
    it('reports auto-pan failure through its owner and cancels only that connection', async () => {
        const first = setup()
        const second = setup(800)
        const error = new Error('pan failed')
        first.panBy.mockRejectedValue(error)
        first.start()
        move(695)
        for (const [id, callback] of Array.from(frames)) {
            frames.delete(id)
            callback(0)
        }
        await vi.waitFor(() => expect(first.config.onError).toHaveBeenCalledExactlyOnceWith(error))
        release(405)
        expect(first.onEdgesChange).not.toHaveBeenCalled()
        expect(second.config.onError).not.toHaveBeenCalled()
        expect(frames.size).toBe(0)
    })

    it('renders separate named ports on all four sides and preserves input/output direction', () => {
        const { manager, onEdgesChange, onConnectorGeometry, paneEl } = setup()
        const first: ConnectionNode = {
            ...nodes[0],
            ports: [
                { id: 'north', role: 'output', direction: 'top', anchor: { x: 20, y: 0 } },
                { id: 'south', role: 'output', direction: 'bottom', anchor: { x: 75, y: 100 } },
            ],
        }
        const second: ConnectionNode = {
            ...nodes[1],
            ports: [
                { id: 'west', role: 'input', direction: 'left', anchor: { x: 0, y: 25 } },
                { id: 'east', role: 'input', direction: 'right', anchor: { x: 100, y: 80 } },
            ],
        }
        manager.syncNodes([first, second])
        manager.syncEdges([
            { ...existingEdge, edgeId: 'nw', sourceHandle: 'north', targetHandle: 'west' },
            { ...existingEdge, edgeId: 'se', sourceHandle: 'south', targetHandle: 'east' },
        ])
        manager.render()
        const rendered = onConnectorGeometry.mock.lastCall![0]
        expect(flattenSvgPath(rendered[0].svgPath)[0]).toEqual({ x: 120, y: 95 })
        expect(flattenSvgPath(rendered[1].svgPath)[0]).toEqual({ x: 175, y: 205 })
        expect(rendered[0].arrowEnd.y).toBe(125)
        expect(rendered[1].arrowEnd.y).toBe(180)
        manager.syncEdges([])
        manager.onHandlePointerDown(new MouseEvent('mousedown', { clientX: 400, clientY: 125 }), { nodeId: 'b', handleId: 'west', isTarget: true, handleDomNode: paneEl })
        move(120, 100)
        release(120, 100)
        expect(onEdgesChange).toHaveBeenCalledWith([expect.objectContaining({ sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: 'north', targetHandle: 'west' })])
    })

    it.each([0.8, null, NaN])('respects a content anchor of %s when nodes expose named ports', contentT => {
        const { manager, onConnectorGeometry } = setup(0, { sourceAnchorT: () => contentT })
        manager.syncNodes([
            { ...nodes[0], ports: [{ id: 'message', role: 'output', direction: 'right', anchor: { x: 100, y: 25 } }] },
            { ...nodes[1], ports: [{ id: 'input', role: 'input', direction: 'left', anchor: { x: 0, y: 25 } }] },
        ])
        manager.syncEdges([{ ...existingEdge, sourceHandle: 'message', targetHandle: 'input' }])
        manager.render()
        const rendered = onConnectorGeometry.mock.lastCall![0][0]
        const y = contentT === 0.8 ? 180 : 125
        expect(flattenSvgPath(rendered.svgPath)[0]).toEqual({ x: 205, y })
        expect(rendered.arrowEnd.y).toBe(y)
    })

    it.each(
        [
            ['left', { x: 0, y: 25 }, { x: 195, y: 310 }],
            ['right', { x: 100, y: 75 }, { x: 245, y: 330 }],
            ['top', { x: 25, y: 0 }, { x: 210, y: 295 }],
            ['bottom', { x: 75, y: 100 }, { x: 230, y: 345 }],
        ] as const,
    )('preserves a named %s port when a policy renders the source on an additional surface', (direction, anchor, expected) => {
        const { manager, onConnectorGeometry } = setup(0, {
            additionalGeometry: node => node.nodeId === 'a' ? [{ id: 'surface', shape: 'rect', x: 200, y: 300, width: 40, height: 40 }] : [],
            renderedSourceNodeId: () => 'surface',
        })
        manager.syncNodes([
            { ...nodes[0], ports: [{ id: 'custom', role: 'output', direction, anchor }] },
            nodes[1],
        ])
        manager.syncEdges([{ ...existingEdge, sourceHandle: 'custom' }])
        manager.render()
        const rendered = onConnectorGeometry.mock.lastCall![0][0]
        expect(flattenSvgPath(rendered.svgPath)[0]).toEqual(expected)
    })

    it('connects within its own pane when another canvas has the same node IDs', () => {
        const first = setup()
        const second = setup(800)
        expect(first.manager.flowId).not.toBe(second.manager.flowId)
        first.start()
        move(405)
        release(405)
        expect(first.onEdgesChange).toHaveBeenCalledWith([expect.objectContaining({ sourceNodeId: 'a', targetNodeId: 'b' })])
        expect(second.onEdgesChange).not.toHaveBeenCalled()
        expect(frames.size).toBe(0)
        second.start()
        move(405)
        release(405)
        expect(second.onEdgesChange).not.toHaveBeenCalled()
        second.start()
        move(1205)
        release(1205)
        expect(second.onEdgesChange).toHaveBeenCalledTimes(1)
    })

    it.each(['cancel', 'destroy', 'escape', 'blur', 'scene-removal'])('does not delete a reconnected edge on %s', action => {
        const { manager, start, onEdgesChange, onConnectorGeometry } = setup()
        manager.syncEdges([existingEdge])
        start(true)
        move(300, 300)
        expect(frames.size).toBe(1)
        if (action === 'cancel') manager.cancelTransientConnection()
        if (action === 'destroy') manager.destroy()
        if (action === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        if (action === 'blur') window.dispatchEvent(new Event('blur'))
        if (action === 'scene-removal') manager.syncNodes(nodes.filter(node => node.nodeId !== 'a'))
        expect(frames.size).toBe(0)
        onConnectorGeometry.mockClear()
        move(405)
        release(405)
        expect(onEdgesChange).not.toHaveBeenCalled()
        expect(onConnectorGeometry).not.toHaveBeenCalled()
    })

    it('deletes an edge only when a reconnect gesture is actually dropped in empty space', () => {
        const { manager, start, onEdgesChange } = setup()
        manager.syncEdges([existingEdge])
        start(true)
        move(300, 300)
        release(300, 300)
        expect(onEdgesChange).toHaveBeenCalledExactlyOnceWith([])
        expect(frames.size).toBe(0)
    })

    it('revalidates a drop if the target disappeared after the last pointer move', () => {
        const { manager, start, onEdgesChange } = setup()
        start()
        move(405)
        manager.syncNodes(nodes.filter(node => node.nodeId !== 'b'))
        release(405)
        expect(onEdgesChange).not.toHaveBeenCalled()
    })

    it('does not restart auto-pan when a pending pan resolves after cancellation', async () => {
        const { manager, start, panBy, onConnectorGeometry } = setup()
        let finishPan!: (result: boolean) => void
        panBy.mockImplementation(() =>
            new Promise(resolve => {
                finishPan = resolve
            })
        )
        start()
        move(690)
        const [id, callback] = frames.entries().next().value!
        frames.delete(id)
        const pending = callback(0)
        expect(panBy).toHaveBeenCalledTimes(1)
        manager.cancelTransientConnection()
        onConnectorGeometry.mockClear()
        finishPan(true)
        await pending
        expect(frames.size).toBe(0)
        expect(onConnectorGeometry).not.toHaveBeenCalled()
    })
})
