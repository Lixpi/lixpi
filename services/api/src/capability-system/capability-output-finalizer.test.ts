import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type ProviderState,
} from '../llm/graph/state.ts'
import {
    finalizePendingCapabilityOutputsForState,
} from './capability-output-finalizer.ts'

const pendingOutput = {
    capabilityId: 'fixture-artifact',
    capabilityRunId: 'run-1',
    assetId: 'artifact-1',
    input: {
        prompt: 'Create an Artifact',
    },
    variant: {
        axis: 'reasoning-model' as const,
        variantKey: 'reasoning:0:Anthropic:claude',
        reasoningIndex: 0,
        reasoningModelId: 'Anthropic:claude',
        provider: 'Anthropic' as const,
        modelVersion: 'claude',
        contextWindow: 100000,
        maxCompletionSize: 8192,
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
    eventMeta: {
        userId: 'user-1',
        organizationId: 'organization-1',
    },
    pendingCapabilityOutputFinalizations: [pendingOutput],
} as ProviderState)

describe('Capability output finalization', () => {
    it('fails closed when a Capability Artifact has no registered finalizer', async () => {
        await expect(finalizePendingCapabilityOutputsForState(state()))
            .rejects.toThrow('CAPABILITY_OUTPUT_FINALIZER_NOT_REGISTERED:fixture-artifact')
    })
})
