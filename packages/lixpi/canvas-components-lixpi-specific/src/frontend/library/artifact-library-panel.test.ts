// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type {
    Asset,
    AssetMeta,
} from '@lixpi/constants'
import type { CapabilityArtifactFrontendDefinition } from '@lixpi/capability-system/frontend'
import type { CapabilityArtifactSharedDefinition } from '@lixpi/capability-system/shared'
import {
    createArtifactLibraryPanel,
    type ArtifactLibraryPanelInstance,
    type ArtifactLibraryPanelOptions,
} from './artifact-library-panel.ts'

const owners: ArtifactLibraryPanelInstance[] = []
function fixture() {
    const meta = { assetId: 'a', title: 'Artifact', scope: 'workspace', scopeOwnerId: 'w', primaryCategory: 'capabilityArtifact', artifactTypeId: 'test-artifact', updatedAt: 1 } as AssetMeta
    const asset = { ...meta, organizationId: 'org', revision: 7, artifact: { artifactTypeId: 'test-artifact', schemaVersion: '1' }, documents: { capabilityArtifact: {}, provenance: {} }, states: { lifecycle: 'active' }, generatedOutputReview: { status: 'candidate' } } as Asset
    const views: ReturnType<typeof vi.fn>[] = []
    const frontend = {
        createLibraryItemView: vi.fn(({ container, title, onAddToCanvas }) => {
            const button = document.createElement('button')
            button.textContent = title
            button.addEventListener('click', onAddToCanvas)
            container.appendChild(button)
            const destroy = vi.fn(() => {
                button.removeEventListener('click', onAddToCanvas)
                button.remove()
            })
            views.push(destroy)
            return { destroy }
        }),
        createGeneratedOutputInfoView: vi.fn(({ container }) => {
            container.textContent = 'Registered detail'
            const destroy = vi.fn(() => container.replaceChildren())
            views.push(destroy)
            return { destroy }
        }),
    } as unknown as CapabilityArtifactFrontendDefinition
    const shared = { schemaVersion: '1', assertInitialDocument: vi.fn(), buildCatalogMetadata: vi.fn(() => ({ summary: 'Structured' })) } as unknown as CapabilityArtifactSharedDefinition
    const options: ArtifactLibraryPanelOptions = {
        document,
        workspaceId: 'w',
        userId: 'u',
        onError: vi.fn(),
        ensureStyles: vi.fn(),
        frontendRegistry: { get: () => frontend, require: () => frontend },
        sharedRegistry: { get: () => shared },
        assets: {
            list: vi.fn(async () => ({ items: [meta] })),
            get: vi.fn(async () => asset),
            refresh: vi.fn(async () => asset),
            updateMetadata: vi.fn(async () => asset),
            changeScope: vi.fn(async () => asset),
            resumeDocument: vi.fn(async () => {}),
            getDocument: vi.fn(() => ({ doc: {}, version: 1 })),
        },
        mountHistory: vi.fn(() => {
            const destroy = vi.fn()
            views.push(destroy)
            return { destroy }
        }),
        onInsertAsset: vi.fn(async () => true),
        onAcceptAsset: vi.fn(async () => true),
    }
    const panel = createArtifactLibraryPanel(options)
    owners.push(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = () => panel.mountInto(host)
    const inspect = async () => {
        panel.showAsset('a')
        await vi.waitFor(() => expect(options.mountHistory).toHaveBeenCalled())
    }
    return { panel, options, meta, asset, frontend, shared, views, host, mount, inspect }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('Artifact library ownership', () => {
    it('loads available scopes across pages and delegates metadata and views to the registered definition', async () => {
        const f = fixture()
        vi.mocked(f.options.assets.list).mockResolvedValueOnce({ items: [f.meta], cursor: 'next' }).mockResolvedValueOnce({ items: [{ ...f.meta, assetId: 'foreign', scopeOwnerId: 'elsewhere' }] })
        f.mount()
        await vi.waitFor(() => expect(f.frontend.createLibraryItemView).toHaveBeenCalledOnce())
        expect(f.options.assets.list).toHaveBeenLastCalledWith({ workspaceId: 'w', primaryCategory: 'capabilityArtifact', limit: 100, cursor: 'next' })
        expect(f.shared.assertInitialDocument).toHaveBeenCalledWith({})
        expect(f.shared.buildCatalogMetadata).toHaveBeenCalledWith({})
        const inspectButton = f.panel.rootEl.querySelector<HTMLButtonElement>('[data-action="inspect"]')!
        expect(inspectButton.classList.contains('capability-library-row-action')).toBe(true)
        expect(inspectButton.classList.contains('capability-library-row-action-primary')).toBe(false)
        f.panel.rootEl.querySelector<HTMLButtonElement>('.artifact-library-item-host button')!.click()
        await vi.waitFor(() => expect(f.options.onInsertAsset).toHaveBeenCalledWith(f.meta))
        await f.inspect()
        expect(f.frontend.createGeneratedOutputInfoView).toHaveBeenCalledOnce()
        expect(f.options.mountHistory).toHaveBeenCalledWith(expect.objectContaining({ asset: f.asset, content: {}, signal: expect.any(AbortSignal) }))
    })

    it('preserves review actions and captures workspace, user and organization scope owners', async () => {
        const f = fixture()
        f.mount()
        await vi.waitFor(() => expect(f.frontend.createLibraryItemView).toHaveBeenCalledOnce())
        await f.inspect()
        for (const [scope, owner] of [['user', 'u'], ['organization', 'org'], ['workspace', 'w']]) {
            const select = f.panel.rootEl.querySelector<HTMLSelectElement>('select')!
            select.value = scope
            select.dispatchEvent(new Event('change'))
            await vi.waitFor(() => expect(f.options.assets.changeScope).toHaveBeenLastCalledWith('a', 7, scope, owner))
            await vi.waitFor(() => {
                const replacement = f.panel.rootEl.querySelector('select')
                expect(replacement).not.toBeNull()
                expect(replacement).not.toBe(select)
            })
        }
        const acceptButton = f.panel.rootEl.querySelector<HTMLButtonElement>('.artifact-library-detail-review button')!
        expect(acceptButton.classList.contains('capability-library-row-action')).toBe(true)
        expect(acceptButton.classList.contains('capability-library-row-action-primary')).toBe(true)
        acceptButton.click()
        await vi.waitFor(() => expect(f.options.onAcceptAsset).toHaveBeenCalledWith(f.asset))
    })

    it('does not continue paginating or mount views after destruction', async () => {
        const f = fixture()
        const page = Promise.withResolvers<{ items: AssetMeta[]; cursor?: string }>()
        vi.mocked(f.options.assets.list).mockReturnValue(page.promise)
        f.mount()
        f.panel.destroy()
        page.resolve({ items: [f.meta], cursor: 'next' })
        await page.promise
        expect(f.options.assets.list).toHaveBeenCalledOnce()
        expect(f.options.assets.refresh).not.toHaveBeenCalled()
        f.mount()
        expect(f.panel.rootEl.isConnected).toBe(false)
    })

    it('rejects an old inspector response after selecting the same asset again', async () => {
        const f = fixture()
        f.mount()
        await vi.waitFor(() => expect(f.frontend.createLibraryItemView).toHaveBeenCalledOnce())
        const first = Promise.withResolvers<Asset>()
        vi.mocked(f.options.assets.refresh).mockReturnValueOnce(first.promise)
        f.panel.showAsset('a')
        f.panel.showAsset('a')
        await vi.waitFor(() => expect(f.frontend.createGeneratedOutputInfoView).toHaveBeenCalledOnce())
        first.resolve(f.asset)
        await first.promise
        expect(f.frontend.createGeneratedOutputInfoView).toHaveBeenCalledOnce()
    })

    it('disposes only its own registered children and history, then suppresses accepted-write UI callbacks', async () => {
        const first = fixture()
        const second = fixture()
        first.mount()
        second.mount()
        await vi.waitFor(() => expect(first.frontend.createLibraryItemView).toHaveBeenCalledOnce())
        await first.inspect()
        await second.inspect()
        const write = Promise.withResolvers<Asset>()
        vi.mocked(first.options.assets.updateMetadata).mockReturnValue(write.promise)
        const input = first.panel.rootEl.querySelector<HTMLInputElement>('input')!
        input.value = 'Renamed'
        input.dispatchEvent(new Event('change'))
        const loadCount = vi.mocked(first.options.assets.list).mock.calls.length
        first.panel.destroy()
        for (const destroy of first.views) expect(destroy).toHaveBeenCalledOnce()
        expect(second.panel.rootEl.isConnected).toBe(true)
        write.resolve({ ...first.asset, title: 'Renamed' })
        await write.promise
        expect(first.options.assets.list).toHaveBeenCalledTimes(loadCount)
        input.dispatchEvent(new Event('change'))
        expect(first.options.assets.updateMetadata).toHaveBeenCalledOnce()
    })
})
