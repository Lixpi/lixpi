// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CanvasController,
    type CanvasOptions,
} from './canvas-controller.ts'
import {
    NodeRegistry,
    type ComponentContext,
} from './node-registry.ts'
import type {
    CanvasIntent,
    EngineNode,
    NodeGeometryPolicy,
    SceneSnapshot,
} from '../../shared/index.ts'

const renderers = vi.hoisted(() => [] as any[])
const rendererInitialization = vi.hoisted(() => ({ value: true }))
vi.mock('../rendering/canvas-renderer.ts', () => ({
    CanvasRenderer: class {
        ready = Promise.resolve(rendererInitialization.value)
        scopes: AbortController[] = []
        resize = vi.fn()
        setViewport = vi.fn()
        destroy = vi.fn(() => {
            for (const scope of this.scopes) scope.abort()
        })
        constructor() {
            renderers.push(this)
        }
        createScope() {
            const abort = new AbortController()
            this.scopes.push(abort)
            return { signal: abort.signal, destroy: () => abort.abort(), resources: { createGroup: vi.fn(() => ({})), createPath: vi.fn(() => ({})), updatePath: vi.fn(), setVisible: vi.fn(), updateGroup: vi.fn(), release: vi.fn() }, media: {}, layers: {}, requestFrame: vi.fn(), invalidate: vi.fn() }
        }
    },
}))

vi.mock('@xyflow/system', async importOriginal => {
    const actual = await importOriginal<typeof import('@xyflow/system')>()
    return { ...actual, XYPanZoom: vi.fn(() => ({ update: vi.fn(), syncViewport: vi.fn(), setViewport: vi.fn(async () => true), destroy: vi.fn() })) }
})

const geometry: NodeGeometryPolicy = {
    movable: true,
    resize: { min: { width: 20, height: 20 }, max: { width: 200, height: 200 }, preserveAspectRatio: false },
    measure: node => {
        const bounds = { ...node.position, ...node.dimensions }
        return { visualBounds: bounds, hitBounds: bounds, selectionBounds: { ...bounds, height: bounds.height + 20 }, collisionBounds: bounds, connectorBounds: bounds }
    },
}
const connectorSettings = {
    lineCurve: 'straight' as const,
    useZoomCompensatedScaling: false,
    scaling: { strokeWidth: 2, markerSize: 12, markerOffset: { source: 0, target: 0 }, clickAreaWidth: 12, zoomScaling: { minZoom: 0.1 } },
    proximityConnectThreshold: 40,
    menuConnectionSnapRadius: 30,
    autoAlign: { minSlideHeight: 60, edgeMargin: 0.1 },
    styles: { lineDefaultColor: '#000000', lineFocusColor: '#ffffff' },
}
function node(nodeId: string, x = 20, parentId?: string): EngineNode {
    return { nodeId, type: 'note', ports: [], data: null, parentId, position: { x, y: 20 }, dimensions: { width: 100, height: 80 } }
}
function snapshot(nodes: EngineNode[], sceneKey = 'board'): SceneSnapshot {
    return { nodes, sceneKey, revision: '1', edges: [] }
}
const canvases: CanvasController[] = []
function fixture(nodes = [node('a')], overrides: Partial<CanvasOptions> = {}) {
    const root = overrides.root ?? document.createElement('div')
    document.body.appendChild(root)
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 } as DOMRect)
    const contexts = new Map<string, ComponentContext>()
    const registry = new NodeRegistry().register({
        type: 'note',
        geometry,
        mount: (node, context) => {
            contexts.set(node.nodeId, context)
            return { update: vi.fn(), setGeometry: vi.fn(), setSelected: vi.fn(), setVisible: vi.fn(), destroy: vi.fn() }
        },
    })
    const onIntent = vi.fn<(intent: CanvasIntent) => void>()
    const onError = vi.fn()
    const canvas = new CanvasController({ root, scene: snapshot(nodes), viewport: { x: 0, y: 0, zoom: 1 }, registry, onIntent, onError, ...overrides })
    canvases.push(canvas)
    const pane = root.querySelector('.canvas-engine-pane') as HTMLElement
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(() => root.getBoundingClientRect())
    return { canvas, root, pane, contexts, onIntent, onError }
}
function mouse(target: EventTarget, type: string, x: number, y: number, extra: MouseEventInit = {}) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra }))
}
beforeEach(() => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    )
    renderers.length = 0
    rendererInitialization.value = true
})
afterEach(() => {
    for (const canvas of canvases.splice(0)) canvas.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('CanvasController', () => {
    it('delivers connection fractions to a custom adapter without emitting a second mutation', () => {
        const { canvas, onIntent } = fixture([node('a', 300), node('b', 410)], { interaction: false })
        const onEdgesChange = vi.fn()
        const controls = canvas.installConnections({ settings: connectorSettings, onEdgesChange, policy: { canConnectProximity: () => true } })
        controls.checkProximity('a', { x: 300, y: 20 }, { width: 100, height: 80 })
        controls.render()
        controls.commitProximityConnection()
        expect(onEdgesChange).toHaveBeenCalledWith([expect.objectContaining({ sourceNodeId: 'a', targetNodeId: 'b', sourceT: 0.5, targetT: 0.5 })])
        expect(onIntent).not.toHaveBeenCalled()
        expect(() => canvas.installConnections({ settings: connectorSettings })).toThrow('already installed')
    })

    it('releases a failed connection installation and allows a clean retry', () => {
        const { canvas } = fixture(undefined, { interaction: false })
        const source = { ...node('a'), ports: [{ id: 'right', role: 'output' as const, direction: 'right' as const, anchor: { x: 100, y: 40 } }] }
        const target = { ...node('b', 300), ports: [{ id: 'left', role: 'input' as const, direction: 'left' as const, anchor: { x: 0, y: 40 } }] }
        canvas.setScene({ ...snapshot([source, target]), edges: [{ edgeId: 'edge', source: { nodeId: 'a', portId: 'right' }, target: { nodeId: 'b', portId: 'left' }, path: 'straight', data: null }] })
        const renderer = renderers.at(-1)!
        const before = renderer.scopes.length
        expect(() =>
            canvas.installConnections({
                settings: connectorSettings,
                policy: {
                    additionalGeometry: () => {
                        throw new Error('Invalid projection')
                    },
                },
            })
        ).toThrow('Invalid projection')
        expect(renderer.scopes.slice(before).every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        const controls = canvas.installConnections({ settings: connectorSettings })
        expect(controls.flowId).toBeTruthy()
        canvas.destroy()
        expect(() => canvas.installConnections({ settings: connectorSettings })).toThrow('disposed')
    })

    it('owns custom input controls and keeps renderer placement separate from the input root', () => {
        const root = document.createElement('div')
        const renderRoot = document.createElement('div')
        const overlayRoot = document.createElement('div')
        root.append(renderRoot, overlayRoot)
        const { canvas, contexts } = fixture(undefined, { root, renderRoot, overlayRoot, interaction: false })
        expect(renderRoot.querySelector('.canvas-engine-pane')).not.toBeNull()
        const viewport = canvas.installViewport({ onTransformChange: vi.fn() })
        const release = viewport.lock()
        expect(viewport.locked).toBe(true)
        release()
        const overlay = canvas.installSelectionOverlay({ marquee: { borderColor: '#000000', backgroundColor: 'transparent' } })
        const bounds = { x: 1, y: 2, width: 300, height: 200 }
        overlay.setGroup(bounds)
        canvas.setSelected(['a'])
        expect(overlayRoot.querySelector<HTMLElement>('.canvas-selection-group')!.style.width).toBe('300px')
        const onDelete = vi.fn(() => true)
        canvas.installKeyboard({ onDelete, onEscape: vi.fn() })
        contexts.get('a')!.contentRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
        expect(onDelete).toHaveBeenCalledOnce()
        const marquee = canvas.installMarquee({ onStart() {}, onChange() {}, onEnd() {}, onCancel() {} })
        expect(() => canvas.installViewport({ onTransformChange: vi.fn() })).toThrow('already installed')
        expect(() => canvas.installKeyboard({ onDelete, onEscape: vi.fn() })).toThrow('already installed')
        canvas.destroy()
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
        expect(onDelete).toHaveBeenCalledOnce()
        expect(() => marquee.start(new MouseEvent('mousedown'))).toThrow('disposed')
        expect(renderRoot.children).toHaveLength(0)
        expect(overlayRoot.children).toHaveLength(0)
        expect(() => canvas.installViewport({ onTransformChange: vi.fn() })).toThrow('disposed')
    })

    it('routes custom drag and resize through its geometry scopes and cancels them with the scene', () => {
        const { canvas, root } = fixture(undefined, { interaction: false })
        const changes: Array<{ x: number; y: number }> = []
        const end = vi.fn()
        const cancel = vi.fn()
        const event = new MouseEvent('mousedown', { button: 0, clientX: 30, clientY: 30 })
        canvas.startNodeDrag({
            event,
            targets: [{ nodeId: 'a', bounds: canvas.scene.getWorldBounds('a')! }],
            onChange: bounds => {
                expect(canvas.scene.getWorldBounds('a')).toEqual(bounds.get('a'))
                changes.push({ x: bounds.get('a')!.x, y: bounds.get('a')!.y })
            },
            onEnd: end,
            onCancel: cancel,
        })
        mouse(document, 'mousemove', 60, 70)
        expect(changes).toEqual([{ x: 50, y: 60 }])
        canvas.setScene(snapshot([node('a')], 'next'))
        expect(cancel).toHaveBeenCalledExactlyOnceWith('scene-change')
        mouse(document, 'mouseup', 70, 80)
        expect(end).not.toHaveBeenCalled()
        expect(canvas.scene.getWorldBounds('a')).toMatchObject({ x: 20, y: 20 })
        canvas.startNodeResize({ event, target: { nodeId: 'a', bounds: canvas.scene.getWorldBounds('a')! }, handle: 'bottom-right', constraints: { min: { width: 1, height: 1 }, preserveAspectRatio: false }, onChange() {}, onEnd: end, onCancel: cancel })
        mouse(document, 'mousemove', 50, 60)
        expect(canvas.scene.getWorldBounds('a')).toMatchObject({ width: 120, height: 110 })
        canvas.destroy()
        expect(cancel).toHaveBeenLastCalledWith('destroyed')
        mouse(root, 'mouseup', 50, 60)
        expect(end).not.toHaveBeenCalled()
    })

    it('handles nodes mounted in an explicit overlay root inside the canvas', () => {
        const root = document.createElement('div')
        const overlayRoot = document.createElement('div')
        root.appendChild(overlayRoot)
        document.body.appendChild(root)
        const { canvas, contexts, onIntent } = fixture(undefined, { root, overlayRoot })
        mouse(contexts.get('a')!.contentRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 60, 50)
        mouse(document, 'mouseup', 60, 50)
        expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'geometry',
            changes: [
                { nodeId: 'a', position: { x: 50, y: 40 }, dimensions: { width: 100, height: 80 } },
            ],
        }))
        canvas.destroy()
        expect(overlayRoot.children).toHaveLength(0)
        onIntent.mockClear()
        mouse(overlayRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 90, 90)
        mouse(document, 'mouseup', 90, 90)
        expect(onIntent).not.toHaveBeenCalled()
    })

    it('passes opaque edge data and the owned node root to connector policies', () => {
        const sourceAnchorT = vi.fn(() => 0.25)
        const targetMarker = vi.fn(() => 'none' as const)
        const first = { ...node('a'), ports: [{ id: 'out', role: 'output' as const, direction: 'right' as const, anchor: { x: 100, y: 40 } }] }
        const second = { ...node('b', 300), ports: [{ id: 'in', role: 'input' as const, direction: 'left' as const, anchor: { x: 0, y: 40 } }] }
        const data = { contentId: 'paragraph-1' }
        const { canvas, contexts, onError } = fixture([first, second], {
            scene: { ...snapshot([first, second]), edges: [{ edgeId: 'a-b', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'b', portId: 'in' }, path: 'straight', data }] },
            connectors: { settings: connectorSettings, policy: { sourceAnchorT, targetMarker, isCentered: () => false } },
        })
        expect(sourceAnchorT).toHaveBeenCalledWith(expect.objectContaining({ data }), contexts.get('a')!.contentRoot)
        expect(targetMarker).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'b' }), false)
        expect(onError).not.toHaveBeenCalled()
        const previousRoot = contexts.get('a')!.contentRoot
        canvas.setScene(snapshot([]))
        canvas.setScene(snapshot([first]))
        expect(contexts.get('a')!.contentRoot).not.toBe(previousRoot)
        expect(previousRoot.isConnected).toBe(false)
    })

    it('disposes input, scene and extension scopes when renderer initialization fails', async () => {
        rendererInitialization.value = false
        const release = vi.fn()
        const { canvas, root, contexts, onIntent } = fixture(undefined, { extensions: [{ id: 'extension', mount: () => release }] })
        expect(await canvas.ready).toBe(false)
        expect(root.children).toHaveLength(0)
        expect(contexts.get('a')!.signal.aborted).toBe(true)
        expect(release).toHaveBeenCalledOnce()
        mouse(contexts.get('a')!.contentRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 90, 90)
        mouse(document, 'mouseup', 90, 90)
        expect(onIntent).not.toHaveBeenCalled()
    })

    it('connects named ports through owned DOM handles and reports neutral endpoints', () => {
        const first = { ...node('a'), ports: [{ id: 'out', role: 'output' as const, direction: 'right' as const, anchor: { x: 100, y: 40 } }] }
        const second = { ...node('b', 300), ports: [{ id: 'in', role: 'input' as const, direction: 'left' as const, anchor: { x: 0, y: 40 } }] }
        const { root, onIntent, onError } = fixture([first, second], {
            connectors: {
                settings: {
                    lineCurve: 'straight',
                    useZoomCompensatedScaling: false,
                    scaling: { strokeWidth: 2, markerSize: 12, markerOffset: { source: 0, target: 0 }, clickAreaWidth: 12, zoomScaling: { minZoom: 0.1 } },
                    proximityConnectThreshold: 40,
                    menuConnectionSnapRadius: 30,
                    autoAlign: { minSlideHeight: 60, edgeMargin: 0.1 },
                    styles: { lineDefaultColor: '#000000', lineFocusColor: '#ffffff' },
                },
            },
        })
        mouse(root.querySelector('[data-handleid="out"]')!, 'mousedown', 120, 60)
        mouse(document, 'mousemove', 300, 60)
        mouse(document, 'mouseup', 300, 60)
        expect(onIntent).toHaveBeenCalledExactlyOnceWith({ kind: 'connect', sceneKey: 'board', source: { nodeId: 'a', portId: 'out' }, target: { nodeId: 'b', portId: 'in' } })
        expect(onError).not.toHaveBeenCalled()
    })

    it('cleans partial controller construction when observing its root fails', () => {
        const disconnect = vi.fn()
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {
                    throw new Error('observe failed')
                }
                disconnect = disconnect
            },
        )
        expect(() => fixture()).toThrow('observe failed')
        expect(document.querySelector('.canvas-engine-pane')).toBeNull()
        expect(renderers.at(-1).destroy).toHaveBeenCalledOnce()
        expect(renderers.at(-1).scopes.every((scope: AbortController) => scope.signal.aborted)).toBe(true)
        expect(disconnect).toHaveBeenCalledOnce()
    })

    it('commits parent-relative group movement through an intent without mutating host state', () => {
        const nodes = [node('parent', 100), node('child', 10, 'parent')]
        const { canvas, contexts, onIntent } = fixture(nodes, { viewport: { x: 0, y: 0, zoom: 2 } })
        canvas.setSelected(['parent', 'child'])
        mouse(contexts.get('parent')!.contentRoot, 'mousedown', 200, 40)
        mouse(document, 'mousemove', 240, 80)
        expect(canvas.scene.getNodeGeometry('parent')!.worldBounds.x).toBe(120)
        expect(canvas.scene.getNodeGeometry('child')!.worldBounds.x).toBe(130)
        mouse(document, 'mouseup', 240, 80)
        expect(onIntent).toHaveBeenCalledWith({
            kind: 'geometry',
            sceneKey: 'board',
            revision: '1',
            changes: [
                { nodeId: 'parent', position: { x: 120, y: 40 }, dimensions: { width: 100, height: 80 } },
            ],
        })
        expect(nodes[0].position.x).toBe(100)
        expect(canvas.scene.getNodeGeometry('parent')!.worldBounds.x).toBe(100)
    })

    it('uses selection footprints for marquee and keeps two canvases independent', () => {
        const first = fixture()
        const second = fixture()
        mouse(first.pane, 'mousedown', 5, 110)
        mouse(document, 'mousemove', 60, 125)
        expect(first.canvas.selection.has('a')).toBe(true)
        expect(second.canvas.selection.has('a')).toBe(false)
        mouse(document, 'mouseup', 60, 125)
        expect(first.canvas.selection.fromMarquee).toBe(true)
        first.canvas.destroy()
        expect(first.root.children).toHaveLength(0)
        expect(second.contexts.get('a')!.signal.aborted).toBe(false)
        expect(second.root.querySelector('[data-canvas-node-id="a"]')).not.toBeNull()
    })

    it('cancels pending geometry on scene replacement without committing into the next scene', () => {
        const { canvas, contexts, onIntent } = fixture()
        mouse(contexts.get('a')!.contentRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 60, 50)
        canvas.setScene(snapshot([node('a', 300)], 'next'))
        mouse(document, 'mouseup', 80, 80)
        expect(onIntent).not.toHaveBeenCalled()
        expect(canvas.scene.getNodeGeometry('a')!.worldBounds.x).toBe(300)
        expect(canvas.selection.nodeIds.size).toBe(0)
    })

    it('accepts same-scene updates during a drag and commits against the latest revision', () => {
        const { canvas, contexts, onIntent } = fixture()
        mouse(contexts.get('a')!.contentRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 60, 50)
        canvas.setScene({ ...snapshot([node('a'), node('b', 300)]), revision: '2' })
        expect(canvas.scene.getNodeGeometry('a')!.worldBounds.x).toBe(50)
        mouse(document, 'mouseup', 60, 50)
        expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'geometry', revision: '2' }))
    })

    it('resizes within the registered constraints and does not turn editor input into a drag', () => {
        const { canvas, root, contexts, onIntent } = fixture()
        const input = document.createElement('textarea')
        contexts.get('a')!.contentRoot.appendChild(input)
        mouse(input, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 80, 80)
        mouse(document, 'mouseup', 80, 80)
        expect(onIntent).not.toHaveBeenCalled()
        canvas.setSelected(['a'])
        mouse(root.querySelector('[data-corner="bottom-right"]')!, 'mousedown', 120, 100)
        mouse(document, 'mousemove', 900, 900)
        mouse(document, 'mouseup', 900, 900)
        expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'geometry', changes: [{ nodeId: 'a', position: { x: 20, y: 20 }, dimensions: { width: 200, height: 200 } }] }))
    })

    it('releases extension resources after failed mounts and disposes only the selected extension', () => {
        const { canvas, root } = fixture()
        const disposed = vi.fn()
        let failedContext: any
        expect(() =>
            canvas.installExtension({
                id: 'failure',
                mount: context => {
                    failedContext = context
                    const overlay = document.createElement('div')
                    overlay.dataset.extension = 'failure'
                    context.mountOverlay(overlay, 'screen')
                    throw new Error('mount failed')
                },
            })
        ).toThrow('mount failed')
        expect(failedContext.signal.aborted).toBe(true)
        expect(root.querySelector('[data-extension="failure"]')).toBeNull()
        const release = canvas.installExtension({ id: 'retained', mount: () => disposed })
        expect(() => canvas.installExtension({ id: 'retained', mount: () => () => {} })).toThrow('duplicate')
        release()
        release()
        expect(disposed).toHaveBeenCalledOnce()
        expect(() => canvas.installExtension({ id: 'retained', mount: () => () => {} })).not.toThrow()
    })

    it('leaves the accepted scene and DOM intact after invalid updates', () => {
        const { canvas, contexts } = fixture()
        const initial = contexts.get('a')!
        expect(() => canvas.setScene(snapshot([node('duplicate'), node('duplicate')], 'bad'))).toThrow()
        expect(canvas.scene.scene.sceneKey).toBe('board')
        expect(initial.signal.aborted).toBe(false)
        expect(() => canvas.setViewport({ x: 0, y: 0, zoom: 0 })).toThrow()
        expect(canvas.scene.viewport.zoom).toBe(1)
    })

    it('supports a presentation-only host without installing node interaction targets', () => {
        const { canvas, contexts, root, onIntent } = fixture(undefined, { interaction: false })
        mouse(contexts.get('a')!.contentRoot, 'mousedown', 30, 30)
        mouse(document, 'mousemove', 100, 100)
        mouse(document, 'mouseup', 100, 100)
        expect(onIntent).not.toHaveBeenCalled()
        expect(root.querySelector('.canvas-node-handles')).toBeNull()
        canvas.setViewport({ x: 20, y: 10, zoom: 2 })
        expect(canvas.scene.viewport.zoom).toBe(2)
    })
})
