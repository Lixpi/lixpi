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
    editTargetPolicy: 'not-present',
    promptDirectives: [],
    promptChangedFeatures: [],
    facts: [
        {
            feature: 'face', value: 'clear front face', region: 'face', requestAuthority: 'supporting',
            visibility: 'observed', sourceAssetId: 'asset-front',
            sourceRegion: { x: 40, y: 20, width: 180, height: 160 }, targetAngles: ['front'], confidence: 1,
        },
        {
            feature: 'body outfit', value: 'full coat', region: 'outfit', requestAuthority: 'assigned',
            visibility: 'observed', sourceAssetId: 'asset-front',
            sourceRegion: { x: -20, y: 180, width: 800, height: 1000 }, targetAngles: ['front'], confidence: 0.9,
        },
        {
            feature: 'carried element placement', value: 'observed configuration', region: 'prop',
            requestAuthority: 'assigned', visibility: 'observed', sourceAssetId: 'asset-profile',
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
            referenceAliases: [
                { assetId: 'asset-front', alias: 'REFERENCE_1' },
                { assetId: 'asset-profile', alias: 'REFERENCE_2' },
            ],
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
        expect(pack.entries.map(entry => entry.fileName)).toEqual([
            'REFERENCE_1.png',
            'REFERENCE_2.png',
            'REFERENCE_1_FACE_CROP.png',
            'REFERENCE_1_BODY_OUTFIT_CROP.png',
            'REFERENCE_2_PROP_CROP.png',
        ])
        expect(store.putWithCoordinate).toHaveBeenCalledTimes(5)
    })

    it('marks an existing sheet component as the edit target instead of another original source', async () => {
        const bytes = await sharp({
            create: { width: 256, height: 256, channels: 3, background: '#334455' },
        }).png().toBuffer()

        const pack = await buildCharacterReferencePack({
            sources: [{
                assetId: 'sheet-1',
                organizationId: 'org-1',
                rendition: 'composition-component',
                sourceKind: 'composition-component',
                componentId: 'body-front',
                compositionAssetId: 'sheet-1',
                blobHash: 'component-hash',
                mimeType: 'image/png',
                bytes,
                width: 256,
                height: 256,
            }],
            evidence: { ...evidence(), facts: [] },
            editTargetAssetId: 'sheet-1',
            capabilities,
            store: makeStore(),
        })

        expect(pack.entries).toEqual([
            expect.objectContaining({
                role: 'edit-target',
                fileName: 'EDIT_TARGET_body-front.png',
                componentId: 'body-front',
                compositionAssetId: 'sheet-1',
            }),
        ])
    })

    it('keeps only a face-region edit target when the prior sheet is authoritative for identity alone', async () => {
        const bytes = await sharp({
            create: { width: 512, height: 512, channels: 3, background: '#334455' },
        }).png().toBuffer()
        const store = makeStore()

        const pack = await buildCharacterReferencePack({
            sources: [
                {
                    assetId: 'sheet-1',
                    organizationId: 'org-1',
                    rendition: 'composition-component',
                    sourceKind: 'composition-component',
                    componentId: 'head-front-neutral',
                    compositionAssetId: 'sheet-1',
                    blobHash: 'head-hash',
                    mimeType: 'image/png',
                    bytes,
                    width: 512,
                    height: 512,
                },
                {
                    assetId: 'sheet-1',
                    organizationId: 'org-1',
                    rendition: 'composition-component',
                    sourceKind: 'composition-component',
                    componentId: 'body-front',
                    compositionAssetId: 'sheet-1',
                    blobHash: 'body-hash',
                    mimeType: 'image/png',
                    bytes,
                    width: 512,
                    height: 512,
                },
            ],
            evidence: {
                ...evidence(),
                facts: [],
                editTargetPolicy: 'identity-only',
            },
            editTargetAssetId: 'sheet-1',
            capabilities,
            store,
        })

        expect(pack.entries).toHaveLength(1)
        expect(pack.entries[0]).toMatchObject({
            role: 'edit-target-identity',
            fileName: 'EDIT_TARGET_IDENTITY_FACE.png',
            componentId: 'head-front-neutral',
        })
        expect(pack.entries[0]?.width).toBeLessThan(512)
        expect(pack.entries[0]?.height).toBeLessThan(512)
        expect(store.putWithCoordinate).toHaveBeenCalledOnce()
    })
})
