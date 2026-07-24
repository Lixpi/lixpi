import { describe, expect, it, vi } from 'vitest'

import type {
    CapabilityManifest,
    CapabilityResourceRef,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'
import { SealedResolvedCapabilityPlan } from '@lixpi/capability-system/backend'

import type { ProviderState } from '../llm/graph/state.ts'
import {
    collectExplicitReferenceAssetIds,
    defaultToolInput,
    executeRequiredCapabilitiesForState,
    requiredCapabilityProducedOutput,
} from './capability-state-resolver.ts'

function makePlan(properties: Record<string, unknown>): SealedResolvedCapabilityPlan {
    const ref: CapabilityResourceRef = {
        resourceId: 'input',
        blobHash: 'input-hash',
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'tool',
        kind: 'tool',
        name: 'Tool',
        description: 'Tool',
        references: [],
        resources: [ref],
        tool: {
            toolType: 'test',
            inputSchema: ref,
            outputSchema: ref,
            executionPolicy: 'required',
            workflow: { steps: [], outputs: {} },
        },
    }
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: ['tool'],
        capabilities: [{ capabilityId: 'tool', kind: 'tool', manifestBlobHash: 'hash', manifest }],
        resolvedManifests: [{ capabilityId: 'tool', manifestBlobHash: 'hash' }],
    }
    return new SealedResolvedCapabilityPlan(serializable, [{
        capabilityId: 'tool',
        ref,
        bytes: new TextEncoder().encode(JSON.stringify({ type: 'object', properties })),
    }])
}

function makeState(plan: SealedResolvedCapabilityPlan): ProviderState {
    return {
        messages: [{
            role: 'user',
            content: [
                { type: 'input_text', text: 'Make' },
                { type: 'input_image', image_url: 'asset://asset-1' },
                { type: 'input_text', text: 'a courier' },
            ],
        }],
        resolvedCapabilityPlan: plan,
        workspaceContextSnapshot: {
            nodes: [
                { assetId: 'asset-2', isExplicitChip: true },
                { assetId: 'asset-1', isExplicitChip: true },
                { assetId: 'asset-2', isExplicitChip: true },
                { assetId: 'ignored', isExplicitChip: false },
            ],
        },
    } as ProviderState
}

describe('Capability state resolver inputs', () => {
    it('extracts array input_text prompt and ordered deduplicated explicit chip Assets', () => {
        const state = makeState(makePlan({
            prompt: { type: 'string' },
            referenceAssetIds: { type: 'array' },
        }))

        expect(defaultToolInput(state, 'tool')).toEqual({
            prompt: 'Make\na courier',
            referenceAssetIds: ['asset-2', 'asset-1'],
        })
        expect(collectExplicitReferenceAssetIds(state)).toEqual(['asset-2', 'asset-1'])
    })

    it('does not inject a reference field absent from the Tool schema', () => {
        const state = makeState(makePlan({ prompt: { type: 'string' } }))

        expect(defaultToolInput(state, 'tool')).toEqual({ prompt: 'Make\na courier' })
    })

    it('marks a required Tool output Asset as terminal for ordinary media generation', async () => {
        const state = {
            ...makeState(makePlan({ prompt: { type: 'string' } })),
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            enableImageGeneration: true,
            enableVideoGeneration: true,
        } as ProviderState
        const dispatcher = {
            use: vi.fn(async () => ({
                run: {
                    runId: 'run-1',
                    outputAssetIds: ['asset-output', 'asset-output'],
                },
                output: { assetId: 'asset-output' },
            })),
        }

        const update = await executeRequiredCapabilitiesForState(
            state,
            dispatcher as any,
            new AbortController().signal,
        )

        expect(update).toMatchObject({
            capabilityOutputAssetIds: ['asset-output'],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        })
        expect(requiredCapabilityProducedOutput({ ...state, ...update })).toBe(true)
    })

    it('forwards the generic media-generation output contract without inspecting Tool identity', async () => {
        const state = {
            ...makeState(makePlan({ prompt: { type: 'string' } })),
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
        } as ProviderState
        const dispatcher = {
            use: vi.fn(async () => ({
                run: { runId: 'run-1', outputAssetIds: [] },
                output: {
                    mediaGenerationMode: 'character-creator',
                    preserveUserPrompt: true,
                    visualInstructions: 'Use the sealed layout.',
                    referenceImages: ['data:image/png;base64,AA=='],
                    referenceImageTraceUrls: ['/api/capabilities/tool/resources/example'],
                },
            })),
        }

        const update = await executeRequiredCapabilitiesForState(
            state,
            dispatcher as any,
            new AbortController().signal,
        )

        expect(update).toMatchObject({
            capabilityUsageMode: 'character-creator',
            generatedImagePrompt: 'Make\na courier',
            capabilityUsagePrompt: 'Use the sealed layout.',
            capabilityReferenceImages: ['data:image/png;base64,AA=='],
            capabilityReferenceImageTraceUrls: ['/api/capabilities/tool/resources/example'],
        })
    })
})
