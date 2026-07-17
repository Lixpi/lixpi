'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAM_STATUS } from '@lixpi/constants'
import type { Asset, MediaBranchCandidateImage, WorkspaceContextSnapshot } from '@lixpi/constants'

import * as debugTools from '@lixpi/debug-tools'

// Descriptor self-healing resolves media through BlobModel/AssetModel and
// persists healed descriptors through AssetModel + the asset requester
// context helper. Those hit DynamoDB directly (no deps injection point), so
// they are mocked at the module level rather than through resolver deps.
const blobModelMocks = vi.hoisted(() => ({
    get: vi.fn(async ({ blobHash }: { blobHash: string }) => ({ bucketName: 'workspace-workspace-1-files', objectKey: blobHash })),
}))
const assetModelMocks = vi.hoisted(() => ({
    get: vi.fn(),
    updateMetadata: vi.fn(async (args: { assetId: string; expectedRevision: number }) => ({
        assetId: args.assetId,
        revision: args.expectedRevision + 1,
    })),
}))

vi.mock('../../models/blob.ts', () => ({ default: blobModelMocks }))
vi.mock('../../models/asset.ts', () => ({ default: assetModelMocks }))
vi.mock('../../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: vi.fn(async (userId: string) => ({
        userId,
        workspaceIds: ['workspace-1'],
        editableWorkspaceIds: ['workspace-1'],
        organizationIds: ['org-1'],
    })),
}))

import { resolveWorkspaceContext } from './workspace-context-resolver.ts'
import type { ProviderState } from './state.ts'
import type { VlmCallArgs, VlmCallResult } from '../extraction/vlm-client.ts'

const tinyPngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
)
const resolvedTinyPngUrl = `data:image/png;base64,${tinyPngBytes.toString('base64')}`

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
    debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
    debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)
    blobModelMocks.get.mockClear()
    assetModelMocks.get.mockClear()
    assetModelMocks.updateMetadata.mockClear()
})

afterEach(() => {
    debugInfoSpy?.mockRestore()
    debugInfoSpy = null
    debugWarnSpy?.mockRestore()
    debugWarnSpy = null
    debugErrSpy?.mockRestore()
    debugErrSpy = null
})

const baseWorkspaceSnapshot: WorkspaceContextSnapshot = {
    resolverVersion: 'workspace-context-v1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'conversation-asset-1',
    promptText: 'put the goat beside the cubist dog and mention the chat notes',
    nodes: [
        {
            nodeId: 'root-thread',
            type: 'branchOrigin',
            title: 'Root chat',
            descriptorStatus: 'ready',
            descriptorSummary: 'active canvas chat',
            entityTags: [],
            styleTags: [],
            isExplicitChip: false,
            isEdgeForced: false,
        },
        {
            nodeId: 'cubist-doc',
            type: 'document',
            title: 'Cubist Dog',
            descriptorStatus: 'ready',
            descriptorSummary: 'notes about a cubist dog painting',
            entityTags: ['dog'],
            styleTags: ['cubist'],
            isExplicitChip: false,
            isEdgeForced: false,
        },
        {
            nodeId: 'goat-image',
            type: 'image',
            assetId: 'asset-goat-image',
            descriptorStatus: 'ready',
            descriptorSummary: 'a white goat standing in a field',
            entityTags: ['goat'],
            styleTags: ['photo'],
            branchId: 'branch-goat',
            isExplicitChip: false,
            isEdgeForced: false,
        },
        {
            nodeId: 'team-video',
            type: 'video',
            assetId: 'asset-team-video',
            descriptorStatus: 'ready',
            descriptorSummary: 'team walking through a studio',
            entityTags: ['team'],
            styleTags: ['documentary'],
            isExplicitChip: false,
            isEdgeForced: true,
        },
        {
            nodeId: 'notes-thread',
            type: 'branchOrigin',
            title: 'Seaside notes',
            descriptorStatus: 'ready',
            descriptorSummary: 'chat notes about a seaside village',
            entityTags: ['village'],
            styleTags: [],
            isExplicitChip: false,
            isEdgeForced: false,
        },
        {
            nodeId: 'landscape-image',
            type: 'image',
            assetId: 'asset-landscape-image',
            descriptorStatus: 'ready',
            descriptorSummary: 'unrelated mountain landscape',
            entityTags: ['mountain'],
            styleTags: ['landscape'],
            isExplicitChip: false,
            isEdgeForced: false,
        },
    ],
}

// Backs the mocked BlobModel.get/AssetModel calls: media workspace nodes
// resolve their image URL through Asset -> Blob, which the resolver always
// hits directly (not via injected deps).
const assetById: Record<string, Asset> = {
    'asset-goat-image': {
        assetId: 'asset-goat-image',
        organizationId: 'org-1',
        title: 'Goat',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {},
        media: {
            kind: 'image',
            originalName: 'goat.png',
            sourceMimeType: 'image/png',
            modelSafe: true,
            renditions: { preview: { name: 'preview', status: 'ready', blobHash: 'goat-file', updatedAt: 1 } },
        },
        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
    'asset-team-video': {
        assetId: 'asset-team-video',
        organizationId: 'org-1',
        title: 'Team video',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {},
        media: {
            kind: 'video',
            originalName: 'team.mp4',
            sourceMimeType: 'video/mp4',
            modelSafe: true,
            renditions: { representativeFrame: { name: 'representativeFrame', status: 'ready', blobHash: 'team-poster-file', updatedAt: 1 } },
        },
        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
    'asset-landscape-image': {
        assetId: 'asset-landscape-image',
        organizationId: 'org-1',
        title: 'Landscape',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {},
        media: {
            kind: 'image',
            originalName: 'landscape.png',
            sourceMimeType: 'image/png',
            modelSafe: true,
            renditions: { preview: { name: 'preview', status: 'ready', blobHash: 'landscape-file', updatedAt: 1 } },
        },
        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
}

const baseCandidates: MediaBranchCandidateImage[] = [
    {
        nodeId: 'goat-image',
        assetId: 'asset-goat-image',
        imageUrl: 'nats-obj://workspace-workspace-1-files/goat-file',
        mediaKind: 'image',
        roleHints: ['base-context', 'generated-variant', 'branch-leaf'],
        branchId: 'branch-goat',
        ancestorNodeIds: ['goat-image'],
        sourceContextNodeIds: ['goat-image'],
        visualEntitySummary: 'a white goat standing in a field',
        entityTags: ['goat'],
    },
    {
        nodeId: 'landscape-image',
        assetId: 'asset-landscape-image',
        imageUrl: 'nats-obj://workspace-workspace-1-files/landscape-file',
        mediaKind: 'image',
        roleHints: ['base-context'],
        ancestorNodeIds: ['landscape-image'],
        sourceContextNodeIds: ['landscape-image'],
        visualEntitySummary: 'unrelated mountain landscape',
        entityTags: ['mountain'],
    },
]

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [{ role: 'user', content: 'put the goat beside the cubist dog' }],
        aiModelMetaInfo: {
            provider: 'OpenAI',
            model: 'gpt-4.1',
            modelVersion: 'gpt-4.1',
            maxCompletionSize: 4096,
        },
        eventMeta: { userId: 'user-1', organizationId: 'org-1' },
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'OpenAI',
        modelVersion: 'gpt-4.1',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        imagePromptRetryCount: 0,
        workspaceContextSnapshot: baseWorkspaceSnapshot,
        mediaBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'conversation-asset-1',
            regionNodeId: 'root-thread',
            activeTargetNodeId: 'landscape-image',
            promptText: 'put the goat beside the cubist dog',
            promptFingerprint: 'prompt-1',
            candidates: baseCandidates,
            transcriptContext: 'candidate labels',
        },
        ...overrides,
    }
}

function createDeps(parsedInput: { selections: Array<Record<string, unknown>> } | Array<{ selections: Array<Record<string, unknown>> }>) {
    const parsedRuns = Array.isArray(parsedInput) ? parsedInput : [parsedInput]
    let callIndex = 0
    const published: Array<{ subject: string; payload: any }> = []
    const natsService = {
        getObject: vi.fn(async () => tinyPngBytes),
        publish: vi.fn((subject: string, payload: any) => {
            published.push({ subject, payload })
        }),
    }
    const publisher = {
        contextRelevanceResolved: vi.fn((resolution) => {
            natsService.publish('ai.interaction.chat.receiveMessage.workspace-1.thread-1', {
                content: {
                    status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
                    aiProvider: 'OpenAI',
                    workspaceContextResolution: resolution,
                },
                aiChatThreadId: 'thread-1',
            })
        }),
        contextRelevanceError: vi.fn((message: string) => {
            natsService.publish('ai.interaction.chat.receiveMessage.workspace-1.thread-1', {
                content: {
                    status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                    aiProvider: 'OpenAI',
                    error: message,
                },
                aiChatThreadId: 'thread-1',
            })
        }),
    }
    const callLlm = vi.fn(async (_args: VlmCallArgs): Promise<VlmCallResult<any>> => {
        const parsed = parsedRuns[Math.min(callIndex, parsedRuns.length - 1)]!
        callIndex++
        return {
            parsed,
            rawText: JSON.stringify(parsed),
            modelName: 'gpt-4.1',
            promptTokens: 10,
            completionTokens: 20,
        }
    })
    const getAsset = vi.fn(async (assetId: string) => assetById[assetId] ?? { error: 'ASSET_NOT_FOUND' })
    const describeMediaStill = vi.fn(async () => ({
        summary: 'A healed goat descriptor with useful visual detail.',
        entityTags: ['goat'],
        styleTags: ['field'],
    }))
    const describeTextContent = vi.fn(async () => ({
        summary: 'A healed text descriptor about cubist dog notes.',
        entityTags: ['dog'],
        styleTags: ['notes'],
    }))

    return {
        deps: {
            natsService: natsService as any,
            publisher: publisher as any,
            callLlm,
            getAsset: getAsset as any,
            describeMediaStill: describeMediaStill as any,
            describeTextContent: describeTextContent as any,
        },
        natsService,
        publisher,
        callLlm,
        getAsset,
        describeMediaStill,
        describeTextContent,
        published,
    }
}

function getInputTextBlocks(state: Partial<ProviderState>): string[] {
    const first = state.messages?.[0]
    if (!first || !Array.isArray(first.content)) return []
    return first.content
        .filter((block) => block?.type === 'input_text')
        .map((block) => String(block.text))
}

describe('resolveWorkspaceContext', () => {
    it('uses configured resolver provider and model environment overrides', async () => {
        const previousProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
        const previousModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
        process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = 'Google'
        process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION = 'google-pro-1'

        try {
            const { deps, callLlm } = createDeps({
                selections: [
                    { nodeId: 'goat-image', rationale: 'The goat is most relevant.', needsBetterDescriptor: false },
                ],
            })

            await resolveWorkspaceContext(createState(), deps)
            expect(callLlm).toHaveBeenCalledOnce()
            expect(callLlm.mock.calls[0]?.[0]).toMatchObject({
                provider: 'Google',
                modelVersion: 'google-pro-1',
            })
        } finally {
            if (previousProvider === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = previousProvider
            }
            if (previousModel === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION = previousModel
            }
        }
    })

    it('publishes resolver errors when env provider override is unsupported', async () => {
        const previousProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
        const previousModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
        process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = 'NotAProvider'
        process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION = 'anything'

        try {
            const { deps, publisher } = createDeps({
                selections: [
                    { nodeId: 'goat-image', rationale: 'Fallback should never happen with invalid model', needsBetterDescriptor: false },
                ],
            })

            await expect(resolveWorkspaceContext(createState(), deps)).rejects.toThrow(
                'Workspace context resolver requires a structured-output provider; got NotAProvider',
            )
            expect(publisher.contextRelevanceError).toHaveBeenCalledWith(
                'Workspace context resolver requires a structured-output provider; got NotAProvider',
            )
        } finally {
            if (previousProvider === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = previousProvider
            }
            if (previousModel === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION = previousModel
            }
        }
    })

    it('does not expand a preexisting media-branch snapshot with non-forced auto-picked media', async () => {
        const { deps } = createDeps({
            selections: [
                { nodeId: 'landscape-image', rationale: 'Landscape was chosen by the resolver.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'team-video'
                    ? { ...node, isEdgeForced: false }
                    : node),
            },
            mediaBranchCandidateSnapshot: {
                ...createState().mediaBranchCandidateSnapshot!,
                candidates: [baseCandidates[0]!,],
            },
        }), deps)

        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
    })

    it('expands a missing snapshot with auto-selected media nodes from workspace nodes', async () => {
        const { deps, callLlm } = createDeps({
            selections: [
                { nodeId: 'landscape-image', rationale: 'An unrelated landscape is visually relevant.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            mediaBranchCandidateSnapshot: undefined,
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'team-video'
                    ? { ...node, isEdgeForced: false }
                    : node),
            },
        }), deps)

        expect(update.workspaceContextResolution?.selections.map((selection) => selection.nodeId)).toContain('landscape-image')
        expect(callLlm).toHaveBeenCalledOnce()
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toContain('landscape-image')
    })

    it('runs descriptor self-healing for weak descriptors even without explicit needsBetterDescriptor', async () => {
        const weakSnapshot: WorkspaceContextSnapshot = {
            ...baseWorkspaceSnapshot,
            nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'goat-image'
                ? { ...node, descriptorStatus: 'failed' as const, descriptorSummary: 'goat' }
                : node
            ),
        }
        const { deps, describeMediaStill } = createDeps([
            {
                selections: [
                    { nodeId: 'goat-image', rationale: 'Weak descriptor but likely relevant.', needsBetterDescriptor: false },
                ],
            },
            {
                selections: [
                    { nodeId: 'goat-image', rationale: 'The healed descriptor now strongly matches.', needsBetterDescriptor: false },
                ],
            },
        ])

        await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: weakSnapshot,
        }), deps)

        expect(describeMediaStill).toHaveBeenCalledOnce()
        expect(assetModelMocks.updateMetadata).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-goat-image',
        }))
    })

    it('ranks workspace descriptors, force-includes edge nodes, and assembles selected content', async () => {
        const { deps, publisher, callLlm } = createDeps({
            selections: [
                { nodeId: 'cubist-doc', rationale: 'The prompt names the cubist dog.', needsBetterDescriptor: false },
                { nodeId: 'goat-image', rationale: 'The prompt asks for the goat.', needsBetterDescriptor: false },
                { nodeId: 'notes-thread', rationale: 'The notes may help explain the scene.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState(), deps)
        const selections = update.workspaceContextResolution?.selections

        expect(callLlm).toHaveBeenCalledOnce()
        expect(callLlm.mock.calls[0]?.[0].userMessages[0]?.content).toContain('Workspace node descriptor JSON')
        expect(selections).toEqual([
            { nodeId: 'team-video', role: 'forced-edge' },
            { nodeId: 'cubist-doc', role: 'auto', rationale: 'The prompt names the cubist dog.' },
            { nodeId: 'goat-image', role: 'auto', rationale: 'The prompt asks for the goat.' },
            { nodeId: 'notes-thread', role: 'auto', rationale: 'The notes may help explain the scene.' },
        ])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual(['team-video', 'goat-image'])
        expect(publisher.contextRelevanceResolved).toHaveBeenCalledOnce()

        // notes-thread is a non-document, non-media node: it is rankable but
        // contributes no expanded content block, since only document/image/
        // video nodes are materialized in the selected-context message.
        const textBlocks = getInputTextBlocks(update)
        expect(textBlocks.some((text) => text.includes('notes about a cubist dog painting'))).toBe(true)
        expect(textBlocks.some((text) => text.includes('"type":"workspace_video"'))).toBe(true)
        expect(update.messages?.at(1)).toEqual({ role: 'user', content: 'put the goat beside the cubist dog' })
    })

    it('narrows the media-branch candidate snapshot and adds selected media outside the old candidate set', async () => {
        const { deps } = createDeps({
            selections: [
                { nodeId: 'goat-image', rationale: 'Goat is relevant.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            imageModelVersion: 'gpt-image-1',
            imageProviderName: 'OpenAI',
        }), deps)

        // An existing branch snapshot (from createState's default
        // mediaBranchCandidateSnapshot) only expands for forced-chip/forced-edge
        // selections; the auto-picked goat-image selection cannot re-enter it,
        // so only the edge-forced team-video is added.
        expect(update.mediaBranchCandidateSnapshot?.activeTargetNodeId).toBeUndefined()
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['team-video'])
        const addedVideo = update.mediaBranchCandidateSnapshot?.candidates.find((candidate) => candidate.nodeId === 'team-video')
        expect(addedVideo).toEqual(expect.objectContaining({
            mediaKind: 'video',
            imageUrl: 'nats-obj://workspace-workspace-1-files/team-poster-file',
            roleHints: ['base-context'],
        }))
    })

    it('drops unrelated auto-selected media outside an active branch snapshot', async () => {
        const { deps } = createDeps({
            selections: [
                { nodeId: 'landscape-image', rationale: 'The landscape looks visually interesting.', needsBetterDescriptor: false },
            ],
        })
        const state = createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'team-video'
                    ? { ...node, isEdgeForced: false }
                    : node
                ),
            },
            mediaBranchCandidateSnapshot: {
                ...createState().mediaBranchCandidateSnapshot!,
                candidates: [baseCandidates[0]!],
            },
            imageModelVersion: 'gpt-image-1',
            imageProviderName: 'OpenAI',
        })

        const update = await resolveWorkspaceContext(state, deps)

        expect(update.workspaceContextResolution?.selections).toEqual([])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual([])
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
    })

    it('resolves media object references immediately on text-only turns', async () => {
        const { deps, natsService } = createDeps({
            selections: [
                { nodeId: 'goat-image', rationale: 'Goat is relevant.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            mediaBranchCandidateSnapshot: undefined,
            imageModelVersion: undefined,
            videoModelVersion: undefined,
        }), deps)
        const first = update.messages?.[0]
        const imageBlock = Array.isArray(first?.content)
            ? first.content.find((block) => block?.type === 'input_image')
            : undefined

        expect(natsService.getObject).toHaveBeenCalled()
        expect(imageBlock?.image_url).toBe(resolvedTinyPngUrl)
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['team-video', 'goat-image'])
    })

    it('self-heals a failed media descriptor, persists it, and reranks exactly once', async () => {
        const weakSnapshot: WorkspaceContextSnapshot = {
            ...baseWorkspaceSnapshot,
            nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'goat-image'
                ? { ...node, descriptorStatus: 'failed' as const, descriptorSummary: 'goat' }
                : node
            ),
        }
        const { deps, callLlm, describeMediaStill } = createDeps([
            {
                selections: [
                    { nodeId: 'goat-image', rationale: 'The weak goat descriptor is promising.', needsBetterDescriptor: true },
                ],
            },
            {
                selections: [
                    { nodeId: 'goat-image', rationale: 'The healed goat descriptor now clearly matches.', needsBetterDescriptor: true },
                ],
            },
        ])

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: weakSnapshot,
        }), deps)

        expect(callLlm).toHaveBeenCalledTimes(2)
        expect(describeMediaStill).toHaveBeenCalledOnce()
        expect(describeMediaStill).toHaveBeenCalledWith(expect.objectContaining({
            imageUrl: 'nats-obj://workspace-workspace-1-files/goat-file',
            provider: 'OpenAI',
            modelVersion: 'gpt-4.1',
        }))
        expect(assetModelMocks.updateMetadata).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-goat-image',
            descriptor: expect.objectContaining({
                status: 'ready',
                summary: 'A healed goat descriptor with useful visual detail.',
            }),
        }))
        expect(update.workspaceContextResolution?.improvedDescriptors?.['goat-image']).toEqual(expect.objectContaining({
            summary: 'A healed goat descriptor with useful visual detail.',
            entityTags: ['goat'],
            styleTags: ['field'],
        }))
        expect(update.workspaceContextResolution?.selections.find((selection) => selection.nodeId === 'goat-image')?.rationale)
            .toBe('The healed goat descriptor now clearly matches.')
        expect(update.workspaceContextSnapshot?.nodes.find((node) => node.nodeId === 'goat-image')?.descriptorSummary)
            .toBe('A healed goat descriptor with useful visual detail.')
    })

    it('self-heals a missing text descriptor through the text descriptor path', async () => {
        const missingTextSnapshot: WorkspaceContextSnapshot = {
            ...baseWorkspaceSnapshot,
            nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'cubist-doc'
                ? {
                    ...node,
                    descriptorStatus: undefined,
                    descriptorSummary: undefined,
                    entityTags: undefined,
                    styleTags: undefined,
                }
                : node
            ),
        }
        const { deps, describeTextContent } = createDeps([
            {
                selections: [
                    { nodeId: 'cubist-doc', rationale: 'Forced chip lacks descriptor.', needsBetterDescriptor: true },
                ],
            },
            {
                selections: [
                    { nodeId: 'cubist-doc', rationale: 'Healed doc descriptor is relevant.', needsBetterDescriptor: false },
                ],
            },
        ])

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: missingTextSnapshot,
            mediaBranchCandidateSnapshot: undefined,
        }), deps)

        // cubist-doc has no assetId in this fixture, so the resolver falls
        // back to the node's title/descriptor text rather than loading a real
        // document snapshot (documented in resolveDocumentText's assetId-less
        // branch in workspace-context-resolver.ts).
        expect(describeTextContent).toHaveBeenCalledOnce()
        expect(describeTextContent).toHaveBeenCalledWith(expect.objectContaining({
            text: 'Cubist Dog',
            title: 'Cubist Dog',
        }))
        expect(update.workspaceContextResolution?.improvedDescriptors?.['cubist-doc']).toEqual(expect.objectContaining({
            summary: 'A healed text descriptor about cubist dog notes.',
        }))
    })

    it('publishes context relevance errors and lets the graph error path handle failure', async () => {
        const { deps, publisher } = createDeps({
            selections: [
                { nodeId: 'missing-node', rationale: 'Bad id.', needsBetterDescriptor: false },
            ],
        })

        await expect(resolveWorkspaceContext(createState(), deps)).rejects.toThrow('unknown nodeId: missing-node')
        expect(publisher.contextRelevanceError).toHaveBeenCalledWith('Workspace context resolver returned unknown nodeId: missing-node')
        expect(publisher.contextRelevanceResolved).not.toHaveBeenCalled()
    })

    it('no-ops when the browser request has no workspace context snapshot', async () => {
        const { deps, callLlm, publisher } = createDeps({ selections: [] })

        await expect(resolveWorkspaceContext(createState({ workspaceContextSnapshot: undefined }), deps)).resolves.toEqual({})
        expect(callLlm).not.toHaveBeenCalled()
        expect(publisher.contextRelevanceResolved).not.toHaveBeenCalled()
    })

    it('deduplicates duplicate selections while preserving the first rationale', async () => {
        const { deps, callLlm } = createDeps({
            selections: [
                {
                    nodeId: 'goat-image',
                    rationale: 'first rationale should win',
                    needsBetterDescriptor: false,
                },
                {
                    nodeId: 'goat-image',
                    rationale: 'second rationale should never overwrite',
                    needsBetterDescriptor: true,
                },
            ],
        })

        const update = await resolveWorkspaceContext(createState(), deps)

        expect(callLlm).toHaveBeenCalledOnce()
        expect(update.workspaceContextResolution?.selections).toHaveLength(2)
        expect(update.workspaceContextResolution?.selections.filter((selection) => selection.nodeId === 'goat-image')).toHaveLength(1)
        expect(update.workspaceContextResolution?.selections.find((selection) => selection.nodeId === 'goat-image'))
            .toMatchObject({
                nodeId: 'goat-image',
                role: 'auto',
                rationale: 'first rationale should win',
            })
    })

    it('resolves explicit chips exclusively without calling the LLM, excluding edge-forced and auto candidates', async () => {
        const { deps, callLlm, publisher } = createDeps({
            selections: [
                { nodeId: 'landscape-image', rationale: 'Should never be evaluated.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'goat-image'
                    ? { ...node, isExplicitChip: true }
                    : node),
            },
        }), deps)

        expect(callLlm).not.toHaveBeenCalled()
        expect(update.workspaceContextResolution?.selections).toEqual([
            { nodeId: 'goat-image', role: 'forced-chip' },
        ])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual(['goat-image'])
        expect(publisher.contextRelevanceResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
        expect(update.mediaBranchCandidateSnapshot?.activeTargetNodeId).toBeUndefined()
    })

    it('keeps non-media explicit chips exclusive too and yields no media candidates', async () => {
        const { deps, callLlm } = createDeps({ selections: [] })

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'cubist-doc'
                    ? { ...node, isExplicitChip: true }
                    : node),
            },
        }), deps)

        expect(callLlm).not.toHaveBeenCalled()
        expect(update.workspaceContextResolution?.selections).toEqual([
            { nodeId: 'cubist-doc', role: 'forced-chip' },
        ])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual([])
        expect(update.mediaBranchCandidateSnapshot?.candidates).toEqual([])
    })

    it('restricts an explicit-reference branch snapshot to its explicit candidates on the auto path', async () => {
        const { deps, callLlm } = createDeps({
            selections: [
                { nodeId: 'landscape-image', rationale: 'Auto pick outside the explicit refs.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'team-video'
                    ? { ...node, isEdgeForced: false }
                    : node),
            },
            mediaBranchCandidateSnapshot: {
                ...createState().mediaBranchCandidateSnapshot!,
                explicitReferenceNodeIds: ['goat-image'],
            },
        }), deps)

        expect(callLlm).toHaveBeenCalledOnce()
        expect(update.workspaceContextResolution?.selections).toEqual([])
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
        expect(update.mediaBranchCandidateSnapshot?.activeTargetNodeId).toBeUndefined()
    })
})
