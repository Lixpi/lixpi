import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { Asset } from '@lixpi/constants'
import { WorkspaceMediaSources } from './workspace-media-sources.ts'

function fixture() {
    const asset = {
        assetId: 'asset',
        title: 'Photo',
        revision: 1,
        media: {
            kind: 'image',
            sourceMimeType: 'image/png',
            width: 1024,
            height: 512,
            renditions: {
                original: { name: 'original', status: 'ready', blobHash: 'pixels', updatedAt: 1, width: 1024, height: 512 },
                preview: { name: 'preview', status: 'pending', updatedAt: 1 },
                thumbnail: { name: 'thumbnail', status: 'failed', updatedAt: 1 },
            },
        },
    } as Asset
    const release = vi.fn()
    const ports = {
        getAsset: vi.fn(() => asset),
        resolveAssetRendition: vi.fn(async () => ({ url: '/asset', release })),
        resolveTransientSource: vi.fn(async () => ({ url: '/transient', release })),
    }
    return { asset, ports, release, sources: new WorkspaceMediaSources(ports) }
}

describe('WorkspaceMediaSources', () => {
    it('declares only available renditions and ignores title-only revisions', () => {
        const { asset, sources } = fixture()
        const first = sources.describeAsset('asset', 'image')!
        expect(first.renditions.map(rendition => rendition.id)).toEqual(['original'])
        asset.title = 'Renamed'
        asset.revision++
        expect(sources.describeAsset('asset', 'image')!.version).toBe(first.version)
        asset.media!.renditions.original!.blobHash = 'replacement'
        expect(sources.describeAsset('asset', 'image')!.version).not.toBe(first.version)
        expect(sources.describeAsset('asset', 'video')).toBeNull()
    })

    it('does not substitute an unavailable poster or preview', async () => {
        const { ports, sources } = fixture()
        const media = sources.describeAsset('asset', 'image', ['preview'])!
        expect(media.renditions).toEqual([])
        await expect(sources.resolve(media, 'preview', new AbortController().signal)).rejects.toThrow('Undeclared')
        expect(ports.resolveAssetRendition).not.toHaveBeenCalled()
    })

    it('releases a source resolved after cancellation and scopes retry revisions', async () => {
        const { ports, sources, release } = fixture()
        const other = new WorkspaceMediaSources(ports)
        const initial = sources.describeAsset('asset', 'image')!
        sources.retry(new Set(['asset']))
        const retried = sources.describeAsset('asset', 'image')!
        expect(retried.version).not.toBe(initial.version)
        expect(other.describeAsset('asset', 'image')!.version).toBe(initial.version)
        const controller = new AbortController()
        const result = sources.resolve(retried, 'original', controller.signal)
        controller.abort()
        await expect(result).rejects.toMatchObject({ name: 'AbortError' })
        expect(release).toHaveBeenCalledOnce()
    })

    it('resolves explicit transient frames without constructing asset requests', async () => {
        const { sources, ports } = fixture()
        const signal = new AbortController().signal
        const media = sources.describeTransient('pending-node', 'blob:frame')
        await sources.resolve(structuredClone(media), 'frame', signal)
        expect(ports.resolveTransientSource).toHaveBeenCalledWith('blob:frame', signal)
        expect(ports.resolveAssetRendition).not.toHaveBeenCalled()
    })
})
