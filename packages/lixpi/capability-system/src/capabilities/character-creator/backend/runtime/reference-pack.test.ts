'use strict'

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { CharacterEvidenceProfile } from './character-evidence.ts'
import { buildCharacterReferencePack } from './reference-pack.ts'
import type { CharacterTransientMediaStorePort } from './runtime-ports.ts'

const capabilities = {
    maxReferenceImages: 16,
    maxIdentityReferenceImages: 5,
    conditioningModes: ['edit', 'identity', 'style'] as const,
    inputFidelity: 'high' as const,
    supportsIterativeEdit: true,
    supportsMask: true,
    supportsStructureControl: false,
    supportsPoseControl: false,
    supportsDeterministicSeed: false,
    maxOutputPixels: 250_000,
    supportedAspectRatios: ['1:1'],
}

const makeStore = (): CharacterTransientMediaStorePort => {
    let sequence = 0
    return {
        putWithCoordinate: vi.fn(async input => {
            sequence += 1
            return {
                coordinate: {
                    organizationId: 'org-1',
                    bucketName: 'transient-media-org-1-files',
                    objectKey: `partial-${String(sequence).padStart(64, '0')}.png`,
                    mimeType: input.mimeType,
                    byteLength: input.bytes.byteLength,
                },
            }
        }),
        clear: vi.fn(async () => undefined),
    }
}

const evidence = (): CharacterEvidenceProfile => ({
    medium: 'illustration',
    promptDirectives: [],
    promptChangedFeatures: [],
    facts: [
        {
            feature: 'face', value: 'clear front face', visibility: 'observed', sourceAssetId: 'asset-front',
            sourceRegion: { x: 40, y: 20, width: 180, height: 160 }, targetAngles: ['front'], confidence: 1,
        },
        {
            feature: 'body outfit', value: 'full coat', visibility: 'observed', sourceAssetId: 'asset-front',
            sourceRegion: { x: -20, y: 180, width: 800, height: 1000 }, targetAngles: ['front'], confidence: 0.9,
        },
        {
            feature: 'prop', value: 'walking staff', visibility: 'observed', sourceAssetId: 'asset-profile',
            sourceRegion: { x: 500, y: 100, width: 300, height: 900 }, targetAngles: ['profile'], confidence: 0.8,
        },
    ],
    palette: [],
    costumeNotes: [],
    materialNotes: [],
    distinguishingDetailNotes: [],
    sourceCoverage: [],
    conflicts: [],
})

describe('buildCharacterReferencePack', () => {
    it('keeps multi-angle originals, creates lossless role crops, and enforces pixel bounds', async () => {
        const frontBytes = await sharp({
            create: { width: 1200, height: 900, channels: 3, background: '#884422' },
        }).png().toBuffer()
        const profileBytes = await sharp({
            create: { width: 900, height: 1200, channels: 3, background: '#226688' },
        }).png().toBuffer()
        const store = makeStore()

        const pack = await buildCharacterReferencePack({
            sources: [
                {
                    assetId: 'asset-front', organizationId: 'org-1', rendition: 'canonical', blobHash: 'front',
                    mimeType: 'image/png', bytes: frontBytes, width: 1200, height: 900,
                },
                {
                    assetId: 'asset-profile', organizationId: 'org-1', rendition: 'original', blobHash: 'profile',
                    mimeType: 'image/png', bytes: profileBytes, width: 900, height: 1200,
                },
            ],
            evidence: evidence(),
            capabilities,
            store,
        })

        expect(pack.entries.map(entry => entry.role)).toEqual([
            'original-source',
            'original-source',
            'face-crop',
            'body-outfit-crop',
            'prop-crop',
        ])
        expect(pack.entries.filter(entry => entry.role === 'original-source')
            .every(entry => entry.width * entry.height <= capabilities.maxOutputPixels)).toBe(true)
        expect(pack.entries.every(entry => entry.url.startsWith('data:image/png;base64,'))).toBe(true)
        expect(pack.entries.every(entry => entry.coordinate.organizationId === 'org-1')).toBe(true)
        expect(store.putWithCoordinate).toHaveBeenCalledTimes(5)
    })
})
