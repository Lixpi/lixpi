import {
    type Asset,
    type AssetMediaKind,
} from '@lixpi/constants'
import {
    type MediaDescriptor,
    type MediaSourceResolver,
} from '@lixpi/canvas-engine/frontend/media'

type SourceLease = Awaited<ReturnType<MediaSourceResolver['resolve']>>
type WorkspaceMediaDescriptor = MediaDescriptor & {
    source: { kind: 'asset'; assetId: string } | { kind: 'transient'; url: string }
}

export type WorkspaceMediaSourcePorts = {
    getAsset: (assetId: string) => Asset | undefined
    resolveAssetRendition: (request: { assetId: string; renditionId: string; version: string; signal: AbortSignal }) => Promise<SourceLease>
    resolveTransientSource: (url: string, signal: AbortSignal) => Promise<SourceLease>
}

// Product metadata determines which renditions exist. Authentication and URL
// lifetimes come from infrastructure ports; the engine only sees descriptors.
export class WorkspaceMediaSources implements MediaSourceResolver {
    private readonly retries = new Map<string, number>()

    constructor(private readonly ports: WorkspaceMediaSourcePorts) {}

    describeAsset(assetId: string, kind: AssetMediaKind, only?: readonly string[]): WorkspaceMediaDescriptor | null {
        const media = this.ports.getAsset(assetId)?.media
        if (!media || media.kind !== kind) return null
        const ready = Object.values(media.renditions).filter(rendition => rendition.status === 'ready' && (!only || only.includes(rendition.name)))
        const renditions = ready.flatMap(rendition => {
            const mimeType = rendition.mimeType || (rendition.name === 'original' ? media.sourceMimeType : '')
            if (!mimeType) return []
            return [{ id: rendition.name, width: rendition.width, height: rendition.height, mimeType }]
        })
        return {
            key: assetId,
            kind,
            version: JSON.stringify([this.retries.get(assetId) ?? 0, ready.map(rendition => [rendition.name, rendition.blobHash, rendition.updatedAt, rendition.mimeType, rendition.width, rendition.height])]),
            dimensions: media.width && media.height ? { width: media.width, height: media.height } : undefined,
            renditions,
            source: { kind: 'asset', assetId },
        }
    }

    describeTransient(nodeId: string, url: string): WorkspaceMediaDescriptor {
        return { key: `transient:${nodeId}`, kind: 'image', version: url, renditions: [{ id: 'frame', mimeType: 'image/*' }], source: { kind: 'transient', url } }
    }

    retry(assetIds: ReadonlySet<string>): void {
        for (const assetId of assetIds) this.retries.set(assetId, (this.retries.get(assetId) ?? 0) + 1)
    }

    clear(): void {
        this.retries.clear()
    }

    resolve: MediaSourceResolver['resolve'] = async (descriptor, renditionId, signal) => {
        signal.throwIfAborted()
        if (!descriptor.renditions.some(rendition => rendition.id === renditionId)) throw new Error(`Undeclared media rendition: ${renditionId}`)
        const source = (descriptor as WorkspaceMediaDescriptor).source
        if (!source) throw new Error('Workspace media descriptor is missing its source')
        const lease = source.kind === 'asset'
            ? await this.ports.resolveAssetRendition({ assetId: source.assetId, renditionId, version: descriptor.version, signal })
            : await this.ports.resolveTransientSource(source.url, signal)
        if (signal.aborted) {
            lease.release()
            signal.throwIfAborted()
        }
        return lease
    }
}
