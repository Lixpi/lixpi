import { createHash } from 'node:crypto'

import type NatsService from '@lixpi/nats-service'

const MIME_TYPE_EXTENSIONS = {
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
} as const

const EXTENSION_MIME_TYPES = Object.fromEntries(
    Object.entries(MIME_TYPE_EXTENSIONS).map(([mimeType, extension]) => [extension, mimeType]),
) as Record<string, string>

export type TransientMediaMimeType = keyof typeof MIME_TYPE_EXTENSIONS

const TRANSIENT_MEDIA_TTL_NANOS = 60 * 60 * 1000000000

export const getTransientMediaBucketName = (organizationId: string): string => `transient-media-${organizationId}-files`

export const isTransientMediaObjectKey = (objectKey: string): boolean => /^partial-[a-f0-9]{64}\.[a-z0-9]+$/.test(objectKey)

export const getTransientMediaMimeType = (objectKey: string): string | undefined => {
    if (!isTransientMediaObjectKey(objectKey))
        return undefined

    return EXTENSION_MIME_TYPES[objectKey.slice(objectKey.lastIndexOf('.') + 1)]
}

type TransientMediaStoreScope = {
    organizationId: string
    workspaceId: string
    conversationAssetId: string
    generationRequestId: string
    mediaRunId: string
}

type PutTransientMediaInput = {
    mediaKind: 'audio' | 'image' | 'video'
    slot: string
    bytes: Uint8Array
    mimeType: TransientMediaMimeType
    revision: number
}

export type TransientMediaObjectCoordinate = {
    organizationId: string
    bucketName: string
    objectKey: string
    mimeType: TransientMediaMimeType
    byteLength: number
}

export class TransientMediaStore {
    private readonly objectKeys = new Set<string>()
    private readonly activeObjectKeys = new Map<string, string>()
    private storageReady?: Promise<void>

    constructor(
        private readonly natsService: NatsService,
        private readonly scope: TransientMediaStoreScope,
    ) {}

    private ensureStorage(): Promise<void> {
        this.storageReady ??= (async () => {
            const bucketName = getTransientMediaBucketName(this.scope.organizationId)

            try {
                await this.natsService.getObjectStore(bucketName)
            } catch {
                try {
                    await this.natsService.createObjectStore(
                        bucketName,
                        {
                            description: `Transient generation media for ${this.scope.organizationId}`,
                            ttl: TRANSIENT_MEDIA_TTL_NANOS,
                        },
                    )
                } catch (creationError) {
                    try {
                        await this.natsService.getObjectStore(bucketName)
                    } catch {
                        throw creationError
                    }
                }
            }
        })()

        return this.storageReady
    }

    async put(input: PutTransientMediaInput): Promise<string> {
        const { url } = await this.putWithCoordinate(input)

        return url
    }

    async putWithCoordinate(input: PutTransientMediaInput): Promise<{
        url: string
        coordinate: TransientMediaObjectCoordinate
    }> {
        await this.ensureStorage()
        const extension = MIME_TYPE_EXTENSIONS[input.mimeType]
        const objectHash = createHash('sha256').update(
            JSON.stringify({
                ...this.scope,
                mediaKind: input.mediaKind,
                slot: input.slot,
                revision: input.revision,
            }),
        ).digest('hex')
        const objectKey = `partial-${objectHash}.${extension}`
        const bucketName = getTransientMediaBucketName(this.scope.organizationId)
        const slotKey = `${input.mediaKind}:${input.slot}`
        const previousObjectKey = this.activeObjectKeys.get(slotKey)
        await this.natsService.putObject(
            bucketName,
            objectKey,
            input.bytes,
            {
                name: objectKey,
                description: `Transient ${input.mediaKind} partial ${this.scope.mediaRunId}/${input.slot}`,
            },
        )
        this.objectKeys.add(objectKey)
        this.activeObjectKeys.set(slotKey, objectKey)

        if (
            previousObjectKey
            && previousObjectKey !== objectKey
        ) {
            try {
                await this.natsService.deleteObject(bucketName, previousObjectKey)
                this.objectKeys.delete(previousObjectKey)
            } catch {
                // Keep failed superseded deletions tracked for terminal cleanup.
            }
        }

        const path = `/api/transient-media/workspaces/${encodeURIComponent(this.scope.workspaceId)}/objects/${encodeURIComponent(objectKey)}`
        const url = `${path}?revision=${encodeURIComponent(
            String(input.revision),
        )}`

        return {
            url,
            coordinate: {
                organizationId: this.scope.organizationId,
                bucketName,
                objectKey,
                mimeType: input.mimeType,
                byteLength: input.bytes.byteLength,
            },
        }
    }

    async clear(): Promise<void> {
        const bucketName = getTransientMediaBucketName(this.scope.organizationId)

        for (
            let attempt = 1;
            attempt <= 3
            && this.objectKeys.size > 0;
            attempt += 1
        ) {
            const objectKeys = [...this.objectKeys]
            const results = await Promise.allSettled(
                objectKeys.map(objectKey => this.natsService.deleteObject(bucketName, objectKey)),
            )
            results.forEach((result, index) => {
                const objectKey = objectKeys[index]!

                if (result.status === 'fulfilled')
                    this.objectKeys.delete(objectKey)
            })
        }

        if (this.objectKeys.size > 0)
            throw new Error(`Failed to clear transient media objects: ${[...this.objectKeys].join(', ')}`)

        this.activeObjectKeys.clear()
    }
}
