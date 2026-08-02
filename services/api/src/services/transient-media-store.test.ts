'use strict'

import { describe, expect, it, vi } from 'vitest'

import {
    getTransientMediaBucketName,
    getTransientMediaMimeType,
    isTransientMediaObjectKey,
    TransientMediaStore,
} from './transient-media-store.ts'

type ObjectStoreNats = {
    getObjectStore: ReturnType<typeof vi.fn>
    createObjectStore: ReturnType<typeof vi.fn>
    putObject: ReturnType<typeof vi.fn>
    deleteObject: ReturnType<typeof vi.fn>
}

const scope = {
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'thread-1',
    generationRequestId: 'request-1',
    mediaRunId: 'media-1',
}

function makeNats(): ObjectStoreNats {
    return {
        getObjectStore: vi.fn(async () => ({})),
        createObjectStore: vi.fn(async () => ({})),
        putObject: vi.fn(async () => undefined),
        deleteObject: vi.fn(async () => undefined),
    }
}

function objectKeyFromUrl(url: string): string {
    const match = url.match(/objects\/(partial-[a-f0-9]{64}\.[a-z0-9]+)/)
    if (!match?.[1]) throw new Error(`Transient URL did not contain an object key: ${url}`)
    return match[1]
}

describe('TransientMediaStore', () => {
    it('uses an organization-scoped bucket and only exposes expected media keys', () => {
        expect(getTransientMediaBucketName('org-1')).toBe('transient-media-org-1-files')
        expect(isTransientMediaObjectKey(`partial-${'a'.repeat(64)}.webm`)).toBe(true)
        expect(isTransientMediaObjectKey('../partial-file.png')).toBe(false)
        expect(getTransientMediaMimeType(`partial-${'a'.repeat(64)}.webm`)).toBe('video/webm')
        expect(getTransientMediaMimeType(`partial-${'a'.repeat(64)}.exe`)).toBeUndefined()
    })

    it('stores immutable partials and deletes each superseded object', async () => {
        const nats = makeNats()
        const store = new TransientMediaStore(nats as any, scope)

        const firstUrl = await store.put({
            mediaKind: 'image',
            slot: 'variant-0',
            bytes: Buffer.from('first'),
            mimeType: 'image/png',
            revision: 1,
        })
        const secondUrl = await store.put({
            mediaKind: 'image',
            slot: 'variant-0',
            bytes: Buffer.from('second'),
            mimeType: 'image/png',
            revision: 2,
        })

        const firstObjectKey = objectKeyFromUrl(firstUrl)
        const secondObjectKey = objectKeyFromUrl(secondUrl)
        expect(firstObjectKey).not.toBe(secondObjectKey)
        expect(secondUrl).toContain('?revision=2')
        expect(nats.putObject).toHaveBeenCalledTimes(2)
        expect(nats.deleteObject).toHaveBeenCalledWith('transient-media-org-1-files', firstObjectKey)

        await store.clear()

        expect(nats.deleteObject).toHaveBeenLastCalledWith('transient-media-org-1-files', secondObjectKey)
    })

    it('retains failed superseded deletions for terminal cleanup and retries them', async () => {
        const nats = makeNats()
        nats.deleteObject.mockRejectedValueOnce(new Error('temporary object store outage'))
        const store = new TransientMediaStore(nats as any, scope)

        const firstUrl = await store.put({
            mediaKind: 'video',
            slot: 'variant-0',
            bytes: Buffer.from('first'),
            mimeType: 'video/webm',
            revision: 1,
        })
        const secondUrl = await store.put({
            mediaKind: 'video',
            slot: 'variant-0',
            bytes: Buffer.from('second'),
            mimeType: 'video/webm',
            revision: 2,
        })

        await store.clear()

        expect(nats.deleteObject).toHaveBeenCalledWith('transient-media-org-1-files', objectKeyFromUrl(firstUrl))
        expect(nats.deleteObject).toHaveBeenCalledWith('transient-media-org-1-files', objectKeyFromUrl(secondUrl))
        expect(nats.deleteObject).toHaveBeenCalledTimes(3)
    })

    it('creates the TTL bucket when it does not exist before storing an audio partial', async () => {
        const nats = makeNats()
        nats.getObjectStore.mockRejectedValueOnce(new Error('bucket missing'))
        const store = new TransientMediaStore(nats as any, scope)

        await store.put({
            mediaKind: 'audio',
            slot: 'variant-0',
            bytes: Buffer.from('audio'),
            mimeType: 'audio/mpeg',
            revision: 1,
        })

        expect(nats.createObjectStore).toHaveBeenCalledWith('transient-media-org-1-files', expect.objectContaining({
            description: 'Transient generation media for org-1',
            ttl: 3600000000000,
        }))
        expect(nats.putObject).toHaveBeenCalledWith(
            'transient-media-org-1-files',
            expect.stringMatching(/^partial-[a-f0-9]{64}\.mp3$/),
            expect.any(Uint8Array),
            expect.objectContaining({ description: 'Transient audio partial media-1/variant-0' }),
        )
    })
})
