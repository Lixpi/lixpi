'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAM_STATUS } from '@lixpi/constants'
import type { Asset, MediaBranchCandidateImage, WorkspaceContextSnapshot } from '@lixpi/constants'
import { buildActionTimelineDocument } from '@lixpi/capability-system'

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
import type { VlmCallArgs, VlmCallResult } from '../structured-vlm/structured-vlm-client.ts'

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
    'asset-timeline': {
        assetId: 'asset-timeline',
        organizationId: 'org-1',
        title: 'Travel Timeline',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        primaryCategory: 'capabilityArtifact',
        documents: {
            capabilityArtifact: { blobHash: 'timeline-doc', version: 1, schemaVersion: 'action-timeline@1' },
        },
        artifact: { artifactTypeId: 'action-timeline', schemaVersion: 'action-timeline@1' },
        states: { lifecycle: 'active', media: 'none', conversation: 'none', provenance: 'sealed' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
    'asset-shelby': {
        assetId: 'asset-shelby',
        organizationId: 'org-1',
        title: 'Shelby',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {},
        media: {
            kind: 'image',
            originalName: 'shelby.png',
            sourceMimeType: 'image/png',
            modelSafe: true,
            renditions: { preview: { name: 'preview', status: 'ready', blobHash: 'shelby-file', updatedAt: 1 } },
        },
        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
    'asset-travel-notes': {
        assetId: 'asset-travel-notes',
        organizationId: 'org-1',
        title: 'Travel Notes',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        documents: {
            content: { blobHash: 'travel-notes-doc', version: 1, schemaVersion: 'prosemirror@1' },
        },
        media: { kind: 'document', sourceMimeType: 'application/json', modelSafe: true, renditions: {} },
        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    } as Asset,
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
        candidateId: 'goat-image',
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
        candidateId: 'landscape-image',
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
            activeTargetCandidateId: 'landscape-image',
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
    const loadAssetDocumentSnapshot = vi.fn(async (asset: Asset, role: string) => {
        if (asset.assetId === 'asset-timeline' && role === 'capabilityArtifact') {
            return {
                doc: buildActionTimelineDocument(
                    { durationMs: 2000, precisionMs: 1000 },
                    [{
                        slotIndex: 0,
                        runs: [{ assetId: 'asset-shelby' }, { text: ' boards the train using ' }, { assetId: 'asset-travel-notes' }],
                    }, { slotIndex: 1, runs: [{ text: 'Continue the journey.' }] }],
                    new Map([
                        ['asset-shelby', { mediaKind: 'image' as const, displayName: 'stale Shelby label' }],
                        ['asset-travel-notes', { mediaKind: 'document' as const, displayName: 'stale notes label' }],
                    ]),
                ),
            }
        }
        if (asset.assetId === 'asset-travel-notes' && role === 'content') {
            return {
                doc: {
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Board from platform four.' }] }],
                },
            }
        }
        return null
    })

    return {
        deps: {
            natsService: natsService as any,
            publisher: publisher as any,
            callLlm,
            getAsset: getAsset as any,
            describeMediaStill: describeMediaStill as any,
            describeTextContent: describeTextContent as any,
            loadAssetDocumentSnapshot: loadAssetDocumentSnapshot as any,
        },
        natsService,
        publisher,
        callLlm,
        getAsset,
        describeMediaStill,
        describeTextContent,
        loadAssetDocumentSnapshot,
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

        expect(update.mediaBranchCandidateSnapshot?.candidates).toEqual([])
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
        expect(update.mediaBranchCandidateSnapshot?.candidates).toEqual([])
    })

    it('no-ops when the browser request has no workspace context snapshot', async () => {
        const { deps, callLlm, publisher } = createDeps({ selections: [] })

        await expect(resolveWorkspaceContext(createState({ workspaceContextSnapshot: undefined }), deps)).resolves.toEqual({})
        expect(callLlm).not.toHaveBeenCalled()
        expect(publisher.contextRelevanceResolved).not.toHaveBeenCalled()
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
        expect(update.mediaBranchCandidateSnapshot?.activeTargetCandidateId).toBeUndefined()
    })

    it('does not duplicate an explicit asset already present under the browser candidate ID', async () => {
        const { deps, callLlm } = createDeps({ selections: [] })
        const browserCandidate: MediaBranchCandidateImage = {
            ...baseCandidates[0]!,
            candidateId: 'node:goat-image',
            roleHints: ['base-context', 'active-target'],
        }

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'goat-image'
                    ? { ...node, isExplicitChip: true }
                    : node),
            },
            mediaBranchCandidateSnapshot: {
                ...createState().mediaBranchCandidateSnapshot!,
                activeTargetCandidateId: browserCandidate.candidateId,
                explicitReferenceCandidateIds: [browserCandidate.candidateId],
                candidates: [browserCandidate],
            },
        }), deps)

        expect(callLlm).not.toHaveBeenCalled()
        expect(update.mediaBranchCandidateSnapshot?.candidates).toHaveLength(1)
        expect(update.mediaBranchCandidateSnapshot?.candidates[0]).toMatchObject({
            candidateId: 'node:goat-image',
            nodeId: 'goat-image',
            assetId: 'asset-goat-image',
        })
        expect(update.mediaBranchCandidateSnapshot?.explicitReferenceCandidateIds).toEqual(['node:goat-image'])
        expect(update.mediaBranchCandidateSnapshot?.activeTargetCandidateId).toBe('node:goat-image')
        expect(update.mediaBranchCandidateSnapshot?.transcriptContext.match(/assetId=asset-goat-image/g)).toHaveLength(1)
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

    it('expands an explicit Action Timeline with canonical names and every cited payload', async () => {
        const { deps, callLlm, natsService, loadAssetDocumentSnapshot } = createDeps({ selections: [] })
        const artifactSnapshot: WorkspaceContextSnapshot = {
            ...baseWorkspaceSnapshot,
            nodes: [{
                nodeId: 'timeline-node',
                type: 'capabilityArtifact',
                artifactTypeId: 'action-timeline',
                assetId: 'asset-timeline',
                title: 'Travel Timeline',
                isExplicitChip: true,
                isEdgeForced: false,
            }],
        }

        const update = await resolveWorkspaceContext(createState({
            workspaceContextSnapshot: artifactSnapshot,
            mediaBranchCandidateSnapshot: undefined,
            imageModelVersion: undefined,
            videoModelVersion: undefined,
        }), deps)
        const textBlocks = getInputTextBlocks(update)
        const artifactBlock = textBlocks.find(text => text.includes('workspace_capability_artifact'))
        const citedDocumentBlock = textBlocks.find(text => text.includes('workspace_artifact_document_reference'))
        const firstMessage = update.messages?.[0]
        const imageBlock = Array.isArray(firstMessage?.content)
            ? firstMessage.content.find(block => block?.type === 'input_image')
            : undefined

        expect(callLlm).not.toHaveBeenCalled()
        expect(artifactBlock).toContain('@Shelby')
        expect(artifactBlock).toContain('@Travel Notes')
        expect(artifactBlock).not.toContain('asset-shelby')
        expect(artifactBlock).not.toContain('asset-travel-notes')
        expect(citedDocumentBlock).toContain('Travel Notes')
        expect(citedDocumentBlock).toContain('Board from platform four.')
        expect(imageBlock?.image_url).toBe(resolvedTinyPngUrl)
        expect(natsService.getObject).toHaveBeenCalled()
        expect(loadAssetDocumentSnapshot).toHaveBeenCalledWith(assetById['asset-timeline'], 'capabilityArtifact')
        expect(loadAssetDocumentSnapshot).toHaveBeenCalledWith(assetById['asset-travel-notes'], 'content')
    })

    it('fails closed when an explicitly selected Action Timeline is unavailable', async () => {
        const { deps, callLlm, publisher } = createDeps({ selections: [] })
        deps.getAsset = vi.fn(async () => ({ error: 'ASSET_NOT_FOUND' })) as any

        await expect(resolveWorkspaceContext(createState({
            workspaceContextSnapshot: {
                ...baseWorkspaceSnapshot,
                nodes: [{
                    nodeId: 'timeline-node',
                    type: 'capabilityArtifact',
                    artifactTypeId: 'action-timeline',
                    assetId: 'asset-timeline',
                    isExplicitChip: true,
                    isEdgeForced: false,
                }],
            },
        }), deps)).rejects.toThrow('WORKSPACE_CONTEXT_ARTIFACT_UNAVAILABLE:asset-timeline')

        expect(callLlm).not.toHaveBeenCalled()
        expect(publisher.contextRelevanceError).toHaveBeenCalledWith(
            'WORKSPACE_CONTEXT_ARTIFACT_UNAVAILABLE:asset-timeline',
        )
    })

    it('restricts a branch snapshot to its explicit candidate allowlist', async () => {
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
                explicitReferenceCandidateIds: ['goat-image'],
            },
        }), deps)

        expect(callLlm).not.toHaveBeenCalled()
        expect(update.workspaceContextResolution?.selections).toEqual([])
        expect(update.mediaBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
        expect(update.mediaBranchCandidateSnapshot?.activeTargetCandidateId).toBeUndefined()
    })
})
