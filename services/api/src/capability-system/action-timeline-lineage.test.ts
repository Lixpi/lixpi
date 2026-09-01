'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import { buildActionTimelineLineageAssignment } from './action-timeline-lineage.ts'

describe('buildActionTimelineLineageAssignment', () => {
    it('creates exactly one root marker for one reasoning-model Artifact', () => {
        const assignment = buildActionTimelineLineageAssignment({
            assetId: 'artifact-1',
            generationRequestId: 'request-1',
            reasoningRunId: 'request-1:reasoning:0',
            variant: {
                axis: 'reasoning-model',
                variantKey: 'reasoning:0:Anthropic:claude-haiku-4-5',
                reasoningIndex: 0,
                reasoningModelId: 'Anthropic:claude-haiku-4-5' as any,
                provider: 'Anthropic',
                modelVersion: 'claude-haiku-4-5',
                contextWindow: 200000,
                maxCompletionSize: 8192,
            },
            prompt: 'Create a 15 second timeline with 2 second beats.',
            referenceAssetIds: [],
            createdAt: 100,
        })

        expect(assignment).toMatchObject({
            branchId: 'branch-request-1',
            branchForkNodeId: 'branch-fork-request-1-reasoning-0',
            lineageParentNodeId: 'branch-fork-request-1-reasoning-0',
            reasoningIndex: 0,
        })
        expect(assignment.branchOriginNodeId).toBeUndefined()
    })
})
