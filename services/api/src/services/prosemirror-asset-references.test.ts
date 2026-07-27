'use strict'

import { describe, expect, it } from 'vitest'

import {
    collectEmbeddedAssetIds,
    collectReferencedAssetIds,
} from './prosemirror-asset-references.ts'

const referencedDocument = {
    type: 'doc',
    content: [{
        type: 'paragraph',
        content: [
            {
                type: 'prompt_reference',
                attrs: {
                    referenceType: 'media',
                    assetId: 'referenced-media',
                },
            },
            {
                type: 'aiGeneratedImage',
                attrs: { assetId: 'embedded-output' },
            },
            {
                type: 'prompt_reference',
                attrs: {
                    referenceType: 'capability-module',
                    moduleId: 'action-timeline',
                },
            },
        ],
    }],
}

describe('ProseMirror Asset references', () => {
    it('keeps prompt references in the complete referenced-Asset set', () => {
        expect([...collectReferencedAssetIds(referencedDocument)]).toEqual([
            'referenced-media',
            'embedded-output',
        ])
    })

    it('does not treat conversational prompt references as embedded Asset surfaces', () => {
        expect([...collectEmbeddedAssetIds(referencedDocument, 'conversation')]).toEqual([
            'embedded-output',
        ])
    })

    it.each(['content', 'capabilityArtifact'] as const)(
        'treats prompt references as embedded Asset surfaces in %s documents',
        (role) => {
            expect([...collectEmbeddedAssetIds(referencedDocument, role)]).toEqual([
                'referenced-media',
                'embedded-output',
            ])
        },
    )
})
