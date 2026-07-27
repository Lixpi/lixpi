'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    finalizeActionTimelineArtifact: vi.fn(),
    discardStagedActionTimelineArtifact: vi.fn(),
}))

vi.mock('./action-timeline-persistence-adapter.ts', () => ({
    finalizeActionTimelineArtifact: mocks.finalizeActionTimelineArtifact,
    discardStagedActionTimelineArtifact: mocks.discardStagedActionTimelineArtifact,
}))

import type { ProviderState } from '../llm/graph/state.ts'
import {
    discardPendingCapabilityOutputsForState,
    finalizePendingCapabilityOutputsForState,
} from './capability-output-finalizer.ts'

const pendingOutput = {
    capabilityId: 'global.action-timeline',
    capabilityRunId: 'run-1',
    assetId: 'artifact-1',
    input: { prompt: 'Create a timeline', durationMs: 15_000, precisionMs: 2_000 },
    variant: {
        axis: 'reasoning-model' as const,
        variantKey: 'reasoning:0:Anthropic:claude',
        reasoningIndex: 0,
        reasoningModelId: 'Anthropic:claude',
        provider: 'Anthropic' as const,
        modelVersion: 'claude',
        contextWindow: 100_000,
        maxCompletionSize: 8_192,
    },
    generationRun: {
        requestKind: 'capability-output' as const,
        generationRequestId: 'request-1',
        reasoningRunId: 'request-1:reasoning:0',
        reasoningModelId: 'Anthropic:claude',
        reasoningIndex: 0,
    },
}

const state = (): ProviderState => ({
    workspaceId: 'workspace-1',
    aiChatThreadId: 'conversation-1',
    eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
    pendingCapabilityOutputFinalizations: [pendingOutput],
} as ProviderState)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeActionTimelineArtifact.mockResolvedValue({
        canvasGeometry: { layoutRevision: 2, nodes: [] },
        generationRun: {
            ...pendingOutput.generationRun,
            lineageAssignment: { assetId: 'artifact-1' },
        },
    })
    mocks.discardStagedActionTimelineArtifact.mockResolvedValue(undefined)
})

describe('Capability output finalization', () => {
    it('routes a staged Action Timeline through its finalizer with authoritative run identity', async () => {
        await expect(finalizePendingCapabilityOutputsForState(state())).resolves.toEqual([{
            canvasGeometry: { layoutRevision: 2, nodes: [] },
            generationRun: expect.objectContaining({
                lineageAssignment: { assetId: 'artifact-1' },
            }),
        }])
        expect(mocks.finalizeActionTimelineArtifact).toHaveBeenCalledWith({
            assetId: 'artifact-1',
            capabilityRunId: 'run-1',
            input: pendingOutput.input,
            variant: pendingOutput.variant,
            generationRun: pendingOutput.generationRun,
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'organization-1',
            conversationAssetId: 'conversation-1',
        })
    })

    it('routes failed continuations through staged-Asset cleanup', async () => {
        await discardPendingCapabilityOutputsForState(state())
        expect(mocks.discardStagedActionTimelineArtifact).toHaveBeenCalledWith({
            assetId: 'artifact-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'organization-1',
        })
    })

    it('fails closed when a Capability Artifact has no registered finalizer', async () => {
        const unsupported = state()
        unsupported.pendingCapabilityOutputFinalizations = [{
            ...pendingOutput,
            capabilityId: 'future-artifact',
        }]
        await expect(finalizePendingCapabilityOutputsForState(unsupported))
            .rejects.toThrow('CAPABILITY_OUTPUT_FINALIZER_NOT_REGISTERED:future-artifact')
    })
})
