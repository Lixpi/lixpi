import { describe, expect, it } from 'vitest'

import {
    ACTION_TIMELINE_SCHEMA_VERSION,
    assertActionTimelineEditableMutation,
    assertActionTimelineDocument,
    buildActionTimelineCatalogMetadata,
    buildActionTimelineDocument,
    collectActionTimelineReferencedAssetIds,
    createActionTimelineGrid,
    parseActionTimelineTiming,
    secondsTextToMilliseconds,
    serializeActionTimelineForModel,
} from './action-timeline.ts'

describe('Action Timeline shared contract', () => {
    it('calculates a ceiling grid with a shorter final segment', () => {
        expect(createActionTimelineGrid(5_500, 2_000)).toEqual([
            { slotIndex: 0, startMs: 0, endMs: 2_000 },
            { slotIndex: 1, startMs: 2_000, endMs: 4_000 },
            { slotIndex: 2, startMs: 4_000, endMs: 5_500 },
        ])
    })

    it('accepts millisecond-exact fractional seconds and rejects excess precision', () => {
        expect(secondsTextToMilliseconds('1.001', 1_000)).toBe(1_001)
        expect(secondsTextToMilliseconds('1.0001', 1_000)).toBeUndefined()
        expect(parseActionTimelineTiming('Create an action timeline for 7.5 seconds with precision every 1.25 seconds')).toEqual({
            durationMs: 7_500,
            precisionMs: 1_250,
        })
        expect(parseActionTimelineTiming('Create an action timeline for 8.125 seconds with 1.001 second beats')).toEqual({
            durationMs: 8_125,
            precisionMs: 1_001,
        })
    })

    it.each([
        [
            'Build a 15-second action timeline with 3-second beats.',
            { durationMs: 15_000, precisionMs: 3_000 },
        ],
        [
            'Use 2.5 seconds per beat across a 12.5 second sequence.',
            { durationMs: 12_500, precisionMs: 2_500 },
        ],
        [
            'Action timeline: 9s 1.5s',
            { durationMs: 9_000, precisionMs: 1_500 },
        ],
        [
            'Make this 8 seconds total with a 2 second cadence.',
            { durationMs: 8_000, precisionMs: 2_000 },
        ],
        [
            'Break a 10-second clip into 2-second actions.',
            { durationMs: 10_000, precisionMs: 2_000 },
        ],
        [
            'Create a 14 second sequence with each action lasting 3.5 seconds.',
            { durationMs: 14_000, precisionMs: 3_500 },
        ],
        [
            'Create 17s duration 2ms details for an imaginary film.',
            { durationMs: 17_000, precisionMs: 2 },
        ],
        [
            'Use a 250ms cadence for a 1.5 minute sequence.',
            { durationMs: 90_000, precisionMs: 250 },
        ],
    ] as const)('extracts duration and precision from natural prompt wording: %s', (prompt, expected) => {
        expect(parseActionTimelineTiming(prompt)).toEqual(expected)
    })

    it('rejects sub-millisecond values instead of rounding timing', () => {
        expect(parseActionTimelineTiming('Create a 2s timeline with 0.5ms details.')).toEqual({
            durationMs: 2_000,
        })
    })

    it('keeps timing immutable while permitting prose and media-chip edits', () => {
        const original = buildActionTimelineDocument({ durationMs: 2_500, precisionMs: 1_000 }, [
            { slotIndex: 0, runs: [{ text: 'Start ' }, { assetId: 'asset-a' }] },
            { slotIndex: 1, runs: [{ text: 'Continue' }] },
            { slotIndex: 2, runs: [{ text: 'Finish' }] },
        ])
        const edited = structuredClone(original)
        edited.content![0]!.content![0]!.content = [{ type: 'text', text: 'A different opening' }]

        expect(() => assertActionTimelineEditableMutation(original, edited)).not.toThrow()
        const timingMutation = structuredClone(edited)
        timingMutation.attrs!.durationMs = 3_000
        expect(() => assertActionTimelineEditableMutation(original, timingMutation))
            .toThrow('ACTION_TIMELINE_TIMING_MUTATION_FORBIDDEN')
        const boundaryMutation = structuredClone(edited)
        boundaryMutation.content![1]!.attrs!.startMs = 1_100
        expect(() => assertActionTimelineEditableMutation(original, boundaryMutation))
            .toThrow('ACTION_TIMELINE_BOUNDARY_MUTATION_FORBIDDEN:1')
    })

    it('serializes complete readable content and deduplicates cited Assets in first-use order', () => {
        const longText = 'x'.repeat(25_000)
        const document = buildActionTimelineDocument({ durationMs: 2_000, precisionMs: 1_000 }, [
            { slotIndex: 0, runs: [{ text: longText }, { assetId: 'asset-b' }] },
            { slotIndex: 1, runs: [{ assetId: 'asset-b' }, { text: ' then ' }, { assetId: 'asset-a' }] },
        ])
        const serialized = serializeActionTimelineForModel(document, new Map([
            ['asset-a', 'Final frame'],
            ['asset-b', 'Hero "portrait"'],
        ]))

        expect(serialized.text).toContain(longText)
        expect(serialized.text).toContain('<ref asset:asset-b "Hero \\"portrait\\"">')
        expect(serialized.referencedAssetIds).toEqual(['asset-b', 'asset-a'])
        expect(collectActionTimelineReferencedAssetIds(document)).toEqual(['asset-b', 'asset-a'])
        expect(buildActionTimelineCatalogMetadata(document)).toEqual({
            durationMs: 2_000,
            precisionMs: 1_000,
            segmentCount: 2,
            referencedAssetIds: ['asset-b', 'asset-a'],
        })
    })

    it('persists canonical Asset titles on reference atoms', () => {
        const document = buildActionTimelineDocument(
            { durationMs: 1_000, precisionMs: 1_000 },
            [{ slotIndex: 0, runs: [{ text: 'Board ' }, { assetId: 'asset-train' }] }],
            new Map([['asset-train', { mediaKind: 'image', displayName: 'Slop Train' }]]),
        )

        expect(document.content?.[0]?.content?.[0]?.content?.[1]?.attrs).toMatchObject({
            assetId: 'asset-train',
            mediaKind: 'image',
            displayName: 'Slop Train',
        })
    })

    it('rejects nested Artifact references and malformed timing grids', () => {
        const document = buildActionTimelineDocument({ durationMs: 1_000, precisionMs: 1_000 }, [
            { slotIndex: 0, runs: [{ text: 'Only beat' }] },
        ])
        const nested = structuredClone(document)
        nested.content![0]!.content![0]!.content = [{
            type: 'prompt_reference',
            attrs: { referenceType: 'capability-artifact', assetId: 'artifact-a' },
        }]
        expect(() => assertActionTimelineDocument(nested)).toThrow('ACTION_TIMELINE_REFERENCE_INVALID:0')

        const wrongVersion = structuredClone(document)
        wrongVersion.attrs!.schemaVersion = `${ACTION_TIMELINE_SCHEMA_VERSION}-future`
        expect(() => assertActionTimelineDocument(wrongVersion)).toThrow('ACTION_TIMELINE_SCHEMA_VERSION_INVALID')
    })
})
