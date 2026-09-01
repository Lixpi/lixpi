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
    type CanvasNode,
} from '@lixpi/constants'
import {
    type BubbleMenuOptions,
    type BubbleMenuPositionRequest,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    WorkspaceCanvasMenu,
    type WorkspaceCanvasMenuPorts,
} from './workspace-canvas-menu.ts'

const menus = vi.hoisted(() => ({ failMount: false, instances: [] as FakeMenu[] }))
class FakeMenu {
    isVisible = false
    readonly show = vi.fn((_context: string, _position: BubbleMenuPositionRequest) => {
        this.isVisible = true
    })
    readonly hide = vi.fn(() => {
        this.isVisible = false
    })
    readonly forceHide = vi.fn(() => {
        this.isVisible = false
    })
    readonly refreshState = vi.fn()
    readonly reposition = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly options: BubbleMenuOptions) {
        menus.instances.push(this)
        if (menus.failMount) throw new Error('menu failed')
    }
}
vi.mock('@lixpi/ui-kit/components/bubble-menu', () => ({
    BubbleMenu: class {
        constructor(options: BubbleMenuOptions) {
            return new FakeMenu(options)
        }
    },
}))
const owners: WorkspaceCanvasMenu[] = []
function fixture() {
    const pane = document.createElement('div')
    const viewport = document.createElement('div')
    pane.appendChild(viewport)
    document.body.appendChild(pane)
    const nodes = new Map<string, CanvasNode>()
    const edgeRect = new DOMRect(30, 40, 1, 1)
    const ports: WorkspaceCanvasMenuPorts = {
        pane,
        viewport,
        getNode: id => nodes.get(id),
        getEdgeRect: vi.fn(() => edgeRect),
        getVisualScale: () => 1.2,
        actions: { onDeleteNode: vi.fn(), onDeleteEdge: vi.fn(), onChangeConnectorCurve: vi.fn(), onDownloadMedia: vi.fn(), onReplaceMedia: vi.fn(), onOpenAsset: vi.fn(), onTriggerConnection: vi.fn() },
    }
    const owner = new WorkspaceCanvasMenu(ports)
    owners.push(owner)
    const menu = menus.instances.at(-1)!
    const addNode = (nodeId: string, type: CanvasNode['type'] = 'image') => {
        nodes.set(nodeId, { nodeId, type } as CanvasNode)
        const element = document.createElement('div')
        element.dataset.nodeId = nodeId
        viewport.appendChild(element)
        const rect = new DOMRect(10, 20, 300, 200)
        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
        return { element, rect }
    }
    const button = (title: string) => menu.options.items.find(item => item.element.getAttribute('aria-label') === title)!.element
    return { owner, ports, menu, nodes, viewport, edgeRect, addNode, button }
}
beforeEach(() => {
    menus.instances.length = 0
    menus.failMount = false
})
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('WorkspaceCanvasMenu', () => {
    it('anchors media menus to the node shell and forwards live scale to UI-kit', () => {
        const f = fixture()
        const { rect } = f.addNode('node')
        f.owner.showNode('node')
        expect(f.menu.show).toHaveBeenCalledWith('canvasImage', { targetRect: rect, placement: 'below', clampToParent: false, animateOnShow: false })
        expect(f.menu.options.getVisualScale?.()).toBe(1.2)
        expect(f.menu.refreshState).toHaveBeenCalledOnce()
        f.owner.repositionNode('node')
        expect(f.menu.reposition).toHaveBeenCalledWith({ targetRect: rect, placement: 'below', clampToParent: false, animateOnShow: false })
    })

    it.each([['video', 'canvasVideo'], ['mediaDocument', 'canvasDocument'], ['audio', 'canvasAudio']] as const)('assigns the %s canvas context', (type, context) => {
        const f = fixture()
        f.addNode('node', type)
        f.owner.showNode('node')
        expect(f.menu.show).toHaveBeenCalledWith(context, expect.any(Object))
    })

    it('clears stale actions when a selected node is unsupported or has no mounted shell', () => {
        const f = fixture()
        f.addNode('first')
        const missing = f.addNode('missing')
        f.owner.showNode('first')
        missing.element.remove()
        f.owner.showNode('missing')
        f.button('Delete image').click()
        expect(f.ports.actions.onDeleteNode).not.toHaveBeenCalled()
        expect(f.menu.hide).toHaveBeenCalledOnce()
        f.addNode('document', 'document')
        f.owner.showNode('document')
        expect(f.menu.hide).toHaveBeenCalledTimes(2)
    })

    it('switches between node and edge actions without retaining the previous target', () => {
        const f = fixture()
        f.addNode('node')
        f.owner.showNode('node')
        f.owner.showEdge('edge')
        f.button('Delete image').click()
        f.button('Delete connection').click()
        expect(f.ports.actions.onDeleteNode).not.toHaveBeenCalled()
        expect(f.ports.actions.onDeleteEdge).toHaveBeenCalledExactlyOnceWith('edge')
        f.owner.showEdge('edge')
        f.owner.repositionEdge('edge')
        expect(f.menu.reposition).toHaveBeenCalledWith({ targetRect: f.edgeRect, placement: 'below' })
        f.owner.showNode('node')
        f.button('Delete connection').click()
        expect(f.ports.actions.onDeleteEdge).toHaveBeenCalledTimes(1)
    })

    it('hides before starting a connection while preserving the clicked node ID', () => {
        const f = fixture()
        f.addNode('node')
        f.owner.showNode('node')
        f.button('Connect to node').click()
        expect(f.menu.forceHide).toHaveBeenCalledOnce()
        expect(f.ports.actions.onTriggerConnection).toHaveBeenCalledExactlyOnceWith('node')
    })

    it('hides an edge menu when its geometry disappears', () => {
        const f = fixture()
        f.owner.showEdge('edge')
        vi.mocked(f.ports.getEdgeRect).mockReturnValue(null)
        f.owner.repositionEdge('edge')
        f.button('Delete connection').click()
        expect(f.ports.actions.onDeleteEdge).not.toHaveBeenCalled()
        expect(f.menu.hide).toHaveBeenCalledOnce()
    })

    it('releases action listeners even when menu destruction throws', () => {
        const f = fixture()
        f.addNode('node')
        f.owner.showNode('node')
        const button = f.button('Delete image')
        f.menu.destroy.mockImplementationOnce(() => {
            throw new Error('cleanup failed')
        })
        expect(() => f.owner.destroy()).toThrow()
        button.click()
        f.owner.showNode('node')
        expect(f.ports.actions.onDeleteNode).not.toHaveBeenCalled()
        expect(f.menu.show).toHaveBeenCalledOnce()
    })

    it('does not leave actionable buttons after a failed menu mount', () => {
        menus.failMount = true
        expect(() => fixture()).toThrow('menu failed')
        const menu = menus.instances[0]
        for (const item of menu.options.items) item.element.click()
        expect(menu.options.items.every(item => !item.element.isConnected)).toBe(true)
    })

    it('keeps node lookup and disposal within each supplied viewport', () => {
        const first = fixture()
        const second = fixture()
        first.addNode('same')
        const { rect } = second.addNode('same')
        first.owner.destroy()
        second.owner.showNode('same')
        second.button('Delete image').click()
        expect(second.menu.show).toHaveBeenCalledWith('canvasImage', expect.objectContaining({ targetRect: rect }))
        expect(second.ports.actions.onDeleteNode).toHaveBeenCalledExactlyOnceWith('same')
        expect(first.ports.actions.onDeleteNode).not.toHaveBeenCalled()
    })
})
