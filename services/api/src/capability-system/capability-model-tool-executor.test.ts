import { describe, expect, it, vi } from 'vitest'

import {
    type CapabilityDispatcher,
    SealedResolvedCapabilityPlan,
} from '@lixpi/capability-system/backend'
import type {
    CapabilityManifest,
    CapabilityResourceRef,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'

import type { ProviderState } from '../llm/graph/state.ts'
import {
    CapabilityModelToolExecutor,
    shouldExposeCapabilityModelTools,
} from './capability-model-tool-executor.ts'

function makePlan(executionPolicy: 'model-choice' | 'required' = 'model-choice'): SealedResolvedCapabilityPlan {
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
})
