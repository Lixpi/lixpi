'use strict'

import { describe, expect, it } from 'vitest'

import {
    getReasoningPreambleSummary,
    includeLineageProgressInAssetProvenance,
} from './asset-provenance-materializer.ts'

describe('asset provenance generation progress', () => {
    it('seals the shared lineage prefix before the media-run-specific timeline', () => {
        const result = includeLineageProgressInAssetProvenance({
            generationRequestId: 'request-1',
            mediaRunId: 'media-1',
            status: 'completed',
            message: 'Done.',
            progress: {
                phase: 'composing',
                completedSteps: 2,
                totalSteps: 2,
                message: 'Done.',
                items: [
                    { id: 'provider', title: 'Prepare provider run', status: 'completed' },
                    { id: 'generation', title: 'Generate media', status: 'completed' },
                ],
            },
            updatedAt: 10,
        }, 'I will create the requested character sheet.')

        expect(result.progress.items).toEqual([
            expect.objectContaining({
                id: 'lineage:understand-request',
                summary: 'I will create the requested character sheet.',
            }),
            expect.objectContaining({ id: 'lineage:resolve-capabilities-and-references' }),
            expect.objectContaining({ id: 'lineage:resolve-branch-lineage' }),
            expect.objectContaining({ id: 'provider' }),
            expect.objectContaining({ id: 'generation' }),
        ])
    })

    it('seals only assistant preamble into Understand request, excluding generation prompts', () => {
        const summary = getReasoningPreambleSummary({
            type: 'doc',
            content: [{
                type: 'aiReasoningSection',
                attrs: {
                    generationRequestId: 'request-1',
                    reasoningRunId: 'reasoning-1',
                },
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'I will build the requested character.' }] },
                    {
                        type: 'aiCollapsibleBlock',
                        content: [{
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Long media-generation prompt must not leak into the preamble.' }],
                        }],
                    },
                ],
            }],
        }, {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
        })

        expect(summary).toBe('I will build the requested character.')
    })
})
