'use strict'

import { describe, expect, it } from 'vitest'
import type { ImageReferenceCapabilities } from '@lixpi/constants'

import type {
    ImageGenerationReferenceRole,
    ResolvedImageGenerationReference,
} from '../image-generation-references.ts'
import {
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
    it('reserves OpenAI identity slots before optional controls and emits explicit high fidelity', () => {
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
            'face-crop',
            'prop-crop',
        ])
        expect(result.omitted).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'body-outfit-crop', reason: 'identity-budget' }),
            expect.objectContaining({ role: 'pose-reference', reason: 'unsupported-conditioning' }),
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

        expect(result.included.map(({ role }) => role)).toEqual(['face-crop', 'canonical-anchor'])
        expect(result.omitted).toEqual([expect.objectContaining({ role: 'pose-reference', reason: 'reference-budget' })])
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
