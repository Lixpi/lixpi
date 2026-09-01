// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { Asset } from '@lixpi/constants'
import {
    WorkspaceAssetMetadataEditor,
    WorkspaceAssetContentEditor,
    buildAssetMetadataEditorDocument,
    readAssetMetadataEditorDocument,
    type WorkspaceAssetEditorPorts,
    type WorkspaceAssetEditorRequest,
} from './workspace-asset-editors.ts'

const owners: Array<{ destroy: () => void }> = []
function fixture() {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let current = { assetId: 'asset', title: 'Original', revision: 1, descriptor: { summary: 'Description', version: 3, status: 'ready' } } as Asset
    const requests: WorkspaceAssetEditorRequest[] = []
    const disposers: ReturnType<typeof vi.fn>[] = []
    const ports: WorkspaceAssetEditorPorts = {
        getAsset: () => current,
        mountEditor: request => {
            requests.push(request)
            const destroy = vi.fn()
            disposers.push(destroy)
            return { destroy }
        },
        updateMetadata: vi.fn(async (_id, _revision, patch) => {
            current = { ...current, ...patch, revision: current.revision + 1 }
            return current
        }),
        onChanged: vi.fn(),
        onError: vi.fn(),
    }
    const editor = new WorkspaceAssetMetadataEditor('asset', host, 'details', ports)
    owners.push(editor)
    const change = (title: string, description = 'Description') => requests[0]!.onChange(buildAssetMetadataEditorDocument({ ...current, title, descriptor: { ...current.descriptor!, summary: description } }, 'details'))
    const blur = (relatedTarget: EventTarget | null = null) => host.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }))
    return {
        host,
        ports,
        editor,
        requests,
        disposers,
        change,
        blur,
        getAsset: () => current,
        setAsset: (asset: Asset) => {
            current = asset
        },
    }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('Workspace Asset editors', () => {
    it('keeps descriptions out of title-only drafts and preserves empty paragraph edits', () => {
        const asset = { title: ' Title ', descriptor: { summary: ' Description ' } } as Asset
        expect(readAssetMetadataEditorDocument(buildAssetMetadataEditorDocument(asset, 'node'))).toEqual({ title: 'Title' })
        expect(readAssetMetadataEditorDocument(buildAssetMetadataEditorDocument(asset, 'details'))).toEqual({ title: 'Title', description: 'Description' })
        expect(readAssetMetadataEditorDocument(buildAssetMetadataEditorDocument({ ...asset, descriptor: { ...asset.descriptor!, summary: '' } }, 'details'))).toEqual({ title: 'Title', description: '' })
    })

    it('commits on focus leaving the editor, preserving descriptor fields and the current revision', async () => {
        const f = fixture()
        const child = document.createElement('input')
        f.host.appendChild(child)
        f.change('Changed', '')
        f.blur(child)
        expect(f.ports.updateMetadata).not.toHaveBeenCalled()
        f.blur()
        await vi.waitFor(() => expect(f.ports.onChanged).toHaveBeenCalledOnce())
        expect(f.ports.updateMetadata).toHaveBeenCalledWith('asset', 1, { title: 'Changed', descriptor: expect.objectContaining({ summary: '', version: 3, status: 'ready', updatedAt: expect.any(Number) }) })
        f.blur()
        expect(f.ports.updateMetadata).toHaveBeenCalledOnce()
        f.change(' ')
        f.blur()
        expect(f.ports.updateMetadata).toHaveBeenCalledOnce()
    })

    it('serializes edits made while an earlier blur save is pending', async () => {
        const f = fixture()
        const first = Promise.withResolvers<Asset>()
        let calls = 0
        const update = vi.fn(async (_id: string, _revision: number, patch: { title: string }) => {
            const asset = ++calls === 1 ? await first.promise : { ...f.getAsset(), ...patch, revision: 3 }
            f.setAsset(asset)
            return asset
        })
        f.ports.updateMetadata = update
        f.change('First')
        f.blur()
        f.change('Second')
        f.blur()
        expect(update).toHaveBeenCalledOnce()
        first.resolve({ ...f.getAsset(), title: 'First', revision: 2 })
        await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
        expect(update.mock.calls[1]).toEqual(['asset', 2, expect.objectContaining({ title: 'Second' })])
        expect(f.getAsset().title).toBe('Second')
    })

    it.each(['resolve', 'reject'] as const)('ignores a late %s after disposal without cancelling the submitted write', async outcome => {
        const f = fixture()
        const pending = Promise.withResolvers<Asset>()
        f.ports.updateMetadata = vi.fn(() => pending.promise)
        f.change('Changed')
        f.blur()
        f.editor.destroy()
        expect(f.requests[0]!.signal.aborted).toBe(true)
        expect(f.disposers[0]).toHaveBeenCalledOnce()
        f.change('Late')
        f.blur()
        if (outcome === 'resolve') pending.resolve({ ...f.getAsset(), title: 'Changed', revision: 2 })
        else pending.reject(new Error('Disconnected'))
        await Promise.allSettled([pending.promise])
        expect(f.ports.updateMetadata).toHaveBeenCalledOnce()
        expect(f.ports.onChanged).not.toHaveBeenCalled()
        expect(f.ports.onError).not.toHaveBeenCalled()
    })

    it('reports rejected metadata and allows another save', async () => {
        const f = fixture()
        f.ports.updateMetadata = vi.fn().mockResolvedValueOnce({ error: 'Revision changed' }).mockResolvedValueOnce(f.getAsset())
        f.change('Changed')
        f.blur()
        await vi.waitFor(() => expect(f.ports.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Revision changed' })))
        f.blur()
        await vi.waitFor(() => expect(f.ports.onChanged).toHaveBeenCalledOnce())
    })

    it('scopes content lease callbacks to their editor lifetime', () => {
        const host = document.createElement('div')
        let request: WorkspaceAssetEditorRequest | undefined
        const destroy = vi.fn()
        const editor = new WorkspaceAssetContentEditor(host, { type: 'doc' }, { organizationId: 'org', workspaceId: 'workspace', assetId: 'asset', role: 'content', baseVersion: 7 }, value => {
            request = value
            return { destroy }
        })
        owners.push(editor)
        expect(request?.authority?.baseVersion).toBe(7)
        request?.authority?.onLeaseStateChange({ readOnly: true, holderWorkspaceId: 'another' })
        expect(host.getAttribute('aria-description')).toBe('Read-only; lease held by another')
        expect(host.classList.contains('is-read-only')).toBe(true)
        editor.destroy()
        request?.authority?.onLeaseStateChange({ readOnly: false })
        expect(host.classList.contains('is-read-only')).toBe(true)
        expect(request?.signal.aborted).toBe(true)
        expect(destroy).toHaveBeenCalledOnce()
    })
})
