// Demo Assets for the Lixpi canvas components. Each Asset carries ready
// renditions whose bytes come from DemoMedia, and the source ports resolve a
// rendition to its object URL the way web-ui resolves an authorized media URL.

import {
    DEFAULT_ASSET_SUBJECT_IDENTITY,
    type Asset,
    type AssetMediaKind,
    type AssetMeta,
    type AssetPrimaryCategory,
    type AssetRendition,
} from '@lixpi/constants'
import {
    type WorkspaceMediaSourcePorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/media'
import {
    type FreeformGradientHexColorSet,
} from '@lixpi/ui-primitives/gradients'

import {
    DEMO_PALETTES,
    DemoMedia,
} from '$src/fixtures/demoMedia.ts'

export const DEMO_ORGANIZATION_ID = 'design-system-organization'
export const DEMO_WORKSPACE_ID = 'design-system-workspace'
export const DEMO_USER_ID = 'design-system-user'

type DemoAssetDefinition = {
    assetId: string
    colors?: FreeformGradientHexColorSet
    height: number
    kind: AssetMediaKind
    title: string
    width: number
}

const DEFINITIONS: DemoAssetDefinition[] = [
    {
        assetId: 'image-dawn',
        colors: [...DEMO_PALETTES.dawn],
        height: 640,
        kind: 'image',
        title: 'Dawn study',
        width: 960,
    },
    {
        assetId: 'image-dusk',
        colors: [...DEMO_PALETTES.dusk],
        height: 900,
        kind: 'image',
        title: 'Dusk portrait',
        width: 720,
    },
    {
        assetId: 'image-sage',
        colors: [...DEMO_PALETTES.sage],
        height: 720,
        kind: 'image',
        title: 'Sage square',
        width: 720,
    },
    {
        assetId: 'video-violet',
        height: 360,
        kind: 'video',
        title: 'Violet loop',
        width: 640,
    },
    {
        assetId: 'audio-tone',
        height: 0,
        kind: 'audio',
        title: 'Two-note tone',
        width: 0,
    },
    {
        assetId: 'document-brief',
        colors: [...DEMO_PALETTES.violet],
        height: 1100,
        kind: 'document',
        title: 'Campaign brief.pdf',
        width: 850,
    },
]

const MIME_TYPES: Record<AssetMediaKind, string> = {
    audio: 'audio/wav',
    document: 'application/pdf',
    image: 'image/png',
    video: 'video/webm',
}

const PRIMARY_CATEGORIES: Record<AssetMediaKind, AssetPrimaryCategory> = {
    audio: 'audio',
    document: 'document',
    image: 'image',
    video: 'video',
}

const rendition = (
    name: AssetRendition['name'],
    mimeType: string,
    width?: number,
    height?: number,
): AssetRendition => ({
    height: height || undefined,
    mimeType,
    name,
    status: 'ready',
    updatedAt: 1,
    width: width || undefined,
})

const createAsset = (definition: DemoAssetDefinition): Asset => {
    const mimeType = MIME_TYPES[definition.kind]
    const poster = definition.kind === 'video' || definition.kind === 'document'

    return {
        assetId: definition.assetId,
        createdAt: 1,
        depictionMedium: 'illustration',
        documents: {},
        media: {
            aspectRatio: definition.height ? definition.width / definition.height : undefined,
            durationSeconds: definition.kind === 'video'
                ? 4
                : definition.kind === 'audio'
                    ? 2
                    : undefined,
            height: definition.height || undefined,
            kind: definition.kind,
            modelSafe: true,
            originalName: definition.title,
            renditions: {
                original: rendition(
                    'original',
                    mimeType,
                    definition.width,
                    definition.height,
                ),
                ...(poster ? { poster: rendition(
                    'poster',
                    'image/png',
                    definition.width,
                    definition.height,
                ) } : {}),
            },
            sourceMimeType: mimeType,
            width: definition.width || undefined,
        },
        organizationId: DEMO_ORGANIZATION_ID,
        originWorkspaceId: DEMO_WORKSPACE_ID,
        ownerUserId: DEMO_USER_ID,
        referenceCount: 1,
        revision: 1,
        scope: 'workspace',
        scopeOwnerId: DEMO_WORKSPACE_ID,
        states: {
            conversation: 'none',
            lifecycle: 'active',
            media: 'ready',
            provenance: 'none',
        },
        subjectIdentity: DEFAULT_ASSET_SUBJECT_IDENTITY,
        title: definition.title,
        updatedAt: 1,
    }
}

export class DemoAssets {
    readonly ready: Promise<void>
    readonly sources: WorkspaceMediaSourcePorts

    private readonly media = new DemoMedia()
    private readonly assets = new Map<string, Asset>()
    private readonly urls = new Map<string, string>()

    constructor() {
        for (const definition of DEFINITIONS)
            this.assets.set(
                definition.assetId,
                createAsset(definition),
            )

        this.sources = {
            getAsset: assetId => this.assets.get(assetId),
            resolveAssetRendition: async request => {
                request.signal.throwIfAborted()
                await this.ready
                const url = this.url(request.assetId, request.renditionId)

                if (!url)
                    throw new Error(`No demo source for ${request.assetId}/${request.renditionId}`)

                return {
                    release: () => {},
                    url,
                }
            },
            resolveTransientSource: async (url, signal) => {
                signal.throwIfAborted()

                return {
                    release: () => {},
                    url,
                }
            },
        }
        this.ready = this.generate()
    }

    get(assetId: string): Asset | undefined {
        return this.assets.get(assetId)
    }

    list(): Asset[] {
        return [...this.assets.values()]
    }

    // Library panels list lightweight metadata rather than full Assets.
    meta(): AssetMeta[] {
        return this.list().map(
            asset => ({
                assetId: asset.assetId,
                byteSize: 240_000,
                createdAt: asset.createdAt,
                depictionMedium: asset.depictionMedium,
                durationSeconds: asset.media?.durationSeconds,
                height: asset.media?.height,
                lifecycleStatus: asset.states.lifecycle,
                mediaStatus: asset.states.media,
                mimeType: asset.media?.sourceMimeType,
                organizationId: asset.organizationId,
                originWorkspaceId: asset.originWorkspaceId,
                ownerUserId: asset.ownerUserId,
                primaryCategory: PRIMARY_CATEGORIES[asset.media?.kind ?? 'image'],
                scope: asset.scope,
                scopeAndOwner: `${asset.scope}#${asset.scopeOwnerId}`,
                scopeOwnerId: asset.scopeOwnerId,
                subjectIdentityClassification: asset.subjectIdentity.classification,
                title: asset.title,
                updatedAt: asset.updatedAt,
                width: asset.media?.width,
            }),
        )
    }

    // A synchronous URL reader for components that build image sources directly.
    // Unknown renditions fall back to the original so thumbnails still render.
    url(
        assetId: string,
        renditionId: string,
    ): string {
        return this.urls.get(`${assetId}/${renditionId}`) ?? this.urls.get(`${assetId}/original`) ?? ''
    }

    destroy(): void {
        this.media.destroy()
        this.urls.clear()
    }

    private async generate(): Promise<void> {
        const video = this.media.videoUrl()

        for (const definition of DEFINITIONS) {
            if (definition.kind === 'audio')
                this.urls.set(
                    `${definition.assetId}/original`,
                    this.media.audioUrl(),
                )
            else if (definition.kind === 'video')
                this.urls.set(`${definition.assetId}/original`, await video)
            else if (definition.colors) {
                const url = await this.media.image({
                    colors: definition.colors,
                    height: definition.height,
                    width: definition.width,
                })
                this.urls.set(`${definition.assetId}/original`, url)
                this.urls.set(`${definition.assetId}/poster`, url)
            }
        }

        const poster = await this.media.image({
            colors: [...DEMO_PALETTES.violet],
            height: 360,
            width: 640,
        })
        this.urls.set('video-violet/poster', poster)
    }
}
