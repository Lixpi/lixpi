// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    WorkspaceCanvasInteractions,
    type WorkspaceCanvasInteractionsPorts,
} from './workspace-canvas-interactions.ts'

describe('WorkspaceCanvasInteractions', () => {
    it('clears node and edge selection when the canvas background is clicked', () => {
        const pane = document.createElement('div')
        const viewport = document.createElement('div')
        pane.append(viewport)
        document.body.append(pane)
        const clearNodes = vi.fn()
        const clearEdgeSelection = vi.fn()
        const owner = new WorkspaceCanvasInteractions({
            pane,
            viewport,
            gestures: { draggingNodeId: null, resizingNodeId: null, consumePaneClick: () => false },
            selection: {
                marquee: { active: false, start: vi.fn() },
                isCanvasBackgroundTarget: target => target === viewport,
                clearNodes,
                clearEdgeSelection,
                clearMarquee: vi.fn(),
            },
            isDestroyed: () => false,
            getState: () => null,
            getNode: () => undefined,
            getConnections: () => null,
            getWorldRect: vi.fn(),
            getPendingCircle: () => null,
            clientToWorld: () => ({ x: 0, y: 0 }),
            cancelInteraction: vi.fn(),
            suspendPanZoom: vi.fn(),
            startDrag: vi.fn(),
            deleteNodes: vi.fn(async () => {}),
            downloadMedia: vi.fn(async () => {}),
            replaceMedia: vi.fn(),
            openAsset: vi.fn(),
            commit: vi.fn(),
            defaultConnectorCurve: 'horizontal-bezier',
            getMenuVisualScale: () => 1,
        } as WorkspaceCanvasInteractionsPorts)

        viewport.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(clearNodes).toHaveBeenCalledOnce()
        expect(clearEdgeSelection).toHaveBeenCalledWith(true)
        owner.destroy()
    })
})
