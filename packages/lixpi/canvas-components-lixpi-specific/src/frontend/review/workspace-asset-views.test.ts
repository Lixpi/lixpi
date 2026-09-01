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
    type ImageCanvasNode,
} from '@lixpi/constants'
import { WorkspaceAssetViews } from './workspace-asset-views.ts'
import {
    type WorkspaceAssetDetailsPorts,
} from './workspace-asset-details.ts'
import {
    type WorkspaceAssetEditorRequest,
} from './workspace-asset-editors.ts'

const node: ImageCanvasNode = { nodeId: 'node', type: 'image', assetId: 'asset', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } }
const owners: WorkspaceAssetViews[] = []
function fixture() {
    let asset = {
        assetId: 'asset',
        organizationId: 'org',
        title: 'Asset',
        revision: 1,
        scope: 'workspace',
        subjectIdentity: { classification: 'unknown' },
        states: { lifecycle: 'active', media: 'ready', provenance: 'generated' },
        documents: { content: {} },
        media: { renditions: { original: { status: 'ready' } } },
        lineage: { sourceConversationAssetId: 'conversation', parentAssetId: 'parent', sourceAssetIds: ['reference'], generationSeed: 0 },
    } as Asset
    const requests: WorkspaceAssetEditorRequest[] = []
    const disposers: ReturnType<typeof vi.fn>[] = []
    const ports: WorkspaceAssetDetailsPorts = {
        document,
        workspaceId: 'workspace',
        userId: 'user',
        tooltipHideDelayMs: 100,
        getAsset: () => asset,
        getContentDocument: () => ({ doc: { type: 'doc', content: [] }, version: 7 }),
        mountEditor: request => {
            requests.push(request)
            const destroy = vi.fn()
            disposers.push(destroy)
            return { destroy }
        },
        updateMetadata: vi.fn(async () => asset),
        changeScope: vi.fn(async (_id, _revision, scope) => {
            asset = { ...asset, scope, revision: asset.revision + 1 }
            return asset
        }),
        attestSubjectIdentity: vi.fn(async (_id, _revision, classification) => {
            asset = { ...asset, subjectIdentity: { ...asset.subjectIdentity, classification } }
            return asset
        }),
        onChanged: vi.fn(),
        onError: vi.fn(),
    }
    const views = new WorkspaceAssetViews(() => ports)
    owners.push(views)
    const mount = () => {
        const element = views.createDetails(node)!
        document.body.appendChild(element)
        return element
    }
    return {
        views,
        ports,
        mount,
        requests,
        disposers,
        getAsset: () => asset,
        setAsset: (next: Asset) => {
            asset = next
        },
    }
}
function choose(element: HTMLElement, title: string) {
    const option = [...element.querySelectorAll<HTMLElement>('.canvas-asset-scope-dropdown .dropdown-option-item')].find(option => option.textContent?.trim() === title)
    expect(option).toBeDefined()
    option!.click()
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('WorkspaceAssetViews', () => {
    it('renders rendition state, lineage, seed zero and a leased content editor', () => {
        const f = fixture()
        const element = f.mount()
        expect(element.querySelector('.canvas-asset-renditions')?.textContent).toBe('original: ready')
        expect(element.querySelector('.canvas-asset-seed')?.textContent).toBe('0')
        expect(element.querySelector('.canvas-asset-lineage')?.textContent).toBe('conversation conversation\nparent parent\nsource reference')
        expect(f.requests[0]?.authority).toMatchObject({ workspaceId: 'workspace', assetId: 'asset', role: 'content', baseVersion: 7 })
        f.views.clear()
        expect(f.requests[0]?.signal.aborted).toBe(true)
        expect(f.disposers[0]).toHaveBeenCalledOnce()
        expect(element.isConnected).toBe(false)
    })

    it('shows document roles for artifacts and omits an absent seed', () => {
        const f = fixture()
        f.setAsset({ ...f.getAsset(), lineage: undefined })
        const element = f.views.createDetails({ ...node, type: 'capabilityArtifact', artifactTypeId: 'artifact' })!
        expect(element.querySelector('.canvas-asset-storage-label')?.textContent).toBe('Documents')
        expect(element.querySelector('.canvas-asset-renditions')?.textContent).toBe('content')
        expect(element.querySelector('.canvas-asset-seed-row')).toBeNull()
    })

    it('sends scope changes to the correct owner with the latest Asset revision', async () => {
        const f = fixture()
        const element = f.mount()
        choose(element, 'Mine')
        await vi.waitFor(() => expect(f.ports.onChanged).toHaveBeenCalledOnce())
        expect(f.ports.changeScope).toHaveBeenLastCalledWith('asset', 1, 'user', 'user')
        choose(element, 'Organization')
        await vi.waitFor(() => expect(f.ports.onChanged).toHaveBeenCalledTimes(2))
        expect(f.ports.changeScope).toHaveBeenLastCalledWith('asset', 2, 'organization', 'org')
        choose(element, 'Workspace')
        await vi.waitFor(() => expect(f.ports.onChanged).toHaveBeenCalledTimes(3))
        expect(f.ports.changeScope).toHaveBeenLastCalledWith('asset', 3, 'workspace', 'workspace')
    })

    it('serializes scope changes and restores selection after a failed mutation', async () => {
        const f = fixture()
        const pending = Promise.withResolvers<{ error: string }>()
        f.ports.changeScope = vi.fn(() => pending.promise)
        const element = f.mount()
        choose(element, 'Mine')
        choose(element, 'Organization')
        expect(f.ports.changeScope).toHaveBeenCalledOnce()
        pending.resolve({ error: 'Revision changed' })
        await vi.waitFor(() => expect(element.querySelector('.canvas-asset-details-status')?.textContent).toBe('Scope update failed: Revision changed'))
        expect(element.querySelector('.canvas-asset-scope-dropdown button')?.textContent).toContain('Workspace')
        expect(f.ports.onChanged).not.toHaveBeenCalled()
    })

    it('does not update a removed view after a submitted scope write finishes', async () => {
        const f = fixture()
        const pending = Promise.withResolvers<Asset>()
        f.ports.changeScope = vi.fn(async () => {
            const updated = await pending.promise
            f.setAsset(updated)
            return updated
        })
        const element = f.mount()
        choose(element, 'Mine')
        f.views.destroy()
        pending.resolve({ ...f.getAsset(), scope: 'user', revision: 2 })
        await pending.promise
        expect(f.getAsset().scope).toBe('user')
        expect(f.ports.onChanged).not.toHaveBeenCalled()
        expect(element.isConnected).toBe(false)
        expect(f.views.createDetails(node)).toBeNull()
    })

    it('owns duplicate Asset placements independently and disposes replaced views', () => {
        const first = fixture()
        const second = fixture()
        const a = first.mount()
        const b = second.mount()
        expect(a.querySelector('[data-dropdown-id]')?.getAttribute('data-dropdown-id')).not.toBe(b.querySelector('[data-dropdown-id]')?.getAttribute('data-dropdown-id'))
        const replacement = first.mount()
        expect(a.isConnected).toBe(false)
        expect(replacement.isConnected).toBe(true)
        expect(first.disposers[0]).toHaveBeenCalledOnce()
        expect(second.disposers[0]).not.toHaveBeenCalled()
        first.views.destroy()
        expect(b.isConnected).toBe(true)
        expect(second.requests[0]?.signal.aborted).toBe(false)
    })

    it('aborts a failed content mount and permits a later replacement', () => {
        const f = fixture()
        const mount = f.ports.mountEditor
        let signal: AbortSignal | undefined
        f.ports.mountEditor = request => {
            signal = request.signal
            throw new Error('editor unavailable')
        }
        expect(() => f.views.createDetails(node)).toThrow('editor unavailable')
        expect(signal?.aborted).toBe(true)
        f.ports.mountEditor = mount
        expect(f.views.createDetails(node)).not.toBeNull()
    })
})
