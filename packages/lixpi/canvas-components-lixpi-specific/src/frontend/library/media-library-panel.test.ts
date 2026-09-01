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
import type { WorkspaceAssetEditorRequest } from '../review/workspace-asset-editors.ts'
import {
    createMediaLibraryPanel,
    formatMediaFileSize,
    stripMediaFileExtension,
    type MediaLibraryPanelOptions,
    type MediaLibraryPanelInstance,
} from './media-library-panel.ts'

const owners: MediaLibraryPanelInstance[] = []
function fixture() {
    const meta = { assetId: 'a', title: 'Reference.png', scope: 'workspace', scopeOwnerId: 'w', scopeAndOwner: 'workspace#w', primaryCategory: 'image', updatedAt: 1, thumbnailBlobHash: 'hash', byteSize: 2048 } as AssetMeta
    const asset = { ...meta, organizationId: 'org', revision: 3, documents: { content: {}, provenance: {} }, states: { lifecycle: 'active', media: 'ready', provenance: 'generated' }, subjectIdentity: { classification: 'unknown' }, media: { kind: 'image', renditions: {} }, lineage: { sourceConversationAssetId: 'conversation', sourceAssetIds: [], generationSeed: 0 } } as Asset
    const editors: WorkspaceAssetEditorRequest[] = []
    const disposers: ReturnType<typeof vi.fn>[] = []
    const options: MediaLibraryPanelOptions = {
        document,
        workspaceId: 'w',
        userId: 'u',
        tooltipHideDelayMs: 0,
        onError: vi.fn(),
        assets: {
            list: vi.fn(async () => ({ items: [meta] })),
            get: vi.fn(async () => asset),
            refresh: vi.fn(async () => asset),
            updateMetadata: vi.fn(async () => asset),
            changeScope: vi.fn(async () => asset),
            resumeDocument: vi.fn(async () => {}),
            getDocument: vi.fn(() => ({ doc: { type: 'doc', content: [] }, version: 9 })),
        },
        prepareRenditionUrls: vi.fn(async () => (id, rendition) => `https://media.test/${id}/${rendition}?token=encoded`),
        mountHistory: vi.fn(() => {
            const destroy = vi.fn()
            disposers.push(destroy)
            return { destroy }
        }),
        mountEditor: vi.fn(request => {
            editors.push(request)
            const destroy = vi.fn()
            disposers.push(destroy)
            return { destroy }
        }),
        attestSubjectIdentity: vi.fn(async () => asset),
        removeFromLibrary: vi.fn(async () => ({})),
        onInsertAsset: vi.fn(async () => true),
    }
    const panel = createMediaLibraryPanel(options)
    owners.push(panel)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = () => panel.mountInto(host)
    const ready = async () => {
        await vi.waitFor(() => expect(panel.rootEl.querySelector('.capability-library-row')).not.toBeNull())
    }
    const inspect = async () => {
        panel.showAsset('a')
        await vi.waitFor(() => expect(options.mountHistory).toHaveBeenCalled())
    }
    return { options, panel, host, meta, asset, editors, disposers, mount, ready, inspect }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('Media library ownership', () => {
    it('deduplicates catalog pages, excludes foreign and non-media Assets and uses the authorized rendition port', async () => {
        const f = fixture()
        vi.mocked(f.options.assets.list).mockResolvedValueOnce({ items: [f.meta], cursor: 'next' }).mockResolvedValueOnce({ items: [f.meta, { ...f.meta, assetId: 'foreign', scopeOwnerId: 'other' }, { ...f.meta, assetId: 'conversation', primaryCategory: 'conversation' }, { ...f.meta, assetId: 'artifact', primaryCategory: 'capabilityArtifact' }] })
        f.mount()
        await f.ready()
        expect(f.panel.rootEl.querySelectorAll('.capability-library-row')).toHaveLength(1)
        expect(f.panel.rootEl.querySelector('img')?.src).toBe('https://media.test/a/thumbnail?token=encoded')
        expect(f.panel.rootEl.querySelector('.capability-library-row-name')?.textContent).toBe('Reference')
        const insertButton = f.panel.rootEl.querySelector<HTMLButtonElement>('[data-action="insert"]')!
        expect(insertButton.classList.contains('capability-library-row-action')).toBe(true)
        expect(insertButton.classList.contains('capability-library-row-action-primary')).toBe(true)
        insertButton.click()
        await vi.waitFor(() => expect(f.options.onInsertAsset).toHaveBeenCalledWith(f.meta))
    })

    it('mounts content with captured lease authority and sealed history, then disposes both on unmount', async () => {
        const f = fixture()
        f.mount()
        await f.ready()
        await f.inspect()
        expect(f.editors[0]?.authority).toMatchObject({ workspaceId: 'w', assetId: 'a', role: 'content', baseVersion: 9 })
        expect(f.options.mountHistory).toHaveBeenCalledWith(expect.objectContaining({ asset: f.asset, content: { type: 'doc', content: [] } }))
        expect(f.panel.rootEl.querySelector('.media-library-detail-seed')?.textContent).toContain('Seed: 0')
        const host = f.editors[0]!.host
        f.editors[0]!.authority!.onLeaseStateChange({ readOnly: true, holderWorkspaceId: 'other' })
        expect(host.getAttribute('aria-description')).toContain('other')
        f.panel.unmount()
        expect(f.editors[0]!.signal.aborted).toBe(true)
        for (const dispose of f.disposers) expect(dispose).toHaveBeenCalledOnce()
        f.editors[0]!.authority!.onLeaseStateChange({ readOnly: false })
        expect(host.getAttribute('aria-description')).toContain('other')
        f.mount()
        await vi.waitFor(() => expect(f.options.mountEditor).toHaveBeenCalledTimes(2))
    })

    it('does not mount a pending document or continue authorization after disposal', async () => {
        const f = fixture()
        const auth = Promise.withResolvers<(id: string, rendition: string) => string>()
        vi.mocked(f.options.prepareRenditionUrls).mockReturnValue(auth.promise)
        f.mount()
        f.panel.destroy()
        auth.resolve(() => '/media')
        await auth.promise
        expect(f.options.assets.list).not.toHaveBeenCalled()
        const second = fixture()
        second.mount()
        await second.ready()
        const resume = Promise.withResolvers<void>()
        vi.mocked(second.options.assets.resumeDocument).mockReturnValueOnce(resume.promise)
        second.panel.showAsset('a')
        await vi.waitFor(() => expect(second.options.assets.resumeDocument).toHaveBeenCalledOnce())
        second.panel.unmount()
        resume.resolve()
        await resume.promise
        expect(second.options.mountEditor).not.toHaveBeenCalled()
        expect(second.options.mountHistory).not.toHaveBeenCalled()
    })

    it('cannot mount an obsolete inspector after a refresh of the same Asset', async () => {
        const f = fixture()
        f.mount()
        await f.ready()
        const first = Promise.withResolvers<Asset>()
        vi.mocked(f.options.assets.get).mockReturnValueOnce(first.promise)
        f.panel.showAsset('a')
        f.panel.refresh()
        await vi.waitFor(() => expect(f.options.mountEditor).toHaveBeenCalledOnce())
        first.resolve(f.asset)
        await first.promise
        expect(f.options.mountEditor).toHaveBeenCalledOnce()
    })

    it('captures scope before the revision read and does not submit a write from a replaced inspector', async () => {
        const f = fixture()
        f.mount()
        await f.ready()
        await f.inspect()
        const select = f.panel.rootEl.querySelector<HTMLSelectElement>('select')!
        const read = Promise.withResolvers<Asset>()
        vi.mocked(f.options.assets.get).mockReturnValueOnce(read.promise)
        select.value = 'user'
        select.dispatchEvent(new Event('change'))
        select.value = 'organization'
        read.resolve({ ...f.asset, revision: 8 })
        await vi.waitFor(() => expect(f.options.assets.changeScope).toHaveBeenCalledWith('a', 8, 'user', 'u'))
        const nextRead = Promise.withResolvers<Asset>()
        vi.mocked(f.options.assets.get).mockReturnValueOnce(nextRead.promise)
        select.dispatchEvent(new Event('change'))
        f.panel.unmount()
        nextRead.resolve(f.asset)
        await nextRead.promise
        expect(f.options.assets.changeScope).toHaveBeenCalledOnce()
    })

    it('keeps two panels independent and removes listeners from obsolete rows', async () => {
        const first = fixture()
        const second = fixture()
        first.mount()
        second.mount()
        await first.ready()
        await second.ready()
        const oldButton = first.panel.rootEl.querySelector<HTMLButtonElement>('[data-action="insert"]')!
        first.panel.destroy()
        oldButton.click()
        expect(first.options.onInsertAsset).not.toHaveBeenCalled()
        second.panel.rootEl.querySelector<HTMLButtonElement>('[data-action="insert"]')!.click()
        expect(second.options.onInsertAsset).toHaveBeenCalledOnce()
    })

    it('preserves filename and size formatting', () => {
        expect(stripMediaFileExtension('reference.image.png')).toBe('reference.image')
        expect(stripMediaFileExtension('untitled')).toBe('untitled')
        expect(formatMediaFileSize(512)).toBe('1 KB')
        expect(formatMediaFileSize(1024 * 1024)).toBe('1.0 MB')
        expect(formatMediaFileSize(NaN)).toBe('0 KB')
    })
})
