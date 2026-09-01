// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
    type CapabilityArtifactCanvasNode,
} from '@lixpi/constants'
import {
    type CapabilityArtifactCanvasHost,
    type CapabilityArtifactFrontendDefinition,
} from '@lixpi/capability-system/frontend'
import {
    type CapabilityArtifactSharedDefinition,
} from '@lixpi/capability-system/shared'
import { WorkspaceNodeShells } from './workspace-node-shells.ts'
import {
    WorkspaceCapabilityNode,
    type WorkspaceCapabilityNodePorts,
} from './capability-artifact-node.ts'

const owners: WorkspaceNodeShells[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
})
const node: CapabilityArtifactCanvasNode = { nodeId: 'artifact', type: 'capabilityArtifact', assetId: 'asset', artifactTypeId: 'test-artifact', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 200 } }
const asset = { assetId: 'asset', organizationId: 'organization' } as Asset
const snapshot = { doc: { type: 'doc' }, version: 3 }

function fixture() {
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
    owners.push(shells)
    const views: Array<{ destroy: ReturnType<typeof vi.fn>; updateDocument: ReturnType<typeof vi.fn> }> = []
    const editors: Array<{ destroy: ReturnType<typeof vi.fn>; updateDocument: ReturnType<typeof vi.fn> }> = []
    const createCanvasNodeView = vi.fn<CapabilityArtifactFrontendDefinition['createCanvasNodeView']>(() => {
        const view = { destroy: vi.fn(), updateDocument: vi.fn() }
        views.push(view)
        return view
    })
    const collectReferencedAssetIds = vi.fn(() => [] as string[])
    const shared = { assertInitialDocument: vi.fn(), collectReferencedAssetIds } as unknown as CapabilityArtifactSharedDefinition
    const frontend = { createCanvasNodeView } as unknown as CapabilityArtifactFrontendDefinition
    const ports = {
        ensureStyles: vi.fn(),
        getAsset: vi.fn<WorkspaceCapabilityNodePorts['getAsset']>(() => asset),
        getDocument: vi.fn<WorkspaceCapabilityNodePorts['getDocument']>(() => snapshot),
        refreshAsset: vi.fn<WorkspaceCapabilityNodePorts['refreshAsset']>(async () => asset),
        ensureAssetsLoaded: vi.fn<WorkspaceCapabilityNodePorts['ensureAssetsLoaded']>(async () => []),
        getDefinitions: vi.fn(() => ({ shared, frontend })),
        createAssetReferenceView: vi.fn<WorkspaceCapabilityNodePorts['createAssetReferenceView']>(),
        mountEditor: vi.fn<WorkspaceCapabilityNodePorts['mountEditor']>(() => {
            const editor = { destroy: vi.fn(), updateDocument: vi.fn() }
            editors.push(editor)
            return editor
        }),
        onHeightChange: vi.fn(),
        onError: vi.fn(),
    }
    const mount = () => {
        const view = new WorkspaceCapabilityNode(node, shells, ports)
        document.body.append(view.element)
        return view
    }
    return { shells, ports, mount, createCanvasNodeView, shared, collectReferencedAssetIds, views, editors }
}

function mountEditor(host: CapabilityArtifactCanvasHost) {
    return host.mountEditor!({ container: host.container, document: host.document, schema: {} as never, plugins: [] })
}

describe('WorkspaceCapabilityNode', () => {
    it('hosts the supplied module factory without a concrete Capability import', () => {
        const test = fixture()
        test.mount()
        expect(test.ports.ensureStyles).toHaveBeenCalledWith(document)
        expect(test.ports.getDefinitions).toHaveBeenCalledWith('test-artifact')
        expect(test.shared.assertInitialDocument).toHaveBeenCalledWith(snapshot.doc)
        expect(test.createCanvasNodeView).toHaveBeenCalledWith(expect.objectContaining({ node, document: snapshot.doc }))
        test.shells.clear()
        expect(test.views[0]!.destroy).toHaveBeenCalledOnce()
    })

    it('loads missing metadata and lineage references before mounting', async () => {
        const test = fixture()
        test.ports.getAsset.mockReturnValueOnce(undefined)
        test.ports.refreshAsset.mockResolvedValue({ ...asset, lineage: { sourceAssetIds: ['source'] } } as Asset)
        const view = test.mount()
        expect(view.element.querySelector('[role="status"]')).not.toBeNull()
        await vi.waitFor(() => expect(test.createCanvasNodeView).toHaveBeenCalledOnce())
        expect(test.ports.ensureAssetsLoaded).toHaveBeenCalledWith(['source'])
        expect(view.element.querySelector('[role="status"]')).toBeNull()
    })

    it('ignores an Asset response after shell disposal', async () => {
        const test = fixture()
        const pending = Promise.withResolvers<Asset>()
        test.ports.getAsset.mockReturnValue(undefined)
        test.ports.refreshAsset.mockReturnValue(pending.promise)
        test.mount()
        test.shells.clear()
        pending.resolve(asset)
        await pending.promise
        expect(test.createCanvasNodeView).not.toHaveBeenCalled()
        expect(test.ports.ensureAssetsLoaded).not.toHaveBeenCalled()
    })

    it('disposes editors and references exactly once even when the factory also owns them', () => {
        const test = fixture()
        const reference = { dom: document.createElement('span'), destroy: vi.fn() }
        test.ports.createAssetReferenceView.mockReturnValue(reference)
        test.createCanvasNodeView.mockImplementation(host => {
            const editor = mountEditor(host)
            const ref = host.createAssetReferenceView({ assetId: 'reference', variant: 'inline' })!
            return {
                destroy: () => {
                    editor.destroy()
                    ref.destroy()
                },
                updateDocument: vi.fn(),
            }
        })
        const view = test.mount()
        const editorOptions = test.ports.mountEditor.mock.calls[0]![0]
        editorOptions.onLeaseStateChange({ readOnly: true })
        expect(view.element.classList.contains('is-asset-lease-read-only')).toBe(true)
        test.shells.clear()
        view.destroy()
        expect(test.editors[0]!.destroy).toHaveBeenCalledOnce()
        expect(reference.destroy).toHaveBeenCalledOnce()
        expect(editorOptions.signal.aborted).toBe(true)
        editorOptions.onLeaseStateChange({ readOnly: false })
        expect(view.element.classList.contains('is-asset-lease-read-only')).toBe(true)
    })

    it('cleans partial editor mounting when the module factory throws and can retry', () => {
        const test = fixture()
        test.createCanvasNodeView.mockImplementationOnce(host => {
            mountEditor(host)
            throw new Error('Factory failed')
        })
        const view = test.mount()
        expect(test.editors[0]!.destroy).toHaveBeenCalledOnce()
        expect(test.ports.onError).toHaveBeenCalledWith(expect.any(Error), node.nodeId)
        view.element.querySelector<HTMLButtonElement>('.retry-button')!.click()
        expect(test.createCanvasNodeView).toHaveBeenCalledTimes(2)
        expect(view.element.querySelector('[role="alert"]')).toBeNull()
    })

    it('cancels coalesced height work and ignores a queued callback after disposal', () => {
        const frames: FrameRequestCallback[] = []
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback)
                return frames.length
            }),
        )
        const cancel = vi.fn()
        vi.stubGlobal('cancelAnimationFrame', cancel)
        const test = fixture()
        test.mount()
        const host = test.createCanvasNodeView.mock.calls[0]![0]
        host.onHeightChange(200)
        host.onHeightChange(300)
        expect(cancel).toHaveBeenCalledWith(1)
        test.shells.clear()
        expect(cancel).toHaveBeenCalledWith(2)
        frames[1]!(0)
        host.onHeightChange(400)
        expect(test.ports.onHeightChange).not.toHaveBeenCalled()
        expect(frames).toHaveLength(2)
    })
})
