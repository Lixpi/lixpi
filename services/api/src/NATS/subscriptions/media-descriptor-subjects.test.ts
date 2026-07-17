'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    asset: {
        get: vi.fn(),
        updateMetadata: vi.fn(),
        canEditAssetMetadata: vi.fn(),
    },
    blob: {
        get: vi.fn(),
    },
    aiModel: {
        getAiModel: vi.fn(),
    },
    nats: {
        instance: { connectionId: 'nats-1' } as any,
    },
    mediaDescriptor: {
        describeMediaStill: vi.fn(),
        describeTextContent: vi.fn(),
    },
    settings: {
        mediaDescriptor: {
            defaultVlmModelId: 'Anthropic:claude-haiku-4-5',
            defaultVlmMaxTokens: 8192,
        },
    },
    debug: {
        err: vi.fn(),
    },
    requesterContext: {
        get: vi.fn(),
    },
    assetDocumentService: {
        loadCurrentSnapshot: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ err: mocks.debug.err }))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => mocks.nats.instance,
    },
}))

vi.mock('../../models/asset.ts', () => ({
    default: { get: mocks.asset.get, updateMetadata: mocks.asset.updateMetadata },
    canEditAssetMetadata: mocks.asset.canEditAssetMetadata,
}))
vi.mock('../../models/blob.ts', () => ({ default: mocks.blob }))
vi.mock('../../models/ai-model.ts', () => ({ default: mocks.aiModel }))
vi.mock('../../llm/media-descriptor.ts', () => ({
    describeMediaStill: mocks.mediaDescriptor.describeMediaStill,
    describeTextContent: mocks.mediaDescriptor.describeTextContent,
}))
vi.mock('../../settings.ts', () => ({ settings: mocks.settings }))
vi.mock('../../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: mocks.requesterContext.get,
}))
vi.mock('../../services/asset-document-service.ts', () => ({ default: mocks.assetDocumentService }))

import { mediaDescriptorSubjects } from './media-descriptor-subjects.ts'

const getHandler = () => {
    const subscription = mediaDescriptorSubjects.find((candidate) =>
        candidate.subject === NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_DESCRIBE
    )
    if (!subscription) {
        throw new Error('Missing MEDIA_DESCRIBE subject')
    }
    return subscription.handler
}

const requester = {
    userId: 'user-1',
    workspaceIds: ['workspace-1'],
    editableWorkspaceIds: ['workspace-1'],
    organizationIds: ['org-1'],
}

const mediaAsset = {
    assetId: 'asset-1',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    ownerUserId: 'user-1',
    organizationId: 'org-1',
    revision: 1,
    title: 'Old title',
    media: {
        kind: 'image',
        renditions: {
            preview: { status: 'ready', blobHash: 'hash-1' },
            original: { status: 'ready', blobHash: 'hash-0' },
        },
    },
    documents: {},
}

const textAsset = {
    assetId: 'asset-2',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    ownerUserId: 'user-1',
    organizationId: 'org-1',
    revision: 1,
    title: 'Roadmap',
    documents: { content: { docId: 'doc-1' } },
}

describe('MEDIA_DESCRIBE request handling', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.requesterContext.get.mockResolvedValue(requester)
        mocks.asset.canEditAssetMetadata.mockResolvedValue(true)
        mocks.asset.get.mockImplementation(async ({ assetId }: { assetId: string }) =>
            assetId === mediaAsset.assetId ? mediaAsset : assetId === textAsset.assetId ? textAsset : { error: 'NOT_FOUND' })
        mocks.asset.updateMetadata.mockImplementation(async ({ descriptor, title }: any) => ({ descriptor, title }))
        mocks.nats.instance = { connectionId: 'nats-1' }
        mocks.settings.mediaDescriptor.defaultVlmMaxTokens = 8192
        mocks.aiModel.getAiModel.mockResolvedValue({
            provider: 'Anthropic',
            model: 'claude-haiku-4-5',
            maxCompletionSize: 4096,
        })
        mocks.blob.get.mockResolvedValue({ bucketName: 'blob-bucket', objectKey: 'blob-key' })
        mocks.assetDocumentService.loadCurrentSnapshot.mockResolvedValue({ doc: { text: 'Launch notes and priorities' } })
        mocks.mediaDescriptor.describeMediaStill.mockResolvedValue({
            summary: 'A cat sleeping',
            entityTags: ['cat'],
            styleTags: ['soft'],
        })
        mocks.mediaDescriptor.describeTextContent.mockResolvedValue({
            summary: 'A user note',
            entityTags: ['note'],
            styleTags: ['plain'],
        })
    })

    it('describes image inputs with default model settings when the caller omits aiModel', async () => {
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: mediaAsset.assetId,
        })

        expect(mocks.aiModel.getAiModel).toHaveBeenCalledWith({
            provider: 'Anthropic',
            model: 'claude-haiku-4-5',
            omitPricing: true,
        })
        expect(mocks.mediaDescriptor.describeMediaStill).toHaveBeenCalledWith({
            provider: 'Anthropic',
            modelVersion: 'claude-haiku-4-5',
            imageUrl: 'nats-obj://blob-bucket/blob-key',
            natsService: { connectionId: 'nats-1' },
            maxTokens: 4096,
        })
        expect(result).toEqual(expect.objectContaining({
            summary: 'A cat sleeping',
            entityTags: ['cat'],
            styleTags: ['soft'],
        }))
    })

    it('describes a text node when `text` is provided and uses explicit text aiModel', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue({
            provider: 'OpenAI',
            model: 'gpt-4.1',
            maxCompletionSize: 2048,
        })

        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: textAsset.assetId,
            aiModel: 'OpenAI:gpt-4.1',
        })

        expect(mocks.mediaDescriptor.describeTextContent).toHaveBeenCalledWith({
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
            text: 'Launch notes and priorities',
            title: textAsset.title,
            natsService: { connectionId: 'nats-1' },
            maxTokens: 2048,
        })
        expect(result).toEqual(expect.objectContaining({
            summary: 'A user note',
            entityTags: ['note'],
            styleTags: ['plain'],
        }))
    })

    it('returns ASSET_ID_REQUIRED when no assetId is present', async () => {
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
        })

        expect(result).toEqual({ error: 'ASSET_ID_REQUIRED' })
        expect(mocks.requesterContext.get).not.toHaveBeenCalled()
        expect(mocks.aiModel.getAiModel).not.toHaveBeenCalled()
        expect(mocks.mediaDescriptor.describeMediaStill).not.toHaveBeenCalled()
        expect(mocks.mediaDescriptor.describeTextContent).not.toHaveBeenCalled()
    })

    it('returns AI_MODEL_REQUIRED when caller text model id is missing provider:version shape', async () => {
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: textAsset.assetId,
            aiModel: 'gpt-4',
        })

        expect(result).toEqual({ error: 'AI_MODEL_REQUIRED' })
        expect(mocks.aiModel.getAiModel).not.toHaveBeenCalled()
    })

    it('returns AI_MODEL_NOT_FOUND when the selected model cannot be loaded', async () => {
        mocks.settings.mediaDescriptor.defaultVlmMaxTokens = undefined
        mocks.aiModel.getAiModel.mockResolvedValue(undefined)
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: mediaAsset.assetId,
        })

        expect(result).toEqual({ error: 'AI_MODEL_NOT_FOUND:Anthropic:claude-haiku-4-5' })
        expect(mocks.mediaDescriptor.describeMediaStill).not.toHaveBeenCalled()
    })

    it('falls back to default VLM token max when media model metadata has no maxCompletionSize', async () => {
        mocks.aiModel.getAiModel.mockResolvedValue({
            provider: 'Anthropic',
            model: 'claude-haiku-4-5',
        })
        const handler = getHandler()
        await handler({
            user: { userId: 'user-1' },
            assetId: mediaAsset.assetId,
        })

        expect(mocks.mediaDescriptor.describeMediaStill).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'Anthropic',
            modelVersion: 'claude-haiku-4-5',
            maxTokens: 8192,
        }))
    })

    it('returns an empty descriptor error when media captions are blank', async () => {
        mocks.mediaDescriptor.describeMediaStill.mockResolvedValue({
            summary: '  ',
            entityTags: [],
            styleTags: [],
        })
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: mediaAsset.assetId,
        })

        expect(result).toEqual({ error: 'ASSET_DESCRIPTOR_EMPTY' })
    })

    it('returns NATS_UNAVAILABLE when the NATS service instance is missing', async () => {
        mocks.nats.instance = null
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: mediaAsset.assetId,
        })

        expect(result).toEqual({ error: 'NATS_UNAVAILABLE' })
        expect(mocks.mediaDescriptor.describeMediaStill).not.toHaveBeenCalled()
    })

    it('short-circuits with the asset error when the asset cannot be loaded', async () => {
        mocks.asset.get.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })
        const handler = getHandler()

        const result = await handler({
            user: { userId: 'user-1' },
            assetId: textAsset.assetId,
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.mediaDescriptor.describeTextContent).not.toHaveBeenCalled()
    })

    it('returns the underlying VLM failure message as error', async () => {
        mocks.mediaDescriptor.describeTextContent.mockRejectedValue(new Error('vlm-unavailable'))
        const handler = getHandler()
        const result = await handler({
            user: { userId: 'user-1' },
            assetId: textAsset.assetId,
            aiModel: 'OpenAI:gpt-4.1',
        })

        expect(result).toEqual({ error: 'vlm-unavailable' })
        expect(mocks.debug.err).toHaveBeenCalled()
    })
})
