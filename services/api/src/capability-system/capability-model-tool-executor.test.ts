import { describe, expect, it, vi } from 'vitest'

import {
    type CapabilityDispatcher,
    directCapabilityToolName,
    SealedResolvedCapabilityPlan,
} from '@lixpi/capability-system/backend'
import type {
    CapabilityManifest,
    CapabilityResourceRef,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'

import type { ProviderState } from '../llm/graph/state.ts'
import {
    buildAnthropicRequiredCapabilityToolChoice,
    buildGoogleRequiredCapabilityToolConfig,
    buildOpenAIRequiredCapabilityToolChoice,
    CapabilityModelToolExecutor,
    shouldExposeCapabilityModelTools,
} from './capability-model-tool-executor.ts'

function makePlan(
    executionPolicy: 'model-choice' | 'model-required' | 'required' = 'model-choice',
): SealedResolvedCapabilityPlan {
    const ref: CapabilityResourceRef = {
        resourceId: 'input',
        blobHash: 'input-hash',
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'discovered-tool',
        kind: 'tool',
        name: 'Discovered Tool',
        description: 'Discovered Tool',
        references: [],
        resources: [ref],
        tool: {
            toolType: 'test',
            inputSchema: ref,
            outputSchema: ref,
            executionPolicy,
            executionMultiplicity: executionPolicy === 'model-required' ? 'per-reasoning-model' : 'once',
            modelAxisPolicy: {
                reasoning: executionPolicy === 'model-required' ? 'all-selected' : 'ignore',
                image: 'ignore',
                video: 'ignore',
                outputMode: executionPolicy === 'model-required' ? 'capability-only' : 'continue-media-generation',
            },
            workflow: { steps: [], outputs: {} },
        },
    }
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: ['discovered-tool'],
        capabilities: [{ capabilityId: 'discovered-tool', kind: 'tool', manifestBlobHash: 'hash', manifest }],
        resolvedManifests: [{ capabilityId: 'discovered-tool', manifestBlobHash: 'hash' }],
    }
    return new SealedResolvedCapabilityPlan(serializable, [{
        capabilityId: 'discovered-tool',
        ref,
        bytes: new TextEncoder().encode(JSON.stringify({
            type: 'object',
            properties: {
                prompt: { type: 'string' },
                referenceAssetIds: { type: 'array', items: { type: 'string' } },
            },
        })),
    }])
}

describe('CapabilityModelToolExecutor', () => {
    it('builds the provider-native forced-tool contracts', () => {
        expect(buildAnthropicRequiredCapabilityToolChoice('timeline')).toEqual({
            type: 'tool',
            name: 'timeline',
        })
        expect(buildOpenAIRequiredCapabilityToolChoice('timeline')).toEqual({
            type: 'function',
            name: 'timeline',
        })
        expect(buildGoogleRequiredCapabilityToolConfig('timeline')).toEqual({
            functionCallingConfig: {
                mode: 'ANY',
                allowedFunctionNames: ['timeline'],
            },
        })
    })

    it('seals a model-discovered Tool before schema-aware explicit chip injection', async () => {
        const plan = makePlan()
        const use = vi.fn(async () => ({
            run: { runId: 'run-1', status: 'completed', outputAssetIds: [] },
            output: { ok: true },
            stepOutputs: {},
        }))
        const dispatcher = {
            resolveToolPlan: vi.fn(async () => plan),
            use,
        } as unknown as CapabilityDispatcher
        const state = {
            messages: [{ role: 'user', content: 'Create it' }],
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            workspaceId: 'workspace-1',
            aiChatThreadId: 'conversation-1',
            workspaceContextSnapshot: {
                nodes: [
                    { assetId: 'asset-2', isExplicitChip: true },
                    { assetId: 'asset-1', isExplicitChip: true },
                ],
            },
        } as ProviderState
        const executor = new CapabilityModelToolExecutor(state, dispatcher)

        await executor.execute({
            callId: 'call-1',
            name: 'use_capability',
            arguments: {
                capabilityId: 'discovered-tool',
                arguments: { prompt: 'Create it' },
            },
        }, new AbortController().signal)

        expect(dispatcher.resolveToolPlan).toHaveBeenCalledOnce()
        expect(use).toHaveBeenCalledWith(expect.objectContaining({
            sealedPlan: plan,
            arguments: {
                prompt: 'Create it',
                referenceAssetIds: ['asset-2', 'asset-1'],
            },
        }))
    })

    it('does not expose discovery tools after a required root Tool has already executed', () => {
        const state = {
            capabilityInvocationDepth: 0,
            resolvedCapabilityPlan: makePlan('required'),
        } as ProviderState

        expect(shouldExposeCapabilityModelTools(state)).toBe(false)
    })

    it('forces an attached model-required Tool once, preserves authoritative prompt inputs, and emits its trace', async () => {
        const plan = makePlan('model-required')
        const trace = vi.fn()
        const use = vi.fn(async () => ({
            run: { runId: 'run-timeline', status: 'completed', outputAssetIds: ['timeline-asset'] },
            output: { outputKind: 'capabilityArtifact', assetId: 'timeline-asset' },
            stepOutputs: {},
            events: [{
                eventType: 'STEP_COMPLETED',
                runId: 'run-timeline',
                capabilityId: 'discovered-tool',
                stepId: 'persist',
                stepTitle: 'Persist timeline',
                safeOutputSummary: 'Timeline persisted',
                timestamp: 1,
            }],
        }))
        const state = {
            messages: [{ role: 'user', content: 'Create a 15 second timeline with 2 second gaps' }],
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            workspaceId: 'workspace-1',
            aiChatThreadId: 'conversation-1',
            provider: 'Anthropic',
            modelVersion: 'claude-haiku-4-5',
            aiModelMetaInfo: { model: 'claude-haiku-4-5', contextWindow: 200_000, maxCompletionSize: 8_192 },
            maxCompletionSize: 8_192,
            resolvedCapabilityPlan: plan,
            capabilityInputs: {
                'discovered-tool': { durationMs: 15_000, precisionMs: 2_000 },
            },
            generationRun: {
                requestKind: 'media-generation-matrix',
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-haiku-4-5',
                reasoningIndex: 0,
            },
        } as ProviderState
        const executor = new CapabilityModelToolExecutor(
            state,
            { use } as unknown as CapabilityDispatcher,
            { onGenerationTrace: trace },
        )
        const toolName = directCapabilityToolName('discovered-tool')

        expect(executor.pendingRequiredToolName()).toBe(toolName)

        await executor.execute({
            callId: 'call-timeline',
            name: toolName,
            arguments: { durationMs: 1, precisionMs: 1 },
        }, new AbortController().signal)

        expect(use).toHaveBeenCalledWith(expect.objectContaining({
            arguments: expect.objectContaining({
                prompt: 'Create a 15 second timeline with 2 second gaps',
                durationMs: 15_000,
                precisionMs: 2_000,
            }),
            invocationGenerationRequestId: 'request-1',
            variant: expect.objectContaining({
                axis: 'reasoning-model',
                reasoningModelId: 'Anthropic:claude-haiku-4-5',
            }),
        }))
        expect(executor.pendingRequiredToolName()).toBeUndefined()
        expect(executor.definitions()).toEqual([])
        expect(state.capabilityOutputAssetIds).toEqual(['timeline-asset'])
        expect(state.capabilityOutputMediaAssetIds).toEqual([])
        expect(trace).toHaveBeenCalledWith(expect.objectContaining({
            capabilityRunId: 'run-timeline',
            outputAssetIds: ['timeline-asset'],
            steps: [expect.objectContaining({
                stepId: 'persist',
                status: 'completed',
                outputSummary: 'Timeline persisted',
            })],
        }))
    })
})
