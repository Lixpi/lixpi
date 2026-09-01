// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceCanvasSelection,
    type WorkspaceCanvasSelectionPorts,
} from './workspace-canvas-selection.ts'

describe('WorkspaceCanvasSelection', () => {
    it('filters missing nodes and reflects single-node selection in DOM and media ports', () => {
        const pane = document.createElement('div')
        const viewport = document.createElement('div')
        const nodeElement = document.createElement('div')
        nodeElement.dataset.nodeId = 'image-1'
        viewport.append(nodeElement)
        pane.append(viewport)
        let nodeIds = new Set<string>()
        let fromMarquee = false
        const selection = {
            get nodeIds() {
                return nodeIds
            },
            get fromMarquee() {
                return fromMarquee
            },
            replace: (next: Set<string>, nextFromMarquee = false) => {
                const previous = nodeIds
                nodeIds = next
                fromMarquee = nextFromMarquee
                return previous
            },
            toggle: (nodeId: string) => {
                const previous = nodeIds
                nodeIds = new Set(nodeIds)
                if (nodeIds.has(nodeId)) nodeIds.delete(nodeId)
                else nodeIds.add(nodeId)
                return previous
            },
            clear: () => {
                nodeIds = new Set()
                fromMarquee = false
            },
        }
        const setSelectedImageNodes = vi.fn()
        const showNode = vi.fn()
        const state = {
            nodes: [{ nodeId: 'image-1', type: 'image', assetId: 'asset-1', position: { x: 0, y: 0 }, dimensions: { width: 10, height: 10 } }],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
        } as CanvasState
        const owner = new WorkspaceCanvasSelection({
            pane,
            viewport,
            runtime: {
                selection,
                installSelectionOverlay: () => ({ setGroup: vi.fn(), setMarquee: vi.fn(), reset: vi.fn(), contains: () => false }),
                installMarquee: () => ({ active: false, bounds: null, cancel: vi.fn() }),
            },
            media: { setSelectedImageNodes, setSelectionOverlayBounds: vi.fn(), setMarqueeRect: vi.fn() },
            layers: { bringToFront: vi.fn() },
            marqueeStyle: { borderColor: 'red', backgroundColor: 'blue' },
            getState: () => state,
            getNodeWorldPosition: node => node.position,
            getNodeGeometryOverride: () => undefined,
            getConnections: () => null,
            lockPan: () => vi.fn(),
            startGroupDrag: vi.fn(),
            suppressPaneClick: vi.fn(),
            addContext: vi.fn(),
            scheduleEdges: vi.fn(),
            menu: { showNode, showEdge: vi.fn(), hide: vi.fn(), repositionNode: vi.fn(), repositionEdge: vi.fn() },
        } as WorkspaceCanvasSelectionPorts)

        owner.setNodes(new Set(['missing', 'image-1']))

        expect([...owner.selection.nodeIds]).toEqual(['image-1'])
        expect(nodeElement.classList.contains('is-selected')).toBe(true)
        expect(setSelectedImageNodes).toHaveBeenCalledWith(owner.selection.nodeIds)
        expect(showNode).toHaveBeenCalledWith('image-1')
    })
})
