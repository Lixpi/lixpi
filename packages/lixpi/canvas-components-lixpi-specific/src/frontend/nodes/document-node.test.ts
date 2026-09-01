// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { DocumentCanvasNode } from '@lixpi/constants'
import { WorkspaceNodeShells } from './workspace-node-shells.ts'
import {
    WorkspaceDocumentNodes,
    type WorkspaceDocumentNodesOptions,
    type WorkspaceDocument,
} from './document-node.ts'

const owners: Array<{ destroy: () => void }> = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})
const node: DocumentCanvasNode = { nodeId: 'placement-a', type: 'document', assetId: 'asset', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 200 } }
const loaded = { documentId: 'asset', organizationId: 'organization', title: 'Document', content: { type: 'doc', content: [{ type: 'paragraph' }] } } as WorkspaceDocument

function createFixture() {
    const shells = new WorkspaceNodeShells({
        document,
        getBounds: node => ({ ...node.position, ...node.dimensions }),
        getLayer: () => 1,
        getZoom: () => 1,
        getResizeSettings: () => ({ useZoomCompensatedScaling: false, size: 10, offset: 0, minSize: 5, zoomScaling: { minZoom: 0.4 } }),
        consumeSuppressedClick: () => false,
        select: vi.fn(),
        toggleSelection: vi.fn(),
        startDrag: vi.fn(),
        startResize: vi.fn(),
        onCreate: vi.fn(),
        togglePlayback: vi.fn(),
    })
    const editors: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
    const mountEditor = vi.fn<WorkspaceDocumentNodesOptions['mountEditor']>(options => {
        options.container.textContent = options.document.title
        const editor = { destroy: vi.fn() }
        editors.push(editor)
        return editor
    })
    const onError = vi.fn()
    const nodes = new WorkspaceDocumentNodes(shells, { mountEditor, onError })
    owners.push(nodes, shells)
    return { nodes, shells, mountEditor, onError, editors }
}

describe('WorkspaceDocumentNodes', () => {
    it('waits for content and mounts it once without replacing the shell', () => {
        const fixture = createFixture()
        const element = fixture.nodes.create(node, undefined)
        document.body.append(element)
        expect(element.querySelector('[role="status"]')).not.toBeNull()
        expect(fixture.mountEditor).not.toHaveBeenCalled()
        fixture.nodes.syncDocuments([loaded])
        expect(element.querySelector('[role="status"]')).toBeNull()
        fixture.nodes.syncDocuments([{ ...loaded, title: 'Authority handles this update' }])
        expect(fixture.mountEditor).toHaveBeenCalledOnce()
        expect(element.isConnected).toBe(true)
    })

    it('owns two editors independently when the same Asset has two placements', () => {
        const fixture = createFixture()
        fixture.nodes.create(node, loaded)
        fixture.nodes.create({ ...node, nodeId: 'placement-b' }, loaded)
        expect(fixture.mountEditor).toHaveBeenCalledTimes(2)
        fixture.shells.remove(node.nodeId)
        expect(fixture.editors[0]!.destroy).toHaveBeenCalledOnce()
        expect(fixture.editors[1]!.destroy).not.toHaveBeenCalled()
        fixture.shells.clear()
        fixture.nodes.destroy()
        expect(fixture.editors[0]!.destroy).toHaveBeenCalledOnce()
        expect(fixture.editors[1]!.destroy).toHaveBeenCalledOnce()
    })

    it('ignores late lease callbacks from replaced editors', () => {
        const fixture = createFixture()
        const old = fixture.nodes.create(node, loaded)
        const first = fixture.mountEditor.mock.calls[0]![0]
        first.onLeaseStateChange({ readOnly: true, holderWorkspaceId: 'another-workspace' })
        expect(old.classList.contains('is-asset-lease-read-only')).toBe(true)
        const replacement = fixture.nodes.create(node, loaded)
        expect(first.signal.aborted).toBe(true)
        first.onLeaseStateChange({ readOnly: false })
        expect(old.classList.contains('is-asset-lease-read-only')).toBe(true)
        expect(replacement.classList.contains('is-asset-lease-read-only')).toBe(false)
        const second = fixture.mountEditor.mock.calls[1]![0]
        second.onLeaseStateChange({ readOnly: true })
        expect(second.container.getAttribute('aria-description')).toContain('Read-only: Asset edit lease is held')
        second.onLeaseStateChange({ readOnly: false })
        expect(second.container.hasAttribute('aria-description')).toBe(false)
    })

    it('retries a failed editor without remounting other nodes and disposes the retry listener', () => {
        const fixture = createFixture()
        fixture.mountEditor.mockImplementationOnce(() => {
            throw new Error('Editor failed')
        })
        const element = fixture.nodes.create(node, loaded)
        const retry = element.querySelector<HTMLButtonElement>('.retry-button')!
        expect(element.querySelector('[role="alert"]')).not.toBeNull()
        expect(fixture.onError).toHaveBeenCalledWith(expect.any(Error), node.nodeId)
        retry.click()
        expect(element.querySelector('[role="alert"]')).toBeNull()
        expect(fixture.mountEditor).toHaveBeenCalledTimes(2)
        retry.click()
        expect(fixture.mountEditor).toHaveBeenCalledTimes(2)
        fixture.nodes.destroy()
        fixture.nodes.syncDocuments([loaded])
        expect(fixture.editors[0]!.destroy).toHaveBeenCalledOnce()
        expect(() => fixture.nodes.create(node, loaded)).toThrow('disposed')
    })
})
