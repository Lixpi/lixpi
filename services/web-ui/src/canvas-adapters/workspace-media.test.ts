import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    WorkspaceMediaAdapter,
    type WorkspaceMediaAdapterPorts,
} from './workspace-media.ts'

afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

function fixture(overrides: Partial<WorkspaceMediaAdapterPorts> = {}) {
    const ports: WorkspaceMediaAdapterPorts = {
        apiBaseUrl: 'https://api.example.test/',
        getToken: vi.fn(async () => 'token'),
        getAsset: vi.fn(),
        fetch: vi.fn(async () => ({ ok: true, json: async () => ({ assetId: 'uploaded', kind: 'image' }) }) as Response),
        ...overrides,
    }
    return { ports, adapter: new WorkspaceMediaAdapter(ports), controller: new AbortController() }
}

describe('WorkspaceMediaAdapter', () => {
    it('resolves authorized renditions and leaves transient data URLs unchanged', async () => {
        const { adapter, ports, controller } = fixture()
        const result = await adapter.sources.resolveAssetRendition({ assetId: 'a/b', renditionId: 'original', signal: controller.signal })
        expect(result.url).toBe('https://api.example.test/api/assets/a%2Fb/renditions/original?token=token')
        await adapter.sources.resolveTransientSource('data:image/png;base64,YQ==', controller.signal)
        expect(ports.getToken).toHaveBeenCalledTimes(1)
        result.release()
    })

    it('rejects media source authorization settling after cancellation', async () => {
        let authorize!: (token: string) => void
        const { adapter, controller } = fixture({
            getToken: () =>
                new Promise(resolve => {
                    authorize = resolve
                }),
        })
        const result = adapter.sources.resolveAssetRendition({ assetId: 'a', renditionId: 'original', signal: controller.signal })
        controller.abort()
        authorize('token')
        await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('does not request authorization for an already closed source', async () => {
        const { adapter, ports, controller } = fixture()
        controller.abort()
        await expect(adapter.sources.resolveTransientSource('data:image/png;base64,YQ==', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
        expect(ports.getToken).not.toHaveBeenCalled()
    })

    it('downloads through a temporary anchor in the supplied document and always removes it', async () => {
        const { adapter, controller } = fixture()
        const clicked: HTMLAnchorElement[] = []
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
            clicked.push(this)
        })
        await adapter.download({ assetId: 'a', rendition: 'original', attachment: true, document, signal: controller.signal })
        expect(clicked).toHaveLength(1)
        expect(clicked[0].href).toBe('https://api.example.test/api/assets/a/renditions/original?token=token&download=true')
        expect(clicked[0].ownerDocument).toBe(document)
        expect(clicked[0].isConnected).toBe(false)
        expect(document.querySelector('a')).toBeNull()
    })

    it('suppresses download clicks after cancellation during authentication', async () => {
        let authorize!: (token: string) => void
        const { adapter, controller } = fixture({
            getToken: () =>
                new Promise(resolve => {
                    authorize = resolve
                }),
        })
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        const result = adapter.download({ assetId: 'a', rendition: 'original', attachment: false, document, signal: controller.signal })
        controller.abort()
        authorize('token')
        await result
        expect(click).not.toHaveBeenCalled()
    })

    it('requires a token for attachment downloads and preserves tokenless image/video behavior', async () => {
        const { adapter, controller } = fixture({ getToken: async () => false })
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        await adapter.download({ assetId: 'a', rendition: 'original', attachment: true, document, signal: controller.signal })
        expect(click).not.toHaveBeenCalled()
        await adapter.download({ assetId: 'a', rendition: 'original', attachment: false, document, signal: controller.signal })
        expect(click).toHaveBeenCalledTimes(1)
    })

    it('does not start a replacement upload after scene replacement during authentication', async () => {
        let current = true
        let authorize!: (token: string) => void
        const { adapter, ports, controller } = fixture({
            getToken: () =>
                new Promise(resolve => {
                    authorize = resolve
                }),
        })
        const result = adapter.uploadReplacement({ workspaceId: 'one', file: new File(['a'], 'a.png'), signal: controller.signal, isCurrent: () => current })
        current = false
        authorize('token')
        expect(await result).toBeNull()
        expect(ports.fetch).not.toHaveBeenCalled()
    })

    it('uploads to the captured workspace with the owning signal', async () => {
        const { adapter, ports, controller } = fixture()
        const file = new File(['a'], 'a.png')
        expect(await adapter.uploadReplacement({ workspaceId: 'one/two', file, signal: controller.signal, isCurrent: () => true })).toEqual({ assetId: 'uploaded', kind: 'image' })
        const [url, options] = vi.mocked(ports.fetch).mock.calls[0]
        expect(url).toBe('https://api.example.test/api/assets/workspaces/one%2Ftwo')
        expect(options).toMatchObject({ method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer token' } })
        expect((options?.body as FormData).get('file')).toBeInstanceOf(File)
    })

    it('drops a response body decoded after scene replacement', async () => {
        let decode!: (body: object) => void
        let current = true
        const { adapter, controller } = fixture({
            fetch: vi.fn(async () =>
                ({
                    ok: true,
                    json: () =>
                        new Promise(resolve => {
                            decode = resolve
                        }),
                }) as Response
            ),
        })
        const result = adapter.uploadReplacement({ workspaceId: 'one', file: new File(['a'], 'a.png'), signal: controller.signal, isCurrent: () => current })
        await Promise.resolve()
        await Promise.resolve()
        current = false
        decode({ assetId: 'late' })
        expect(await result).toBeNull()
    })
})
