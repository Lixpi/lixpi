'use strict'

import { describe, expect, it } from 'vitest'

import type { MediaGenerationProgressState, MediaGenerationRunMeta } from '@lixpi/constants'

import {
    getReasoningPreambleSummary,
    includeLineageProgressInAssetProvenance,
} from './asset-provenance-materializer.ts'

function makeProgress(): MediaGenerationProgressState {
    return {
        generationRequestId: 'request-1',
        mediaRunId: 'media-1',
        status: 'completed',
        message: 'Done.',
        progress: {
            phase: 'composing',
            completedSteps: 2,
            totalSteps: 2,
            message: 'Done.',
            items: [{ id: 'generation', title: 'Generate media', status: 'completed' }],
        },
        updatedAt: 10,
    }
}

function makeGenerationRun(overrides: Partial<MediaGenerationRunMeta> = {}): MediaGenerationRunMeta {
    return {
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        mediaRunId: 'media-1',
        reasoningModelId: 'openai:gpt-5',
        mediaModelId: 'openai:gpt-image-1',
        reasoningIndex: 0,
        ...overrides,
    }
}

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

// =============================================================================
// SEALED LINEAGE EXECUTION TRACES
// =============================================================================

describe('asset provenance lineage traces', () => {
    it('seals the reasoning model call, its prompt, and its references onto Understand request', () => {
        const items = includeLineageProgressInAssetProvenance(
            makeProgress(),
            'I will create the requested character sheet.',
            makeGenerationRun({
                lineageAssignment: {
                    assetId: 'asset-out',
                    generationRequestId: 'request-1',
                    branchId: 'branch-1',
                    referenceAssetIds: ['asset-ref-1', 'asset-ref-2'],
                    referenceNodeIds: [],
                    sourceContextNodeIds: [],
                    promptText: 'Create a character out of this reference',
                    createdAt: 1,
                },
            }),
        ).progress.items ?? []

        const understand = items.find(item => item.id === 'lineage:understand-request')
        expect(understand?.trace?.reasoning).toBe('I will create the requested character sheet.')
        expect(understand?.trace?.handles?.map(handle => handle.id)).toEqual(['asset-ref-1', 'asset-ref-2'])
        expect(understand?.trace?.modelCalls?.[0]).toMatchObject({
            role: 'reasoning',
            provider: 'openai',
            modelId: 'openai:gpt-5',
            prompt: 'Create a character out of this reference',
        })
        expect(understand?.trace?.modelCalls?.[0]?.inputHandles).toHaveLength(2)
    })

    it('seals reference handles onto the capability resolution step', () => {
        const items = includeLineageProgressInAssetProvenance(
            makeProgress(),
            '',
            makeGenerationRun({
                lineageAssignment: {
                    assetId: 'asset-out',
                    generationRequestId: 'request-1',
                    branchId: 'branch-1',
                    referenceAssetIds: ['asset-ref-1'],
                    referenceNodeIds: [],
                    sourceContextNodeIds: [],
                    promptText: 'prompt',
                    createdAt: 1,
                },
            }),
        ).progress.items ?? []

        const resolve = items.find(item => item.id === 'lineage:resolve-capabilities-and-references')
        expect(resolve?.trace?.handles).toEqual([{
            kind: 'media',
            id: 'asset-ref-1',
            displayName: 'asset-ref-1',
            mediaKind: 'image',
            role: 'message-reference',
        }])
    })

    it('seals run, media, model, and branch identifiers onto the lineage step', () => {
        const items = includeLineageProgressInAssetProvenance(
            makeProgress(),
            '',
            makeGenerationRun({
                lineageAssignment: {
                    assetId: 'asset-out',
                    generationRequestId: 'request-1',
                    branchId: 'branch-1',
                    referenceAssetIds: [],
                    referenceNodeIds: [],
                    sourceContextNodeIds: [],
                    promptText: 'prompt',
                    createdAt: 1,
                },
            }),
        ).progress.items ?? []

        const lineage = items.find(item => item.id === 'lineage:resolve-branch-lineage')
        expect(lineage?.trace?.facts).toEqual([
            { label: 'Generation request', value: 'request-1' },
            { label: 'Reasoning run', value: 'reasoning-1' },
            { label: 'Media run', value: 'media-1' },
            { label: 'Media model', value: 'openai:gpt-image-1' },
            { label: 'Branch', value: 'branch-1' },
        ])
    })

    it('preserves the traces already carried by media-run items', () => {
        const progress = makeProgress()
        progress.progress.items = [{
            id: 'generation',
            title: 'Generate media',
            status: 'completed',
            trace: {
                traceVersion: 'execution-trace-v1',
                modelCalls: [{ id: 'render', role: 'media', provider: 'openai', modelId: 'openai:gpt-image-1' }],
            },
        }]

        const items = includeLineageProgressInAssetProvenance(progress, '', makeGenerationRun()).progress.items ?? []

        expect(items.at(-1)?.trace?.modelCalls?.[0]?.id).toBe('render')
    })

    it('omits every lineage trace that would carry nothing when no generation run is supplied', () => {
        const items = includeLineageProgressInAssetProvenance(makeProgress(), '').progress.items ?? []

        expect(items.find(item => item.id === 'lineage:understand-request')?.trace).toBeUndefined()
        expect(items.find(item => item.id === 'lineage:resolve-capabilities-and-references')?.trace).toBeUndefined()
        expect(items.find(item => item.id === 'lineage:resolve-branch-lineage')?.trace).toBeUndefined()
    })
})
