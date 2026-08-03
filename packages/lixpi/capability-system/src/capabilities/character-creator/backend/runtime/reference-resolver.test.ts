'use strict'

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCharacterReferences } from './reference-resolver.ts'
import type { CharacterReferenceAssetPort } from './runtime-ports.ts'

const readyAsset = (overrides: Record<string, unknown> = {}) => ({
    assetId: 'asset-1',
    organizationId: 'org-1',
    media: {
        renditions: {
            canonical: { status: 'ready', blobHash: 'canonical-hash', mimeType: 'image/png' },
            original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/jpeg' },
        },
    },
    ...overrides,
})

const assets: CharacterReferenceAssetPort = {
    getAuthorizedAsset: vi.fn(),
    readBlob: vi.fn(),
}

const resolve = async () => await resolveCharacterReferences({
    assetIds: ['asset-1'],
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    assets,
})

describe('resolveCharacterReferences', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset())
        vi.mocked(assets.readBlob).mockResolvedValue(await sharp({
            create: { width: 640, height: 480, channels: 3, background: '#446688' },
        }).png().toBuffer())
    })

    it('reauthorizes the Asset and resolves the canonical rendition at original dimensions', async () => {
        const result = await resolve()

        expect(assets.getAuthorizedAsset).toHaveBeenCalledWith({
            assetId: 'asset-1',
            userId: 'user-1',
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })
        expect(assets.readBlob).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'canonical-hash' })
        expect(result[0]).toMatchObject({
            assetId: 'asset-1',
            rendition: 'canonical',
            blobHash: 'canonical-hash',
            width: 640,
            height: 480,
        })
    })

    it('falls back to the original rendition but never to preview', async () => {
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({
            media: {
                renditions: {
                    canonical: { status: 'processing' },
                    original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/png' },
                },
            },
        }))

        const result = await resolve()

        expect(result[0]?.rendition).toBe('original')
        expect(assets.readBlob).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'original-hash' })

        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({
            media: {
                renditions: {
                    canonical: { status: 'processing' },
                    original: { status: 'failed' },
                },
            },
        }))
        await expect(resolve()).rejects.toThrow('CHARACTER_REFERENCE_NOT_MODEL_READY:asset-1')
    })

    it('rejects an Asset returned outside the active organization', async () => {
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({ organizationId: 'org-2' }))

        await expect(resolve()).rejects.toThrow('CHARACTER_REFERENCE_ORGANIZATION_MISMATCH:asset-1')
        expect(assets.readBlob).not.toHaveBeenCalled()
    })
})
