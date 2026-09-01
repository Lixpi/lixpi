import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

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
    hasPendingModelRequiredCapabilityOnlyOutput,
    requiredCapabilityProducedCapabilityOnlyOutput,
    requiredCapabilityProducedOutput,
} from './capability-state-resolver.ts'

function makePlan(
    properties: Record<string, unknown>,
    executionPolicy: 'required' | 'model-required' = 'required',
    capabilityIds: readonly string[] = ['tool'],
): SealedResolvedCapabilityPlan {
    const ref: CapabilityResourceRef = {
        resourceId: 'input',
        blobHash: 'input-hash',
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    const buildManifest = (capabilityId: string): CapabilityManifest => ({
        schemaVersion: 1,
        capabilityId,
        kind: 'tool',
        name: capabilityId,
        description: capabilityId,
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
    })
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: [...capabilityIds],
        capabilities: capabilityIds.map(capabilityId => ({
            capabilityId,
            kind: 'tool' as const,
            manifestBlobHash: `hash-${capabilityId}`,
            manifest: buildManifest(capabilityId),
        })),
        resolvedManifests: capabilityIds.map(capabilityId => ({
            capabilityId,
            manifestBlobHash: `hash-${capabilityId}`,
        })),
    }
    return new SealedResolvedCapabilityPlan(
        serializable,
        capabilityIds.map(capabilityId => ({
            capabilityId,
            ref,
            bytes: new TextEncoder().encode(JSON.stringify({ type: 'object', properties })),
        })),
    )
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
                output: { outputKind: 'capabilityArtifact', assetId: 'asset-output' },
            })),
        }

        const update = await executeRequiredCapabilitiesForState(
            state,
            dispatcher as any,
            new AbortController().signal,
        )

        expect(update).toMatchObject({
            capabilityOutputAssetIds: ['asset-output'],
            capabilityOutputMediaAssetIds: [],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        })
        expect(requiredCapabilityProducedOutput({ ...state, ...update })).toBe(true)
        expect(requiredCapabilityProducedCapabilityOnlyOutput({ ...state, ...update })).toBe(true)
    })

    it('does not classify media-producing Capability output as capability-only', () => {
        expect(requiredCapabilityProducedCapabilityOnlyOutput({
            capabilityOutputAssetIds: ['asset-image'],
            capabilityOutputMediaAssetIds: ['asset-image'],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        } as ProviderState)).toBe(false)
    })

    it('identifies an attached model-required capability-only Tool before model execution', () => {
        const plan = makePlan({ prompt: { type: 'string' } }, 'model-required')

        expect(hasPendingModelRequiredCapabilityOnlyOutput({
            resolvedCapabilityPlan: plan,
        } as ProviderState)).toBe(true)
        expect(hasPendingModelRequiredCapabilityOnlyOutput({
            resolvedCapabilityPlan: plan,
            capabilityToolResults: [{ capabilityId: 'tool', runId: 'run-1', output: {} }],
        } as ProviderState)).toBe(false)
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

    it('aggregates every attached Capability contribution into one shared media state', async () => {
        const state = {
            ...makeState(makePlan(
                { prompt: { type: 'string' } },
                'required',
                ['visual-style-a', 'visual-style-b'],
            )),
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
        } as ProviderState
        const dispatcher = {
            use: vi.fn(async ({ capabilityId }: { capabilityId: string }) => ({
                run: { runId: `run-${capabilityId}`, outputAssetIds: [] },
                output: {
                    mediaGenerationMode: 'visual-style',
                    preserveUserPrompt: true,
                    visualInstructions: `Instruction from ${capabilityId}`,
                    referenceImages: [`data:image/png;base64,${capabilityId}`],
                    referenceImageTraceUrls: [`/api/capabilities/${capabilityId}/resources/sample`],
                },
            })),
        }

        const update = await executeRequiredCapabilitiesForState(
            state,
            dispatcher as any,
            new AbortController().signal,
        )

        expect(update.capabilityUsagePrompt).toBe([
            'Instruction from visual-style-a',
            'Instruction from visual-style-b',
        ].join('\n\n'))
        expect(update.capabilityReferenceImages).toEqual([
            'data:image/png;base64,visual-style-a',
            'data:image/png;base64,visual-style-b',
        ])
        expect(update.capabilityToolResults?.map(result => result.capabilityId)).toEqual([
            'visual-style-a',
            'visual-style-b',
        ])
        expect(update.generatedImagePrompt).toBe('Make\na courier')
    })
})
