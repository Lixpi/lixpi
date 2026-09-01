// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    ImageCanvasNode,
    BranchOriginCanvasNode,
    BranchForkCanvasNode,
    BranchLineCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceNodeShells,
    type WorkspaceNodeShellsOptions,
} from './workspace-node-shells.ts'

const image: ImageCanvasNode = { nodeId: 'image', type: 'image', assetId: 'asset', parentId: 'document', position: { x: 10, y: 20 }, dimensions: { width: 200, height: 100 } }
const owners: WorkspaceNodeShells[] = []
function fixture(overrides: Partial<WorkspaceNodeShellsOptions> = {}) {
    const options: WorkspaceNodeShellsOptions = {
        document,
        getBounds: node => ({ x: 110, y: 120, ...node.dimensions }),
        getLayer: () => 4,
        getZoom: () => 2,
        getResizeSettings: () => ({ useZoomCompensatedScaling: true, size: 24, offset: 6, minSize: 10, zoomScaling: { minZoom: 0.4 } }),
        consumeSuppressedClick: vi.fn(() => false),
        select: vi.fn(),
        toggleSelection: vi.fn(),
        startDrag: vi.fn(),
        startResize: vi.fn(),
        onCreate: vi.fn(),
        togglePlayback: vi.fn(),
        ...overrides,
    }
    const shells = new WorkspaceNodeShells(options)
    owners.push(shells)
    return { shells, options }
}
function mouse(element: HTMLElement, type: string, extra: MouseEventInit = {}) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }))
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('WorkspaceNodeShells', () => {
    it.each(['branchOrigin', 'branchFork', 'branchLine'] as const)('preserves %s metadata and opens details without click selection', type => {
        const { shells, options } = fixture()
        const node = { nodeId: type, type, branchId: 'branch', generationRequestId: 'request', conversationAssetId: 'conversation', reasoningRunId: 'reasoning-run', reasoningModelId: 'reasoning-model', reasoningIndex: 0, position: { x: 0, y: 0 }, dimensions: { width: 120, height: 80 } } as BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
        const open = vi.fn()
        const { nodeEl, dragOverlay } = shells.createBranchMarker(node, open)
        expect(nodeEl.dataset.branchId).toBe('branch')
        expect(nodeEl.dataset.generationRequestId).toBe('request')
        expect(nodeEl.dataset.conversationAssetId).toBe('conversation')
        if (type !== 'branchOrigin') expect(nodeEl.dataset.reasoningIndex).toBe('0')
        expect(nodeEl.querySelector('[data-corner]')).toBeNull()
        mouse(dragOverlay, 'mousedown')
        expect(open).not.toHaveBeenCalled()
        mouse(nodeEl, 'click')
        expect(open).toHaveBeenCalledOnce()
        expect(options.select).not.toHaveBeenCalled()
        shells.remove(type)
        mouse(nodeEl, 'click')
        expect(open).toHaveBeenCalledOnce()
    })

    it('selects the clicked media node and passes its own identity to dragging', () => {
        const { shells, options } = fixture()
        const element = shells.createMedia(image)
        document.body.appendChild(element)
        mouse(element, 'click')
        mouse(element.querySelector('.image-drag-overlay')!, 'mousedown')
        expect(options.select).toHaveBeenCalledExactlyOnceWith('image')
        expect(options.startDrag).toHaveBeenCalledWith(expect.any(MouseEvent), 'image', { allowSelection: true, onClick: undefined })
        expect(element.style.left).toBe('110px')
        expect(element.style.top).toBe('120px')
        expect(element.querySelector('img, .image-node-img, .image-generating-spinner, .img-dot-bounce')).toBeNull()
    })

    it.each(['contenteditable', 'ProseMirror', 'ai-chat-thread-wrapper'])('leaves %s clicks with the editor', kind => {
        const { shells, options } = fixture()
        const element = shells.createMedia(image)
        const editor = document.createElement('div')
        if (kind === 'contenteditable') editor.contentEditable = 'true'
        else editor.className = kind
        element.appendChild(editor)
        document.body.appendChild(element)
        mouse(editor, 'click')
        mouse(editor, 'click', { ctrlKey: true })
        expect(options.select).not.toHaveBeenCalled()
        expect(options.toggleSelection).not.toHaveBeenCalled()
    })

    it.each(['ctrlKey', 'metaKey'] as const)('toggles selection for %s clicks', key => {
        const { shells, options } = fixture()
        const element = shells.createMedia(image)
        mouse(element, 'click', { [key]: true })
        expect(options.toggleSelection).toHaveBeenCalledExactlyOnceWith('image')
        expect(options.select).not.toHaveBeenCalled()
    })

    it('opens nonselectable marker details from the native click, after drag mouseup', () => {
        const { shells, options } = fixture()
        const open = vi.fn()
        const { nodeEl, dragOverlay } = shells.create(image, 'workspace-branch-line-node', {}, { allowSelection: false, renderResizeHandles: false, onClick: open })
        mouse(dragOverlay, 'mousedown')
        expect(options.startDrag).toHaveBeenCalledWith(expect.any(MouseEvent), 'image', { allowSelection: false, onClick: undefined })
        expect(open).not.toHaveBeenCalled()
        mouse(nodeEl, 'click')
        expect(open).toHaveBeenCalledOnce()
        expect(options.select).not.toHaveBeenCalled()
        expect(nodeEl.querySelector('[data-corner]')).toBeNull()
    })

    it('consumes a suppressed click without selecting or opening details', () => {
        const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
        const { shells, options } = fixture({ consumeSuppressedClick: consume })
        const open = vi.fn()
        const { nodeEl } = shells.create(image, undefined, undefined, { onClick: open })
        mouse(nodeEl, 'click')
        expect(options.select).not.toHaveBeenCalled()
        expect(open).not.toHaveBeenCalled()
        mouse(nodeEl, 'click')
        expect(options.select).toHaveBeenCalledOnce()
        expect(open).toHaveBeenCalledOnce()
    })

    it('scales artwork hit targets and releases resize and playback listeners', () => {
        const { shells, options } = fixture()
        const element = shells.createMedia({ ...image, type: 'video' })
        const handle = element.querySelector('[data-corner="bottom-right"]') as HTMLElement
        const drag = element.querySelector('.video-drag-overlay') as HTMLElement
        expect(handle.style.width).toBe('12px')
        expect(handle.querySelector('svg')).not.toBeNull()
        shells.setZoom(1)
        expect(handle.style.width).toBe('24px')
        mouse(handle, 'mousedown')
        mouse(drag, 'dblclick')
        expect(options.startResize).toHaveBeenCalledWith(expect.any(MouseEvent), 'image', 'bottom-right')
        expect(options.togglePlayback).toHaveBeenCalledExactlyOnceWith('image')
        shells.remove('image')
        mouse(handle, 'mousedown')
        mouse(drag, 'dblclick')
        mouse(element, 'click')
        expect(options.startResize).toHaveBeenCalledOnce()
        expect(options.togglePlayback).toHaveBeenCalledOnce()
        expect(options.select).not.toHaveBeenCalled()
    })

    it('keeps the previous node mounted if replacement content fails', () => {
        const { shells, options } = fixture()
        const original = shells.createMedia(image)
        document.body.appendChild(original)
        expect(() =>
            shells.replace('image', () => {
                shells.createMedia(image)
                throw new Error('content failed')
            })
        ).toThrow('content failed')
        expect(document.body.firstElementChild).toBe(original)
        mouse(original, 'click')
        expect(options.select).toHaveBeenCalledOnce()
        const replacement = shells.replace('image', () => shells.createMedia(image))
        expect(document.body.firstElementChild).toBe(replacement)
        expect(original.isConnected).toBe(false)
        mouse(original, 'click')
        expect(options.select).toHaveBeenCalledOnce()
        mouse(replacement, 'click')
        expect(options.select).toHaveBeenCalledTimes(2)
    })

    it('does not dispose another canvas with the same node IDs', () => {
        const first = fixture()
        const second = fixture()
        const a = first.shells.createMedia(image)
        const b = second.shells.createMedia(image)
        document.body.append(a, b)
        first.shells.destroy()
        expect(a.isConnected).toBe(false)
        expect(b.isConnected).toBe(true)
        mouse(b, 'click')
        expect(second.options.select).toHaveBeenCalledOnce()
        expect(() => first.shells.createMedia(image)).toThrow('disposed')
    })
})
