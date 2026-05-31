'use strict'

import { describe, expect, it } from 'vitest'

import { buildVeoReferenceImages } from './google-provider.ts'

describe('buildVeoReferenceImages', () => {
    it('uses the VEO 3.1 asset reference type for every reference image', () => {
        const refs = [
            { imageBytes: 'first-image', mimeType: 'image/png' },
            { imageBytes: 'second-image', mimeType: 'image/jpeg' },
        ]

        expect(buildVeoReferenceImages(refs)).toEqual([
            { image: refs[0], referenceType: 'asset' },
            { image: refs[1], referenceType: 'asset' },
        ])
    })
})
