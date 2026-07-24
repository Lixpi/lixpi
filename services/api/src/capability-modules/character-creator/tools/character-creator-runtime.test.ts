import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getAsset: vi.fn(),
    createAsset: vi.fn(),
    getAvailableAiModels: vi.fn(),
    getContentAddressedBlob: vi.fn(),
    callStructuredVlm: vi.fn(),
    storeBlob: vi.fn(),
    attachGeneratedAssetNode: vi.fn(),
    settleGeneratedAssetOriginal: vi.fn(),
    materializeAssetProvenance: vi.fn(),
    enqueueProvenanceRebuild: vi.fn(),
}))

vi.mock('../../../models/asset.ts', () => ({ default: { get: mocks.getAsset, create: mocks.createAsset } }))
vi.mock('../../../models/ai-model.ts', () => ({ default: { getAvailableAiModels: mocks.getAvailableAiModels } }))
vi.mock('../../../models/blob.ts', () => ({ default: { store: mocks.storeBlob } }))
vi.mock('../../../services/blob-storage.ts', () => ({ getContentAddressedBlob: mocks.getContentAddressedBlob }))
vi.mock('../../../services/generated-asset-storage.ts', () => ({
    attachGeneratedAssetNode: mocks.attachGeneratedAssetNode,
    settleGeneratedAssetOriginal: mocks.settleGeneratedAssetOriginal,
}))
vi.mock('../../../services/asset-provenance-materializer.ts', () => ({
    materializeAssetProvenance: mocks.materializeAssetProvenance,
}))
vi.mock('../../../services/asset-maintenance-queue.ts', () => ({
    enqueueProvenanceRebuild: mocks.enqueueProvenanceRebuild,
}))
vi.mock('../../../llm/structured-vlm/structured-vlm-client.ts', () => ({ callStructuredVlm: mocks.callStructuredVlm }))

import { createCharacterCreatorActionDependencies } from './character-creator-runtime.ts'

const context = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    conversationAssetId: 'conversation-1',
    rootCapabilityId: 'global.character-creator',
    runId: 'run-1',
    origin: 'prompt' as const,
    invocationGenerationRequestId: 'request-1',
    stepId: 'step-1',
    attempt: 1,
    signal: new AbortController().signal,
    plan: { serializable: { resolvedManifests: [] } },
    getResource: vi.fn(),
    getRunEvents: () => [{
        runId: 'run-1',
        sequence: 1,
        eventType: 'STEP_STARTED',
        timestamp: 1,
        runStatus: 'running',
        stepId: 'persist-output',
        stepStatus: 'running',
    }],
} as any

describe('Character Creator production adapters', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('reads only authorized Asset renditions and converts them to model-safe data URLs', async () => {
        mocks.getAsset.mockResolvedValue({
            organizationId: 'organization-1',
            media: {
                renditions: {
                    original: {
                        status: 'ready',
                        blobHash: 'a'.repeat(64),
                        mimeType: 'image/png',
                    },
                },
            },
        })
        mocks.getContentAddressedBlob.mockResolvedValue(new Uint8Array([1, 2, 3]))
        const dependencies = createCharacterCreatorActionDependencies({
            natsService: {} as any,
            imageRouter: {} as any,
        })

        await expect(dependencies.resolveReferences({ assetIds: ['asset-1'], context })).resolves.toEqual([{
            assetId: 'asset-1',
            modelUrl: 'data:image/png;base64,AQID',
        }])
        expect(mocks.getAsset).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            requester: expect.objectContaining({
                userId: 'user-1',
                workspaceIds: ['workspace-1'],
                organizationIds: ['organization-1'],
            }),
        }))
    })

    it('uses the configured default image model and includes the one-shot example', async () => {
        mocks.getAvailableAiModels.mockResolvedValue({
            defaultModels: { image: 'Google:image-model', reasoning: 'OpenAI:reasoning-model', video: '' },
            models: [{
                provider: 'Google',
                model: 'image-model',
                modelVersion: 'image-version',
            }],
        })
        const generatedPng = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
        ]).toString('base64')
        const execute = vi.fn().mockResolvedValue({ generatedImages: [generatedPng] })
        const dependencies = createCharacterCreatorActionDependencies({
            natsService: {} as any,
            imageRouter: { execute } as any,
        })

        const candidate = await dependencies.generateImage({
            prompt: 'one character sheet',
            references: [{ assetId: 'asset-1', modelUrl: 'data:image/png;base64,BAUG' }],
            oneShotExample: new Uint8Array([7, 8, 9]),
            context,
        })

        expect(candidate.image).toBe(`data:image/png;base64,${generatedPng}`)
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({
                imageProviderName: 'Google',
                imageModelVersion: 'image-version',
                referenceImages: ['data:image/png;base64,BAUG', 'data:image/jpeg;base64,BwgJ'],
            }),
            expect.objectContaining({
                signal: context.signal,
                captureOnly: true,
            }),
        )
    })

    it('meters the structured vision validation call and reports its token usage', async () => {
        mocks.getAvailableAiModels.mockResolvedValue({
            defaultModels: { image: 'Google:image-model', reasoning: 'OpenAI:reasoning-model', video: '' },
            models: [{
                provider: 'OpenAI',
                model: 'reasoning-model',
                modelVersion: 'reasoning-version',
            }],
        })
        const assessment = {
            isSingleImage: true,
            hasPortrait: true,
            hasFrontView: true,
            hasLeftView: true,
            hasRightView: true,
            hasBackView: true,
            hasThreeQuarterView: true,
            hasWalkingPose: true,
            fullHeightViewsUncropped: true,
            identityConsistent: true,
            outfitConsistent: true,
            labelsCorrect: true,
            issues: [],
        }
        mocks.callStructuredVlm.mockResolvedValue({
            parsed: assessment,
            promptTokens: 25,
            completionTokens: 10,
        })
        const metrics = {
            check: vi.fn().mockResolvedValue({ approved: true, operationId: 'operation-1' }),
            confirm: vi.fn().mockResolvedValue(undefined),
        }
        const dependencies = createCharacterCreatorActionDependencies({
            natsService: {} as any,
            imageRouter: {} as any,
            metrics: metrics as any,
        })

        await expect(dependencies.assessSheet({
            image: 'data:image/png;base64,AQID',
            context,
        })).resolves.toEqual(assessment)
        expect(metrics.check).toHaveBeenCalledWith(expect.objectContaining({
            model: 'reasoning-version',
            modality: 'tokens',
        }))
        expect(metrics.confirm).toHaveBeenCalledWith(expect.objectContaining({
            operationId: 'operation-1',
            usage: { promptTokens: 25, completionTokens: 10 },
        }))
    })

    it('settles the final sheet without bypassing the standard lineage projection', async () => {
        mocks.storeBlob.mockResolvedValue({ blobHash: 'b'.repeat(64) })
        mocks.createAsset.mockResolvedValue({ assetId: 'created' })
        mocks.settleGeneratedAssetOriginal.mockImplementation(async ({ generationRun }) => {
            const assetId = generationRun.lineageAssignment.assetId
            return {
                assetId,
                organizationId: 'organization-1',
                url: `/api/assets/${assetId}/renditions/original`,
            }
        })
        mocks.materializeAssetProvenance.mockResolvedValue(undefined)
        const publish = vi.fn()
        const dependencies = createCharacterCreatorActionDependencies({
            natsService: { publish } as any,
            imageRouter: {} as any,
        })
        const runtimeContext = {
            ...context,
            plan: {
                serializable: {
                    resolvedManifests: [{ capabilityId: 'global.character-creator', manifestBlobHash: 'c'.repeat(64) }],
                },
            },
        }

        const result = await dependencies.persistSheet({
            candidate: {
                image: `data:image/png;base64,${Buffer.from([
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                    0x00, 0x00, 0x04, 0xb0, 0x00, 0x00, 0x03, 0x20,
                ]).toString('base64')}`,
                providerMetadata: { modelId: 'Google:image-model', sourceAssetIds: ['asset-1'] },
            },
            validation: {
                isSingleImage: true,
                hasPortrait: true,
                hasFrontView: true,
                hasLeftView: true,
                hasRightView: true,
                hasBackView: true,
                hasThreeQuarterView: true,
                hasWalkingPose: true,
                fullHeightViewsUncropped: true,
                identityConsistent: true,
                outfitConsistent: true,
                labelsCorrect: true,
                issues: [],
                passed: true,
            },
            correctionAttempts: 0,
            context: runtimeContext,
        })

        expect(result).toEqual({ assetId: expect.stringMatching(/^asset-/) })
        expect(mocks.createAsset).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'organization-1',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            lineage: expect.objectContaining({
                sourceAssetIds: ['asset-1'],
                generationRequestId: 'request-1',
            }),
            states: expect.objectContaining({
                lifecycle: 'creating',
                provenance: 'sealed',
                media: 'processing',
            }),
            documents: {
                provenance: expect.objectContaining({
                    blobHash: 'b'.repeat(64),
                    schemaVersion: 'capability-output-provenance-v1',
                }),
            },
        }))
        expect(mocks.settleGeneratedAssetOriginal).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            originalName: 'generated-image.png',
            mimeType: 'image/png',
            kind: 'image',
            width: 1200,
            height: 800,
            generationRun: expect.objectContaining({ generationRequestId: 'request-1' }),
        }))
        expect(mocks.attachGeneratedAssetNode).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
    })
})
