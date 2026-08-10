'use strict'

import { describe, expect, it, vi } from 'vitest'
import {
    NATS_SUBJECTS,
    type CharacterFidelityAssessmentRequest,
} from '@lixpi/constants'
import {
    buildCharacterSheetRenderPlan,
    type CapabilityMediaExecutionContext,
} from '@lixpi/capability-system/backend'

const mocks = vi.hoisted(() => ({
    assetGet: vi.fn(),
    blobGet: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({ default: { get: mocks.assetGet } }))
vi.mock('../services/blob-storage.ts', () => ({ getContentAddressedBlob: mocks.blobGet }))

import { createCharacterCreatorRuntimePorts } from './character-creator-platform-adapter.ts'

const imageReferenceCapabilities = {
    maxReferenceImages: 16,
    maxIdentityReferenceImages: 5,
    conditioningModes: ['edit', 'identity', 'style'] as const,
    inputFidelity: 'high' as const,
    supportsIterativeEdit: true,
    supportsMask: true,
    supportsStructureControl: false,
    supportsPoseControl: false,
    supportsDeterministicSeed: false,
    maxOutputPixels: 1_572_864,
    supportedAspectRatios: ['1:1', '3:2'],
}

const createContext = (): CapabilityMediaExecutionContext => ({
    organizationId: 'org-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'thread-1',
    generationRequestId: 'request-1',
    mediaRunId: 'media-1',
    reasoningModel: { provider: 'OpenAI', modelVersion: 'reasoning-1' },
    imageModel: {
        provider: 'OpenAI',
        modelVersion: 'gpt-image-1.5',
        requestedSize: '3:2',
        meta: {
            provider: 'OpenAI',
            model: 'gpt-image-1.5',
            modelVersion: 'gpt-image-1.5',
            imageSizeMode: 'resolution',
            imageSizes: [{ value: '1024x1024' }, { value: '1536x1024' }],
            imageReferenceCapabilities,
        },
    },
    eventMeta: { userId: 'user-1', organizationId: 'org-1' },
})

const fidelityRequest: CharacterFidelityAssessmentRequest = {
    jobId: 'job-1',
    organizationId: 'org-1',
    panelId: 'head-front',
    attemptId: 'attempt-1',
    sources: [],
    candidate: {
        organizationId: 'org-1',
        bucketName: 'transient-media-org-1-files',
        objectKey: `partial-${'a'.repeat(64)}.png`,
        mimeType: 'image/png',
        byteLength: 100,
    },
    expectedFaceVisibility: 'required',
    sourceMedium: 'photograph',
}

describe('Character Creator API platform adapter', () => {
    it('renders through the selected provider and model without catalog defaults', async () => {
        const process = vi.fn(async () => ({
            generatedImages: [Buffer.from([1, 2, 3]).toString('base64')],
            imageReferenceAdaptation: {
                included: [{ role: 'original-source' }],
                omitted: [{ role: 'pose-reference' }],
            },
        }))
        const remove = vi.fn()
        const registry = { createTransient: vi.fn(() => ({ process })), remove, stop: vi.fn() }
        const ports = createCharacterCreatorRuntimePorts({ registry: registry as never, natsService: {} as never })
        const plan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Desert courier',
        })
        const panel = plan.panels[0]!
        const result = await ports.imageGeneration.generate({
            context: createContext(),
            plan,
            operationKey: `${plan.capabilityRunId}:${panel.panelId}:1`,
            usageMode: 'character-creator',
            prompt: 'one panel',
            references: [{
                url: 'data:image/png;base64,AQID',
                role: 'original-source',
                fileName: 'source.png',
            }],
        })

        expect(registry.createTransient).toHaveBeenCalledWith(
            expect.stringContaining(`${plan.capabilityRunId}:${panel.panelId}:1`),
            'OpenAI',
        )
        expect(process).toHaveBeenCalledWith(expect.objectContaining({
            aiModelMetaInfo: expect.objectContaining({ modelVersion: 'gpt-image-1.5' }),
            imageSize: '1536x1024',
            capabilityMediaExecutionPlan: plan,
            captureOnlyImageGeneration: true,
        }))
        expect(result.image).toBe(Buffer.from([1, 2, 3]).toString('base64'))
        expect(result.includedReferenceRoles).toEqual(['original-source'])
        expect(result.omittedReferenceRoles).toEqual(['pose-reference'])
        expect(remove).toHaveBeenCalledOnce()
    })

    it('forwards module-owned canonical and adjacent references unchanged', async () => {
        const process = vi.fn(async () => ({ generatedImages: ['AQID'] }))
        const registry = { createTransient: () => ({ process }), remove: vi.fn(), stop: vi.fn() }
        const ports = createCharacterCreatorRuntimePorts({ registry: registry as never, natsService: {} as never })
        const plan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: [],
            userPrompt: 'Character',
        })
        await ports.imageGeneration.generate({
            context: createContext(),
            plan,
            operationKey: `${plan.capabilityRunId}:action-run:1`,
            usageMode: 'character-creator',
            prompt: 'run',
            references: [
                { url: 'data:image/png;base64,AQ==', role: 'canonical-anchor', fileName: 'body-front.png' },
                { url: 'data:image/png;base64,Ag==', role: 'adjacent-angle', fileName: 'head-front.png' },
            ],
        })

        expect(process).toHaveBeenCalledWith(expect.objectContaining({
            imageGenerationReferences: expect.arrayContaining([
                expect.objectContaining({ role: 'canonical-anchor', fileName: 'body-front.png' }),
                expect.objectContaining({ role: 'adjacent-angle', fileName: 'head-front.png' }),
            ]),
        }))
    })

    it('reauthorizes Assets through the API model and exposes only runtime rendition metadata', async () => {
        mocks.assetGet.mockResolvedValue({
            assetId: 'asset-1',
            organizationId: 'org-1',
            media: {
                renditions: {
                    canonical: { status: 'ready', blobHash: 'canonical-hash', mimeType: 'image/png' },
                    original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/jpeg' },
                    preview: { status: 'ready', blobHash: 'preview-hash', mimeType: 'image/webp' },
                },
            },
        })
        const ports = createCharacterCreatorRuntimePorts({ registry: {} as never, natsService: {} as never })

        const asset = await ports.referenceAssets.getAuthorizedAsset({
            assetId: 'asset-1',
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })

        expect(mocks.assetGet).toHaveBeenCalledWith({
            assetId: 'asset-1',
            requester: {
                userId: 'user-1',
                workspaceIds: ['workspace-1'],
                editableWorkspaceIds: ['workspace-1'],
                organizationIds: ['org-1'],
            },
        })
        expect(asset.media?.renditions).toEqual({
            canonical: { status: 'ready', blobHash: 'canonical-hash', mimeType: 'image/png' },
            original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/jpeg' },
        })
    })

    it('uses the internal fidelity subject and stops waiting when cancelled', async () => {
        const response = {
            jobId: 'job-1', panelId: 'head-front', attemptId: 'attempt-1',
            metric: { available: false, unavailableReason: 'source-face-not-found' as const },
            sourceDetections: [], candidateDetections: [],
            detector: { artifactId: 'yunet', sha256: 'a' },
            recognizer: { artifactId: 'sface', sha256: 'b' },
        }
        const natsService = { request: vi.fn(async () => response) }
        const ports = createCharacterCreatorRuntimePorts({ registry: {} as never, natsService: natsService as never })

        await expect(ports.fidelity.assess(fidelityRequest)).resolves.toEqual(response)
        expect(natsService.request).toHaveBeenCalledWith(
            NATS_SUBJECTS.CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL,
            fidelityRequest,
            15_000,
        )

        const pendingNats = { request: vi.fn(() => new Promise(() => undefined)) }
        const pendingPorts = createCharacterCreatorRuntimePorts({ registry: {} as never, natsService: pendingNats as never })
        const controller = new AbortController()
        const assessment = pendingPorts.fidelity.assess(fidelityRequest, controller.signal)
        controller.abort(new Error('cancelled'))

        await expect(assessment).rejects.toThrow('cancelled')
    })
})
