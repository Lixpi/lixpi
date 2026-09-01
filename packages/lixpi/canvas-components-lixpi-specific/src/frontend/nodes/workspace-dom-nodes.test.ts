// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    OperationStatusCanvasNode,
} from '@lixpi/constants'
import { WorkspaceDomNodes } from './workspace-dom-nodes.ts'
import { WorkspaceNodeShells } from './workspace-node-shells.ts'

afterEach(() => document.body.replaceChildren())

function node(type: CanvasNode['type']): CanvasNode {
    return { nodeId: type, type, assetId: 'first', position: { x: 10, y: 20 }, dimensions: { width: 100, height: 80 }, status: 'in-progress', operation: 'upload' } as CanvasNode
}

function fixture() {
    const disposed: string[] = []
    const select = vi.fn()
    const shells = new WorkspaceNodeShells({
        document,
        getBounds: node => ({ ...node.position, ...node.dimensions }),
        getLayer: () => 1,
        getZoom: () => 1,
        getResizeSettings: () => ({ size: 24, offset: 12, minSize: 12, useZoomCompensatedScaling: false, zoomScaling: {} }),
        consumeSuppressedClick: () => false,
        select,
        toggleSelection() {},
        startDrag() {},
        startResize() {},
        onCreate() {},
        togglePlayback() {},
    })
    const mount = vi.fn((node: CanvasNode) => {
        const { nodeEl, own } = shells.create(node)
        own(() => {
            disposed.push(node.nodeId)
        })
        nodeEl.appendChild(document.createElement('input'))
        return nodeEl
    })
    const updateBranch = vi.fn()
    const dom = new WorkspaceDomNodes({ shells, document: mount, capability: mount, operation: mount, branch: mount, updateBranch })
    return { dom, shells, mount, select, disposed, updateBranch }
}

describe('WorkspaceDomNodes', () => {
    it.each(['document', 'capabilityArtifact'] as const)('retains the %s editor through geometry changes and replaces it when its Asset changes', type => {
        const test = fixture()
        const original = node(type)
        const view = test.dom.mount(original)
        document.body.appendChild(view.element)
        const editor = view.element.querySelector('input')!
        editor.value = 'unsaved local edit'
        view.update({ ...original, position: { x: 300, y: 400 }, dimensions: { width: 200, height: 150 } })
        expect(test.mount).toHaveBeenCalledOnce()
        expect(view.element.querySelector('input')).toBe(editor)
        expect(editor.value).toBe('unsaved local edit')
        view.update({ ...original, assetId: 'second' } as CanvasNode)
        expect(view.element.querySelector('input')).not.toBe(editor)
        expect(editor.isConnected).toBe(false)
        expect(test.disposed).toEqual([type])
        view.destroy()
        view.destroy()
        expect(test.disposed).toEqual([type, type])
        test.shells.destroy()
    })

    it('refreshes operation content without remounting for geometry alone', () => {
        const test = fixture()
        const original = node('operationStatus') as OperationStatusCanvasNode
        const view = test.dom.mount(original)
        document.body.appendChild(view.element)
        const firstElement = view.element
        view.update({ ...original, position: { x: 500, y: 600 } })
        expect(view.element).toBe(firstElement)
        view.update({ ...original, status: 'failed', message: 'Upload failed' })
        expect(view.element).not.toBe(firstElement)
        expect(view.element.isConnected).toBe(true)
        expect(test.disposed).toEqual(['operationStatus'])
        view.destroy()
        view.update(original)
        expect(test.mount).toHaveBeenCalledTimes(2)
        test.shells.destroy()
    })

    it('refreshes branch content in place and updates the media Asset identity', () => {
        const test = fixture()
        const marker = node('branchLine')
        const branch = test.dom.mount(marker)
        const updated = { ...marker, generationRequestId: 'next' } as CanvasNode
        branch.update(updated)
        expect(test.updateBranch).toHaveBeenCalledWith(updated, branch.element)
        for (const type of ['image', 'video', 'audio', 'mediaDocument'] as const) {
            const media = node(type)
            const view = test.dom.mount(media)
            const element = view.element
            view.update({ ...media, assetId: 'second' } as CanvasNode)
            expect(view.element).toBe(element)
            expect(element.dataset.assetId).toBe('second')
            view.destroy()
        }
        branch.destroy()
        test.shells.destroy()
    })

    it('cleans a shell and its listeners if the content factory fails', () => {
        const test = fixture()
        let partial: HTMLElement | undefined
        test.mount.mockImplementationOnce(node => {
            partial = test.shells.create(node).nodeEl
            document.body.appendChild(partial)
            throw new Error('Editor failed')
        })
        expect(() => test.dom.mount(node('document'))).toThrow('Editor failed')
        expect(partial!.isConnected).toBe(false)
        partial!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(test.select).not.toHaveBeenCalled()
        test.shells.destroy()
    })
})
