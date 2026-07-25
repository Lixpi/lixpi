'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getAsset: vi.fn(),
    getBlob: vi.fn(),
    authorizeCapability: vi.fn(),
    loadSnapshot: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({ default: { get: mocks.getAsset } }))
vi.mock('../models/blob.ts', () => ({ default: { get: mocks.getBlob } }))
vi.mock('../models/capability.ts', () => ({ default: { authorize: mocks.authorizeCapability } }))
vi.mock('./asset-document-service.ts', () => ({ default: { loadCurrentSnapshot: mocks.loadSnapshot } }))

import {
    addPromptReferenceMediaToLatestUserMessage,
    authorizePromptReferences,
} from './prompt-reference-resolver.ts'

const requester = {
    userId: 'user-1',
    workspaceIds: ['workspace-1'],
    editableWorkspaceIds: ['workspace-1'],
    organizationIds: ['organization-1'],
}
const workspace = {
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    canvasState: {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{ nodeId: 'node-1', type: 'image', assetId: 'asset-1' }],
        edges: [],
    },
}
const moduleCatalog = {
    resolveEntry: vi.fn((moduleId: string) => moduleId === 'character-creator'
        ? { capabilityId: 'global.character-creator', kind: 'tool' as const }
        : undefined),
}
const imageAsset = {
    assetId: 'asset-1',
    organizationId: 'organization-1',
    title: 'Portrait',
    scope: 'organization',
    scopeOwnerId: 'organization-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    documents: {},
    media: {
        kind: 'image',
        renditions: {
            canonical: {
                status: 'ready',
                blobHash: 'a'.repeat(64),
                mimeType: 'image/png',
                byteSize: 100,
            },
        },
    },
    states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
    referenceCount: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAsset.mockResolvedValue(imageAsset)
    mocks.getBlob.mockResolvedValue({ bucketName: 'org-assets', objectKey: 'portrait.png' })
    mocks.authorizeCapability.mockImplementation(async ({ capabilityId }: { capabilityId: string }) => {
        if (capabilityId === 'global.character-creator') return {
            capabilityId,
            kind: 'tool',
            parentModuleId: 'character-creator',
            catalogExposure: 'module-internal',
            status: 'active',
        }
        return {
            capabilityId,
            kind: capabilityId.startsWith('skill') ? 'skill' : 'tool',
            catalogExposure: 'standalone',
            status: 'active',
        }
    })
})

describe('authorizePromptReferences', () => {
    it('maps modules to internal entry packages and accepts only standalone package references', async () => {
        const result = await authorizePromptReferences({
            references: [
                { referenceType: 'capability-module', moduleId: 'character-creator' },
                { referenceType: 'skill', capabilityId: 'skill-shot-language' },
            ],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })

        expect(result.capabilityReferences).toEqual([
            { capabilityId: 'global.character-creator', kind: 'tool' },
            { capabilityId: 'skill-shot-language', kind: 'skill' },
        ])

        mocks.authorizeCapability.mockResolvedValueOnce({
            capabilityId: 'tool-internal',
            kind: 'tool',
            parentModuleId: 'other-module',
            catalogExposure: 'module-internal',
            status: 'active',
        })
        await expect(authorizePromptReferences({
            references: [{ referenceType: 'tool', capabilityId: 'tool-internal' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })).rejects.toThrow('PROMPT_REFERENCE_CAPABILITY_UNAVAILABLE:tool-internal')
    })

    it('materializes a global Asset reference without inventing a canvas node', async () => {
        const result = await authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'asset-1', mediaKind: 'image' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })

        expect(result.assetIds).toEqual(['asset-1'])
        expect(result.mediaCandidates).toEqual([
            expect.objectContaining({
                candidateId: 'asset:asset-1',
                assetId: 'asset-1',
                imageUrl: 'nats-obj://org-assets/portrait.png',
            }),
        ])
        expect(result.mediaCandidates[0]).not.toHaveProperty('nodeId')
    })

    it('materializes document text, grounds video by representative frame, and rejects unsupported audio before spend', async () => {
        mocks.getAsset.mockResolvedValueOnce({
            ...imageAsset,
            assetId: 'document-1',
            title: 'Creative brief',
            documents: { content: { role: 'content' } },
            media: undefined,
        })
        mocks.loadSnapshot.mockResolvedValue({
            doc: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use a warm desert palette.' }] }],
            },
        })
        const documentResult = await authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'document-1', mediaKind: 'document' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })
        expect(documentResult.documentContext).toEqual([
            expect.stringContaining('Use a warm desert palette.'),
        ])
        expect(documentResult.mediaCandidates).toEqual([])

        mocks.getAsset.mockResolvedValueOnce({
            ...imageAsset,
            assetId: 'video-1',
            media: {
                kind: 'video',
                renditions: {
                    representativeFrame: {
                        status: 'ready',
                        blobHash: 'b'.repeat(64),
                        mimeType: 'image/jpeg',
                        byteSize: 100,
                    },
                },
            },
        })
        const videoResult = await authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'video-1', mediaKind: 'video' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })
        expect(videoResult.mediaCandidates).toEqual([expect.objectContaining({
            candidateId: 'asset:video-1',
            mediaKind: 'video',
        })])

        mocks.getAsset.mockResolvedValueOnce({
            ...imageAsset,
            assetId: 'audio-1',
            media: { kind: 'audio', renditions: {} },
        })
        await expect(authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'audio-1', mediaKind: 'audio' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })).rejects.toThrow('PROMPT_REFERENCE_AUDIO_INPUT_UNSUPPORTED:audio-1')
    })

    it('rejects forged node/Asset pairs and stale media-kind claims', async () => {
        await expect(authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'asset-1', nodeId: 'missing-node', mediaKind: 'image' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })).rejects.toThrow('PROMPT_REFERENCE_NODE_ASSET_MISMATCH:missing-node')

        await expect(authorizePromptReferences({
            references: [{ referenceType: 'media', assetId: 'asset-1', mediaKind: 'video' }],
            requester,
            workspace: workspace as any,
            moduleCatalog: moduleCatalog as any,
        })).rejects.toThrow('PROMPT_REFERENCE_MEDIA_KIND_MISMATCH:asset-1')
    })
})

describe('addPromptReferenceMediaToLatestUserMessage', () => {
    it('attaches authorized media only to the latest user turn for text-only reasoning', () => {
        const messages = addPromptReferenceMediaToLatestUserMessage(
            [
                { role: 'user', content: 'Earlier request' },
                { role: 'assistant', content: 'Earlier response' },
                { role: 'user', content: 'Use this portrait' },
            ],
            [{
                candidateId: 'asset:asset-1',
                assetId: 'asset-1',
                imageUrl: 'nats-obj://org-assets/portrait.png',
                mediaKind: 'image',
                roleHints: ['base-context'],
                ancestorNodeIds: [],
                sourceContextNodeIds: [],
                entityTags: [],
                styleTags: [],
            }],
        )

        expect(messages[0]?.content).toBe('Earlier request')
        expect(messages[2]?.content).toEqual([
            { type: 'input_text', text: 'Use this portrait' },
            {
                type: 'input_text',
                text: JSON.stringify({
                    type: 'prompt_reference_media',
                    candidateId: 'asset:asset-1',
                    assetId: 'asset-1',
                    mediaKind: 'image',
                }),
            },
            { type: 'input_image', image_url: 'nats-obj://org-assets/portrait.png', detail: 'high' },
        ])
    })
})
