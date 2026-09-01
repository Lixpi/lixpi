import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    CapabilityActionRegistry,
    type CapabilityActionExecutionContext,
    type CapabilityStructuredModelPort,
} from '../../../backend/index.ts'
import {
    ACTION_TIMELINE_TOOL_ID,
    type ActionTimelineGridSlot,
} from '../shared/action-timeline.ts'
import {
    planActionTimelineBatches,
    registerActionTimelineActions,
    type ActionTimelineBackendDependencies,
} from './action-timeline-actions.ts'

function makeContext(): CapabilityActionExecutionContext {
    return {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        conversationAssetId: 'conversation-1',
        rootCapabilityId: ACTION_TIMELINE_TOOL_ID,
        runId: 'run-1',
        origin: 'prompt',
        invocationGenerationRequestId: 'generation-1',
        variant: {
            axis: 'reasoning-model',
            variantKey: 'reasoning:0:Anthropic:claude',
            reasoningIndex: 0,
            reasoningModelId: 'Anthropic:claude',
            provider: 'Anthropic',
            modelVersion: 'claude',
            contextWindow: 32000,
            maxCompletionSize: 1024,
        },
        stepId: 'write-segments',
        attempt: 1,
        signal: new AbortController().signal,
        plan: { serializable: { resolvedManifests: [] } } as CapabilityActionExecutionContext['plan'],
        getResource: () => undefined,
        getRunEvents: () => [],
    }
}

function validBatch(slotIndex: number, continuity: string) {
    return {
        parsed: {
            segments: [{ slotIndex, runs: [{ text: `Beat ${slotIndex}` }] }],
            continuity,
        },
    }
}

function makeDependencies(
    modelOverrides: Partial<CapabilityStructuredModelPort> = {},
): ActionTimelineBackendDependencies {
    return {
        resolveModelInputs: vi.fn(async () => []),
        model: {
            assertSupportedInputs: vi.fn(),
            assessInputBudget: vi.fn(async request => ({
                inputTokens: 100,
                reservedCompletionTokens: request.maxTokens,
                contextWindow: request.variant.contextWindow,
            })),
            call: vi.fn(async () => validBatch(0, 'next')),
            ...modelOverrides,
        },
        persistArtifact: vi.fn(async () => ({ assetId: 'artifact-1' })),
    }
}

describe('Action Timeline registered actions', () => {
    it('registers only its three authorized actions', async () => {
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, makeDependencies())

        expect(registry.allowedActionKeys()).toEqual(
            new Set([
                'action-timeline.validate-request',
                'action-timeline.write-segments',
                'action-timeline.persist-timeline',
            ]),
        )
        expect(
            await registry.get('action-timeline.write-segments').authorize({
                ...makeContext(),
                rootCapabilityId: 'global.unrelated',
            }, {}),
        ).toBe(false)
    })

    it('validates timing, deduplicates references, and resolves every input before model dispatch', async () => {
        const dependencies = makeDependencies()
        dependencies.resolveModelInputs = vi.fn(async ({ assetIds }) =>
            assetIds.map(assetId => ({
                kind: 'document-text' as const,
                assetId,
                marker: `<${assetId}>`,
                title: assetId,
                text: assetId,
            }))
        )
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const context = makeContext()

        const prepared = await registry.get('action-timeline.validate-request').execute({
            prompt: '  A timed sequence  ',
            durationMs: 2500,
            precisionMs: 1000,
            referenceAssetIds: ['asset-a', 'asset-a', 'asset-b'],
        }, context)

        expect(prepared).toMatchObject({
            input: {
                prompt: 'A timed sequence',
                durationMs: 2500,
                precisionMs: 1000,
                referenceAssetIds: ['asset-a', 'asset-b'],
            },
            grid: [
                { slotIndex: 0, startMs: 0, endMs: 1000 },
                { slotIndex: 1, startMs: 1000, endMs: 2000 },
                { slotIndex: 2, startMs: 2000, endMs: 2500 },
            ],
        })
        expect(dependencies.resolveModelInputs).toHaveBeenCalledWith({
            assetIds: ['asset-a', 'asset-b'],
            context,
        })
    })

    it('plans bounded batches from the completion budget', () => {
        const grid: ActionTimelineGridSlot[] = Array.from({ length: 10 }, (_, slotIndex) => ({
            slotIndex,
            startMs: slotIndex * 1000,
            endMs: (slotIndex + 1) * 1000,
        }))
        expect(planActionTimelineBatches(grid, 5120).map(batch => batch.length)).toEqual([4, 4, 2])
        expect(planActionTimelineBatches(grid, 100).every(batch => batch.length === 1)).toBe(true)
    })

    it('uses accepted continuity sequentially and gives one invalid batch a complete correction attempt', async () => {
        const call = vi.fn()
            .mockResolvedValueOnce({ parsed: { segments: [], continuity: 'rejected continuity' } })
            .mockResolvedValueOnce(validBatch(0, 'accepted zero'))
            .mockResolvedValueOnce(validBatch(1, 'accepted one'))
        const dependencies = makeDependencies({ call })
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const prepared = {
            input: {
                prompt: 'Write two beats',
                durationMs: 2000,
                precisionMs: 1000,
                referenceAssetIds: [],
            },
            grid: [
                { slotIndex: 0, startMs: 0, endMs: 1000 },
                { slotIndex: 1, startMs: 1000, endMs: 2000 },
            ],
            modelInputs: [],
        }

        const written = await registry.get('action-timeline.write-segments').execute({ prepared }, makeContext())

        expect(written).toMatchObject({
            segments: [
                { slotIndex: 0, runs: [{ text: 'Beat 0' }] },
                { slotIndex: 1, runs: [{ text: 'Beat 1' }] },
            ],
        })
        expect(call).toHaveBeenCalledTimes(3)
        expect(call.mock.calls[1]![0].userPrompt).toContain('Correction required')
        expect(call.mock.calls[1]![0].userPrompt).toContain('ACTION_TIMELINE_BATCH_SLOTS_INVALID')
        expect(call.mock.calls[2]![0].userPrompt).toContain('accepted zero')
        expect(call.mock.calls[2]![0].userPrompt).not.toContain('rejected continuity')
    })

    it('normalizes every canonical cited title in model prose into an Asset reference run', async () => {
        const call = vi.fn(async () => ({
            parsed: {
                segments: [{
                    slotIndex: 0,
                    runs: [{ text: "Shelby boards Slop Train while Shelby's bag remains visible." }],
                }],
                continuity: 'Shelby is aboard Slop Train.',
            },
        }))
        const dependencies = makeDependencies({ call })
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const prepared = {
            input: {
                prompt: 'Show Shelby boarding Slop Train',
                durationMs: 1000,
                precisionMs: 1000,
                referenceAssetIds: ['asset-shelby', 'asset-train'],
            },
            grid: [{ slotIndex: 0, startMs: 0, endMs: 1000 }],
            modelInputs: [{
                kind: 'image' as const,
                assetId: 'asset-shelby',
                title: 'Shelby',
                marker: '<ref asset:asset-shelby "Shelby">',
                bytes: new Uint8Array([0x89, 0x50, 0x4e]),
                mimeType: 'image/png',
            }, {
                kind: 'video-frame' as const,
                assetId: 'asset-train',
                title: 'Slop Train',
                marker: '<ref asset:asset-train "Slop Train">',
                bytes: new Uint8Array([0xff, 0xd8, 0xff]),
                mimeType: 'image/jpeg',
            }],
        }

        const written = await registry.get('action-timeline.write-segments').execute({ prepared }, makeContext())

        expect(written).toMatchObject({
            segments: [{
                slotIndex: 0,
                runs: [
                    { assetId: 'asset-shelby' },
                    { text: ' boards ' },
                    { assetId: 'asset-train' },
                    { text: ' while ' },
                    { assetId: 'asset-shelby' },
                    { text: "'s bag remains visible." },
                ],
            }],
        })
        expect(call.mock.calls[0]![0].userPrompt).toContain('Shelby => asset-shelby')
        expect(call.mock.calls[0]![0].userPrompt).toContain('Slop Train => asset-train')
        expect(call.mock.calls[0]![0].userPrompt).toContain('never emit its title as plain text')
    })

    it('rejects an unauthorized cited Asset after one correction and never persists a partial Artifact', async () => {
        const invalid = {
            parsed: {
                segments: [{ slotIndex: 0, runs: [{ assetId: 'asset-unauthorized' }] }],
                continuity: 'bad',
            },
        }
        const dependencies = makeDependencies({ call: vi.fn(async () => invalid) })
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const prepared = {
            input: {
                prompt: 'Write one beat',
                durationMs: 1000,
                precisionMs: 1000,
                referenceAssetIds: ['asset-authorized'],
            },
            grid: [{ slotIndex: 0, startMs: 0, endMs: 1000 }],
            modelInputs: [{
                kind: 'document-text',
                assetId: 'asset-authorized',
                marker: '<asset-authorized>',
                title: 'Authorized',
                text: 'Authorized',
            }],
        }

        await expect(registry.get('action-timeline.write-segments').execute({ prepared }, makeContext()))
            .rejects.toMatchObject({ code: 'CAPABILITY_ACTION_OUTPUT_INVALID' })
        expect(dependencies.model.call).toHaveBeenCalledTimes(2)
        expect(dependencies.persistArtifact).not.toHaveBeenCalled()
    })

    it('rejects ambiguous plain-text titles instead of attaching the wrong same-named Asset', async () => {
        const call = vi.fn(async () => ({
            parsed: {
                segments: [{ slotIndex: 0, runs: [{ text: 'Shelby boards the train.' }] }],
                continuity: 'Shelby is aboard.',
            },
        }))
        const dependencies = makeDependencies({ call })
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const prepared = {
            input: {
                prompt: 'Write one beat',
                durationMs: 1000,
                precisionMs: 1000,
                referenceAssetIds: ['asset-shelby-a', 'asset-shelby-b'],
            },
            grid: [{ slotIndex: 0, startMs: 0, endMs: 1000 }],
            modelInputs: [{
                kind: 'document-text',
                assetId: 'asset-shelby-a',
                marker: '<asset-shelby-a>',
                title: 'Shelby',
                text: 'First Shelby',
            }, {
                kind: 'document-text',
                assetId: 'asset-shelby-b',
                marker: '<asset-shelby-b>',
                title: 'Shelby',
                text: 'Second Shelby',
            }],
        }

        await expect(registry.get('action-timeline.write-segments').execute({ prepared }, makeContext()))
            .rejects.toMatchObject({ code: 'CAPABILITY_ACTION_OUTPUT_INVALID' })
        expect(call).toHaveBeenCalledTimes(2)
        expect(call.mock.calls[1]![0].userPrompt).toContain('ACTION_TIMELINE_REFERENCE_TITLE_AMBIGUOUS:Shelby')
        expect(dependencies.persistArtifact).not.toHaveBeenCalled()
    })

    it('stages only the fully merged document and exposes the output Asset collector', async () => {
        const dependencies = makeDependencies()
        const registry = new CapabilityActionRegistry()
        registerActionTimelineActions(registry, dependencies)
        const action = registry.get('action-timeline.persist-timeline')
        const context = makeContext()
        const output = await action.execute({
            prepared: {
                input: {
                    prompt: 'Write one beat',
                    durationMs: 1000,
                    precisionMs: 1000,
                    referenceAssetIds: ['asset-a'],
                },
                grid: [{ slotIndex: 0, startMs: 0, endMs: 1000 }],
                modelInputs: [{
                    kind: 'video-frame',
                    assetId: 'asset-a',
                    title: 'Slop Train',
                    marker: '<asset-a>',
                    bytes: new Uint8Array([1, 2, 3]),
                    mimeType: 'image/jpeg',
                }],
            },
            written: { segments: [{ slotIndex: 0, runs: [{ text: 'Show ' }, { assetId: 'asset-a' }] }] },
        }, context)

        expect(dependencies.persistArtifact).toHaveBeenCalledWith(expect.objectContaining({
            referencedAssetIds: ['asset-a'],
            context,
        }))
        const persistRequest = dependencies.persistArtifact.mock.calls[0]?.[0]
        const persistedDocument = persistRequest?.document as {
            content?: Array<{ content?: Array<{ content?: Array<{ attrs?: Record<string, unknown> }> }> }>
        }
        expect(persistedDocument.content?.[0]?.content?.[0]?.content?.[1]?.attrs?.mediaKind).toBe('video')
        expect(persistedDocument.content?.[0]?.content?.[0]?.content?.[1]?.attrs?.displayName).toBe('Slop Train')
        expect(output).toMatchObject({ outputKind: 'capabilityArtifact', assetId: 'artifact-1' })
        expect(action.collectOutputAssetIds?.(output)).toEqual(['artifact-1'])
        expect(action.collectCanvasGeometry).toBeUndefined()
    })
})
