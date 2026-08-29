import { describe, expect, it } from 'vitest'

import {
    mergeMediaGenerationRunProgress,
} from './media-generation-progress.ts'
import {
    GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT,
    MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT,
    type MediaGenerationRunProgress,
} from './types.ts'

function makeProgress(overrides: Partial<MediaGenerationRunProgress> = {}): MediaGenerationRunProgress {
    return {
        phase: 'rendering',
        completedSteps: 1,
        totalSteps: 3,
        message: 'Rendering.',
        ...overrides,
    }
}

describe('mergeMediaGenerationRunProgress', () => {
    it('keeps detailed items when a later heartbeat contains only generic progress', () => {
        const current = makeProgress({
            items: [{
                id: 'render',
                title: 'Render media',
                status: 'running',
                trace: {
                    traceVersion: 'execution-trace-v1',
                    reasoning: 'The reference calls for a low camera angle.',
                },
            }],
        })

        const merged = mergeMediaGenerationRunProgress(current, makeProgress({ message: 'Still rendering.' }))

        expect(merged.message).toBe('Still rendering.')
        expect(merged.items?.[0]?.trace?.reasoning).toBe('The reference calls for a low camera angle.')
    })

    it('deeply accumulates partial model-call, handle, and fact updates', () => {
        const current = makeProgress({
            items: [{
                id: 'assess',
                title: 'Assess result',
                status: 'running',
                trace: {
                    traceVersion: 'execution-trace-v1',
                    reasoning: 'Comparing the rendered shot with its sources.',
                    handles: [{
                        kind: 'media',
                        id: 'source-1',
                        displayName: 'Source image',
                        role: 'comparison-source',
                    }],
                    modelCalls: [{
                        id: 'assessment-1',
                        role: 'assessor',
                        provider: 'Anthropic',
                        modelId: 'Anthropic:claude-opus-5',
                        purpose: 'Compare the result with its sources.',
                        params: [{ name: 'temperature', value: '0' }],
                        tokenUsage: { input: 120 },
                    }],
                    facts: [{ label: 'Framing', value: '0.82' }],
                },
            }],
        })
        const incoming = makeProgress({
            items: [{
                id: 'assess',
                title: 'Assess result',
                status: 'completed',
                trace: {
                    traceVersion: 'execution-trace-v1',
                    modelCalls: [{
                        id: 'assessment-1',
                        role: 'assessor',
                        provider: 'Anthropic',
                        modelId: 'Anthropic:claude-opus-5',
                        params: [{ name: 'maxTokens', value: '1024' }],
                        tokenUsage: { output: 30 },
                    }],
                    facts: [
                        { label: 'Framing', value: '0.91' },
                        { label: 'Overall score', value: '0.88' },
                    ],
                },
            }],
        })

        const trace = mergeMediaGenerationRunProgress(current, incoming).items?.[0]?.trace

        expect(trace?.reasoning).toBe('Comparing the rendered shot with its sources.')
        expect(trace?.handles).toHaveLength(1)
        expect(trace?.modelCalls?.[0]).toMatchObject({
            purpose: 'Compare the result with its sources.',
            params: [
                { name: 'maxTokens', value: '1024' },
                { name: 'temperature', value: '0' },
            ],
            tokenUsage: { input: 120, output: 30 },
        })
        expect(trace?.facts).toEqual([
            { label: 'Framing', value: '0.91' },
            { label: 'Overall score', value: '0.88' },
        ])
    })

    it('does not roll progress back while still accumulating a late trace item', () => {
        const current = makeProgress({
            phase: 'assessing',
            completedSteps: 2,
            message: 'Assessing.',
        })
        const stale = makeProgress({
            phase: 'rendering',
            completedSteps: 1,
            items: [{
                id: 'provider-operation',
                title: 'Provider operation',
                status: 'completed',
                trace: {
                    traceVersion: 'execution-trace-v1',
                    facts: [{ label: 'Operation ID', value: 'provider-123' }],
                },
            }],
        })

        const merged = mergeMediaGenerationRunProgress(current, stale)

        expect(merged.phase).toBe('assessing')
        expect(merged.completedSteps).toBe(2)
        expect(merged.items?.[0]?.trace?.facts).toEqual([
            { label: 'Operation ID', value: 'provider-123' },
        ])
    })
})

describe('media generation configuration help contracts', () => {
    it('publishes help text for each video toggle rendered in the configuration row', () => {
        expect(MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT).toEqual({
            generateAudio: expect.any(String),
            watermark: expect.any(String),
            returnLastFrame: expect.any(String),
        })
    })

    it('publishes option-level Google video constraints for tooltip rendering', () => {
        expect(GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT).toEqual({
            resolution: {
                '1080p': expect.any(String),
                '4k': expect.any(String),
            },
            duration: {
                '8': expect.any(String),
            },
        })
    })
})
