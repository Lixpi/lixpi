import { describe, expect, it, vi } from 'vitest'

vi.mock('@lixpi/debug-tools', () => ({ warn: vi.fn() }))

import { runExtractorAxis, selectApplicableExtractors } from './stage2-extractors.ts'
import type { StyleExtractionState, StyleExtractor, StageLogger } from './types.ts'

function makeState(): StyleExtractionState {
    return {
        input: {
            styleExtractionRunId: 'run-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            intent: 'extract the palette',
            messages: [],
            analysisProvider: 'OpenAI',
            analysisModel: {
                provider: 'openai',
                model: 'reasoning',
                title: 'Reasoning',
                modelVersion: 'model-1',
                contextWindow: 1000,
                maxCompletionSize: 1000,
                inputCostPerToken: 0,
                outputCostPerToken: 0,
                requestCost: 0,
                createdAt: 0,
                updatedAt: 0,
            },
        },
        references: [],
        sceneAssessment: {
            references: [],
            medium: 'digital-illustration',
            axisDominance: {
                palette: 0.9,
                lighting: 0.1,
                character: 0.8,
            },
            intentResolution: {
                forcedCategory: 'color-palette',
                forcedAxes: ['palette'],
                proposedCategory: 'color-palette',
            },
            notes: 'Palette is dominant.',
        },
        axisExtractions: {},
        failedAxes: [],
        sourceCrops: [],
        samples: [],
    }
}

function makeExtractor(args: {
    axis: string
    minDominance: number
    applicable?: boolean
    extract?: StyleExtractor['extract']
}): StyleExtractor {
    return {
        axis: args.axis,
        displayName: args.axis,
        description: `${args.axis} extractor`,
        minDominance: args.minDominance,
        applicableTo: () => args.applicable ?? true,
        extract: args.extract ?? (async () => ({
            axis: args.axis,
            summary: `${args.axis} summary`,
            fields: {},
            confidence: 1,
            evidence: [],
        })),
    }
}

function makeLogger(): StageLogger {
    return {
        styleExtractionRunId: 'run-1',
        emit: vi.fn(),
        chunk: vi.fn(),
        span: async (_stage, _modelName, body) => await body(),
    }
}

describe('Style Extraction axis selection', () => {
    it('selects every applicable axis above its configured dominance floor', () => {
        const selected = selectApplicableExtractors(makeState(), [
            makeExtractor({ axis: 'palette', minDominance: 0.3 }),
            makeExtractor({ axis: 'lighting', minDominance: 0.3 }),
            makeExtractor({ axis: 'character', minDominance: 0.5, applicable: false }),
        ])

        expect(selected.map((extractor) => extractor.axis)).toEqual(['palette'])
    })

    it('returns no axes when routing has not produced a scene assessment', () => {
        const state = makeState()
        state.sceneAssessment = undefined

        expect(selectApplicableExtractors(state, [makeExtractor({ axis: 'palette', minDominance: 0.3 })])).toEqual([])
    })
})

describe('Style Extraction single-axis action boundary', () => {
    it('isolates an extractor failure into failedAxes instead of failing the Tool run', async () => {
        const extractor = makeExtractor({
            axis: 'palette',
            minDominance: 0.3,
            extract: async () => {
                throw new Error('provider disconnected')
            },
        })
        const state = makeState()
        extractor.applicableTo = () => true

        const selected = selectApplicableExtractors(state, [extractor])
        expect(selected).toHaveLength(1)

        const logger = makeLogger()
        const result = await runExtractorAxis(
            state,
            'palette',
            logger,
            { runImageRouter: vi.fn() },
            [extractor],
        )

        expect(result.axisExtractions).toEqual({})
        expect(result.failedAxes).toEqual([{ axis: 'palette', error: 'provider disconnected' }])
    })
})
