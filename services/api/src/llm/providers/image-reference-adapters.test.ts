'use strict'

import { describe, expect, it } from 'vitest'
import type { ImageReferenceCapabilities } from '@lixpi/constants'

import type {
    ImageGenerationReferenceRole,
    ResolvedImageGenerationReference,
} from '../image-generation-references.ts'
import {
    buildImageReferencePromptLabel,
    GOOGLE_IMAGE_REFERENCE_ADAPTER,
    OPENAI_IMAGE_REFERENCE_ADAPTER,
    STABILITY_IMAGE_REFERENCE_ADAPTER,
} from './image-reference-adapters.ts'

const reference = (role: ImageGenerationReferenceRole, index: number): ResolvedImageGenerationReference => ({
    url: `data:image/png;base64,${index}`,
    role,
    fileName: `${role}-${index}.png`,
    bytes: Buffer.from([index]),
    dataUrl: `data:image/png;base64,${index}`,
    mediaType: 'image/png',
    byteLength: 1,
    sha256: String(index).padStart(64, '0'),
})

const capabilities = (overrides: Partial<ImageReferenceCapabilities> = {}): ImageReferenceCapabilities => ({
    maxReferenceImages: 4,
    maxIdentityReferenceImages: 2,
    conditioningModes: ['edit', 'identity', 'style'],
    inputFidelity: 'high',
    supportsIterativeEdit: true,
    supportsMask: false,
    supportsStructureControl: false,
    supportsPoseControl: false,
    supportsDeterministicSeed: false,
    maxOutputPixels: 1572864,
    supportedAspectRatios: ['1:1', '3:2'],
    ...overrides,
})

describe('image reference adapters', () => {
    it('keeps pose evidence ahead of optional identity and control references and emits explicit high fidelity', () => {
        const result = OPENAI_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [
                reference('pose-reference', 1),
                reference('face-crop', 2),
                reference('original-source', 3),
                reference('body-outfit-crop', 4),
                reference('prop-crop', 5),
            ],
            capabilities: capabilities(),
            requiresIdentity: true,
        })

        expect(result.included.map(({ role }) => role)).toEqual([
            'original-source',
            'pose-reference',
            'face-crop',
            'prop-crop',
        ])
        expect(result.omitted).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'body-outfit-crop', reason: 'identity-budget' }),
        ]))
        expect(result.explicitInputFidelity).toBe('high')
    })

    it('keeps Google role order stable and omits references beyond the declared budget', () => {
        const result = GOOGLE_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [
                reference('pose-reference', 1),
                reference('canonical-anchor', 2),
                reference('face-crop', 3),
            ],
            capabilities: capabilities({
                maxReferenceImages: 2,
                conditioningModes: ['edit', 'identity', 'style', 'pose'],
                supportsPoseControl: true,
            }),
            requiresIdentity: true,
        })

        expect(result.included.map(({ role }) => role)).toEqual(['canonical-anchor', 'pose-reference'])
        expect(result.omitted).toEqual([expect.objectContaining({ role: 'face-crop', reason: 'reference-budget' })])
    })

    it('keeps all three generated anchors and required pose control when identity slots are exhausted', () => {
        const result = OPENAI_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [
                reference('original-source', 1),
                reference('adjacent-angle', 2),
                reference('pose-reference', 3),
                reference('canonical-anchor', 4),
                reference('opposite-angle', 5),
            ],
            capabilities: capabilities({
                maxReferenceImages: 4,
                maxIdentityReferenceImages: 3,
            }),
            requiresIdentity: true,
        })

        expect(result.included.map(({ role }) => role)).toEqual([
            'canonical-anchor',
            'adjacent-angle',
            'opposite-angle',
            'pose-reference',
        ])
        expect(result.omitted).toEqual([
            expect.objectContaining({ role: 'original-source', reason: 'identity-budget' }),
        ])
    })

    it('keeps the existing edit target as identity evidence ahead of the original source', () => {
        const result = OPENAI_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [
                reference('original-source', 1),
                reference('pose-reference', 2),
                reference('edit-target', 3),
            ],
            capabilities: capabilities(),
            requiresIdentity: true,
        })

        expect(result.included.map(({ role }) => role)).toEqual([
            'edit-target',
            'original-source',
            'pose-reference',
        ])
        expect(result.omitted).toEqual([])
    })

    it('preserves identity-only edit scope in provider-neutral reference adaptation', () => {
        const result = GOOGLE_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [
                reference('original-source', 1),
                reference('pose-reference', 2),
                reference('edit-target-identity', 3),
            ],
            capabilities: capabilities(),
            requiresIdentity: true,
        })

        expect(result.included.map(({ role }) => role)).toEqual([
            'edit-target-identity',
            'original-source',
            'pose-reference',
        ])
        expect(result.omitted).toEqual([])
        expect(buildImageReferencePromptLabel(result.included[0]!, 0)).toContain(
            'EDIT-TARGET IDENTITY CROP ONLY',
        )
        expect(buildImageReferencePromptLabel(result.included[0]!, 0)).toContain(
            'Do not copy any trait outside that region, any rejected trait inside it, or any prior-output defect',
        )
    })

    it('rejects Stability identity conditioning before provider work', () => {
        expect(() => STABILITY_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [reference('face-crop', 1)],
            capabilities: capabilities({
                maxIdentityReferenceImages: 0,
                conditioningModes: ['edit', 'style', 'structure'],
                supportsStructureControl: true,
            }),
            requiresIdentity: true,
        })).toThrow('IMAGE_REFERENCE_IDENTITY_CONDITIONING_UNSUPPORTED')
    })

    it('omits an explicit fidelity request for provider-managed models', () => {
        const result = OPENAI_IMAGE_REFERENCE_ADAPTER.adapt({
            references: [reference('source-reference', 1)],
            capabilities: capabilities({ inputFidelity: 'provider-managed' }),
            requiresIdentity: false,
        })

        expect(result.explicitInputFidelity).toBeUndefined()
    })
})
