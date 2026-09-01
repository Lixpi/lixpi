import {
    describe,
    expect,
    it,
} from 'vitest'

import { MediaGenerationRunPlanner } from './media-generation-run-planner.ts'

const planner = new MediaGenerationRunPlanner()

describe('MediaGenerationRunPlanner', () => {
    it('returns the existing reasoning run when one is provided', () => {
        const existingRun = {
            requestKind: 'single-media',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-existing',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 2,
        } as const

        expect(planner.buildSingleReasoningRun({
            existingRun,
            eventMeta: {},
            provider: 'Anthropic',
            modelName: undefined,
            modelVersion: undefined,
        })).toEqual(existingRun)
    })

    it('derives single reasoning IDs from event metadata and model details', () => {
        const run = planner.buildSingleReasoningRun({
            existingRun: undefined,
            eventMeta: {
                generationRequestId: 'request-2',
                reasoningRunId: 'request-2:reasoning:7',
                reasoningIndex: 7,
            },
            provider: 'OpenAI',
            modelName: 'gpt-4.1',
            modelVersion: 'gpt-4.1',
        })

        expect(run).toMatchObject({
            requestKind: 'single-media',
            generationRequestId: 'request-2',
            reasoningRunId: 'request-2:reasoning:7',
            reasoningModelId: 'OpenAI:gpt-4.1',
            reasoningIndex: 7,
        })
    })

    it('builds matrix reasoning runs with optional lineage assignments', () => {
        const lineageAssignment = {
            generationRequestId: 'request-3',
            reasoningRunId: 'request-3:reasoning:0',
            branchId: 'branch-3',
            referenceNodeIds: ['a'],
            referenceAssetIds: [],
            sourceContextNodeIds: ['b'],
            promptText: 'create a painting',
            createdAt: 1700000000000,
        } as const

        const run = planner.buildMatrixReasoningRun({
            generationRequestId: 'request-3',
            reasoningRunId: 'request-3:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            lineageAssignment,
        })

        expect(run.requestKind).toBe('media-generation-matrix')
        expect(run).toMatchObject({
            generationRequestId: 'request-3',
            reasoningRunId: 'request-3:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            lineageAssignment,
        })
    })

    it('builds image/video model IDs with default media run indexing and variant indices', () => {
        const generationRun = {
            requestKind: 'single-media',
            generationRequestId: 'request-4',
            reasoningRunId: 'request-4:reasoning:2',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 2,
        } as const

        const run = planner.buildProviderMediaRun({
            generationRun,
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            mediaModelCount: 3,
        }) as any

        expect(run).toMatchObject({
            generationRequestId: 'request-4',
            reasoningRunId: 'request-4:reasoning:2',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 2,
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            mediaRunId: 'request-4:reasoning:2:image:0',
            mediaIndex: 0,
            variantIndex: 6,
        })
    })

    it('builds model IDs from either model name or version when name is missing', () => {
        expect(planner.buildMediaModelId('Google', 'seedance-1', 'fallback')).toBe('Google:seedance-1')
        expect(planner.buildMediaModelId('Google', undefined, 'veo-3.1-generate-preview')).toBe('Google:veo-3.1-generate-preview')
    })

    it('preserves an existing variant index when building provider media runs', () => {
        const generationRun = {
            requestKind: 'single-media',
            generationRequestId: 'request-7',
            reasoningRunId: 'request-7:reasoning:3',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 3,
            variantIndex: 14,
        } as const

        const run = planner.buildProviderMediaRun({
            generationRun,
            mediaModelId: 'OpenAI:imagen-4.0-generate-001',
            mediaType: 'image',
            mediaModelCount: 2,
            mediaIndex: 1,
        }) as any

        expect(run?.variantIndex).toBe(14)
        expect(run?.mediaIndex).toBe(1)
        expect(run?.mediaRunId).toBe('request-7:reasoning:3:image:1')
    })

    it('projects media run metadata onto nested event meta payloads', () => {
        const generationRun = {
            requestKind: 'single-media',
            generationRequestId: 'request-5',
            reasoningRunId: 'request-5:reasoning:1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 1,
            mediaRunId: 'request-5:reasoning:1:image:2',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            mediaIndex: 2,
            variantIndex: 14,
        } as const

        expect(planner.buildEventMeta({ userId: 'user-1' }, generationRun)).toMatchObject({
            userId: 'user-1',
            generationRequestId: 'request-5',
            reasoningRunId: 'request-5:reasoning:1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaRunId: 'request-5:reasoning:1:image:2',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 1,
            mediaIndex: 2,
            variantIndex: 14,
        })
    })

    it('builds a matrix reasoning run id from generation request id and index', () => {
        expect(planner.buildReasoningRunId('request-6', 11)).toBe('request-6:reasoning:11')
    })
})
