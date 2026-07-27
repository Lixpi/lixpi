'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityActionExecutionContext } from '@lixpi/capability-system/backend'

const mocks = vi.hoisted(() => ({
    asset: { get: vi.fn() },
    blob: { get: vi.fn() },
    aiModel: { getAiModel: vi.fn() },
    requesterContext: { get: vi.fn() },
}))

vi.mock('../../models/asset.ts', () => ({ default: mocks.asset }))
vi.mock('../../models/blob.ts', () => ({ default: mocks.blob }))
vi.mock('../../models/ai-model.ts', () => ({ default: mocks.aiModel }))
vi.mock('../../services/asset-requester-context.ts', () => ({ getAssetRequesterContext: mocks.requesterContext.get }))

import { resolveStyleExtractionInput } from './style-extraction-input-resolver.ts'

function makeContext(overrides: Partial<CapabilityActionExecutionContext> = {}): CapabilityActionExecutionContext {
    return {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        conversationAssetId: 'thread-1',
        rootCapabilityId: 'global.style-extraction',
        runId: 'run-1',
        origin: 'panel',
        stepId: 'initialize',
        attempt: 1,
        signal: new AbortController().signal,
        plan: {} as any,
        getResource: vi.fn(),
        getRunEvents: () => [],
        ...overrides,
    }
}

function readyImageAsset(overrides: Record<string, any> = {}) {
    return {
        assetId: 'asset-1',
        organizationId: 'org-1',
        media: {
            kind: 'image',
            modelSafe: true,
            renditions: {
                canonical: { status: 'ready', blobHash: 'canonical-hash' },
                original: { status: 'ready', blobHash: 'original-hash' },
            },
        },
        ...overrides,
    }
}

describe('resolveStyleExtractionInput', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.requesterContext.get.mockResolvedValue({ organizationIds: ['org-1'] })
        mocks.asset.get.mockResolvedValue(readyImageAsset())
        mocks.blob.get.mockResolvedValue({ bucketName: 'bucket-1', objectKey: 'object-1' })
        mocks.aiModel.getAiModel.mockResolvedValue({ provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5' })
    })

    it('resolves a full input from prompt, source assets, and an analysis model id', async () => {
        const result = await resolveStyleExtractionInput({
            prompt: 'extract this style',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())

        expect(result).toMatchObject({
            styleExtractionRunId: 'thread-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'org-1',
            intent: 'extract this style',
            sourceAssetIds: ['asset-1'],
            analysisProvider: 'OpenAI',
            analysisModel: { provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5' },
            imageProvider: undefined,
            imageModel: undefined,
        })
        expect(result.messages).toEqual([{
            role: 'user',
            content: [
                { type: 'input_text', text: 'extract this style' },
                { type: 'input_image', image_url: 'nats-obj://bucket-1/object-1' },
            ],
        }])
    })

    it('falls back to the run id when there is no conversation asset id', async () => {
        const result = await resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext({ conversationAssetId: undefined }))

        expect(result.styleExtractionRunId).toBe('run-1')
    })

    it('uses an explicit intent over the prompt when provided', async () => {
        const result = await resolveStyleExtractionInput({
            prompt: 'raw prompt',
            intent: '  a hand-painted, gritty texture  ',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())

        expect(result.intent).toBe('a hand-painted, gritty texture')
    })

    it('resolves an optional image model id in addition to the analysis model', async () => {
        mocks.aiModel.getAiModel.mockImplementation(async ({ provider, model }: { provider: string, model: string }) => ({
            provider,
            model,
            modelVersion: model,
        }))

        const result = await resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            imageModelId: 'Google:gemini-2.5-flash-image',
            sourceAssetIds: ['asset-1'],
        }, makeContext())

        expect(result.imageProvider).toBe('Google')
        expect(result.imageModel).toMatchObject({ provider: 'Google', model: 'gemini-2.5-flash-image' })
    })

    it('deduplicates repeated source asset ids', async () => {
        const result = await resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1', 'asset-1'],
        }, makeContext())

        expect(result.sourceAssetIds).toEqual(['asset-1'])
        expect(mocks.asset.get).toHaveBeenCalledTimes(1)
    })

    it('prefers the modelSafe original rendition when canonical is not ready', async () => {
        mocks.asset.get.mockResolvedValue(readyImageAsset({
            media: {
                kind: 'image',
                modelSafe: true,
                renditions: {
                    canonical: { status: 'processing' },
                    original: { status: 'ready', blobHash: 'original-hash' },
                },
            },
        }))

        await resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())

        expect(mocks.blob.get).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'original-hash' })
    })

    it.each([
        [{ prompt: '', analysisModelId: 'OpenAI:gpt-5', sourceAssetIds: ['asset-1'] }, 'prompt is required'],
        [{ prompt: 'x', analysisModelId: '', sourceAssetIds: ['asset-1'] }, 'analysisModelId is required'],
        [{ prompt: 'x', analysisModelId: 'OpenAI:gpt-5', sourceAssetIds: [] }, 'sourceAssetIds must contain Asset ids'],
        [{ prompt: 'x', analysisModelId: 'OpenAI:gpt-5', sourceAssetIds: [123] }, 'sourceAssetIds must contain Asset ids'],
    ])('rejects invalid input %j', async (input, message) => {
        await expect(resolveStyleExtractionInput(input as any, makeContext())).rejects.toThrow(message)
    })

    it('rejects when a source Asset is not an image', async () => {
        mocks.asset.get.mockResolvedValue({ assetId: 'asset-1', organizationId: 'org-1', media: { kind: 'document' } })

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Image Asset asset-1 is unavailable')
    })

    it('rejects when a source Asset lookup returns an error', async () => {
        mocks.asset.get.mockResolvedValue({ error: 'NOT_FOUND' })

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Image Asset asset-1 is unavailable')
    })

    it('rejects a source Asset from outside the run organization', async () => {
        mocks.asset.get.mockResolvedValue(readyImageAsset({ organizationId: 'org-2' }))

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Image Asset asset-1 is outside the run organization')
    })

    it('adopts the first Asset organization id when the run context has none yet', async () => {
        mocks.asset.get.mockResolvedValue(readyImageAsset({ organizationId: 'org-9' }))

        const result = await resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext({ organizationId: undefined }))

        expect(result.organizationId).toBe('org-9')
    })

    it('rejects when neither rendition is ready', async () => {
        mocks.asset.get.mockResolvedValue(readyImageAsset({
            media: { kind: 'image', modelSafe: false, renditions: { canonical: { status: 'processing' } } },
        }))

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Image Asset asset-1 is not ready')
    })

    it('rejects when the ready rendition blob is unavailable', async () => {
        mocks.blob.get.mockResolvedValue(null)

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:gpt-5',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Image Asset asset-1 content is unavailable')
    })

    it('rejects a malformed model id with no provider/model separator', async () => {
        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'not-a-valid-id',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('Invalid AI model id not-a-valid-id')
    })

    it('rejects an analysis model id that AiModel cannot resolve', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue(null)

        await expect(resolveStyleExtractionInput({
            prompt: 'extract',
            analysisModelId: 'OpenAI:missing-model',
            sourceAssetIds: ['asset-1'],
        }, makeContext())).rejects.toThrow('AI model OpenAI:missing-model was not found')
    })
})
