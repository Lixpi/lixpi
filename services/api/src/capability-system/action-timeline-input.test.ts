import { describe, expect, it } from 'vitest'

import { resolveActionTimelineInput } from './action-timeline-input.ts'

describe('resolveActionTimelineInput', () => {
    it('extracts timing from the same prompt when Action Timeline is explicitly selected', () => {
        expect(resolveActionTimelineInput({
            prompt: 'Build a 15-second action timeline with 3-second beats for the chase.',
            referenceAssetIds: ['asset-1', 'asset-1', 'asset-2'],
        })).toEqual({
            valid: true,
            input: {
                prompt: 'Build a 15-second action timeline with 3-second beats for the chase.',
                referenceAssetIds: ['asset-1', 'asset-2'],
                durationMs: 15_000,
                precisionMs: 3_000,
            },
        })
    })

    it('extracts compact mixed-unit timing without requiring control fields', () => {
        const prompt = 'Create 17s duration 2ms details for an imaginary film.'

        expect(resolveActionTimelineInput({
            prompt,
            referenceAssetIds: [],
        })).toEqual({
            valid: true,
            input: {
                prompt,
                referenceAssetIds: [],
                durationMs: 17_000,
                precisionMs: 2,
            },
        })
    })

    it('prefers values written in the prompt over stale submitted control values', () => {
        expect(resolveActionTimelineInput({
            prompt: 'Make this 12s total with a 2s cadence.',
            referenceAssetIds: [],
            submittedInput: { durationMs: 30_000, precisionMs: 5_000 },
        })).toMatchObject({
            valid: true,
            input: { durationMs: 12_000, precisionMs: 2_000 },
        })
    })

    it('retains sealed submitted timing as a replay fallback', () => {
        expect(resolveActionTimelineInput({
            prompt: 'Regenerate this timeline.',
            referenceAssetIds: [],
            submittedInput: { durationMs: 9_000, precisionMs: 1_500 },
        })).toMatchObject({
            valid: true,
            input: { durationMs: 9_000, precisionMs: 1_500 },
        })
    })

    it('returns the existing user-visible error when either prompt value is missing', () => {
        expect(resolveActionTimelineInput({
            prompt: 'Make a 10-second action timeline.',
            referenceAssetIds: [],
        })).toEqual({
            valid: false,
            error: 'ACTION_TIMELINE_DURATION_AND_PRECISION_REQUIRED',
        })
    })
})
