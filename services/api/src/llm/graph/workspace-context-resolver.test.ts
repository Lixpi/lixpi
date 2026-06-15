'use strict'

import { describe, expect, it, vi } from 'vitest'

import { STREAM_STATUS } from '@lixpi/constants'
import type { ImageBranchCandidateImage, WorkspaceContextSnapshot } from '@lixpi/constants'

import { resolveWorkspaceContext } from './workspace-context-resolver.ts'
import type { ProviderState } from './state.ts'
import type { VlmCallArgs, VlmCallResult } from '../extraction/vlm-client.ts'

const tinyPngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
)
const resolvedTinyPngUrl = `data:image/png;base64,${tinyPngBytes.toString('base64')}`

const baseWorkspaceSnapshot: WorkspaceContextSnapshot = {
    resolverVersion: 'workspace-context-v1',
    workspaceId: 'workspace-1',
    threadId: 'thread-1',
    promptText: 'put the goat beside the cubist dog and mention the chat notes',
    nodes: [
        {
            nodeId: 'root-thread',
            type: 'aiChatThread',
            referenceId: 'root-thread-ref',
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
            referenceId: 'doc-cubist',
            title: 'Cubist Dog',
            descriptorStatus: 'ready',
            descriptorSummary: 'notes about a cubist dog painting',
            entityTags: ['dog'],
            styleTags: ['cubist'],
            isExplicitChip: true,
            isEdgeForced: false,
        },
        {
            nodeId: 'goat-image',
            type: 'image',
            descriptorStatus: 'ready',
            descriptorSummary: 'a white goat standing in a field',
            entityTags: ['goat'],
            styleTags: ['photo'],
            fileId: 'goat-file',
            imageUrl: 'nats-obj://workspace-workspace-1-files/goat-file',
            branchId: 'branch-goat',
            isExplicitChip: false,
            isEdgeForced: false,
        },
        {
            nodeId: 'team-video',
            type: 'video',
            descriptorStatus: 'ready',
            descriptorSummary: 'team walking through a studio',
            entityTags: ['team'],
            styleTags: ['documentary'],
            fileId: 'team-poster-file',
            imageUrl: 'nats-obj://workspace-workspace-1-files/team-poster-file',
            isExplicitChip: false,
            isEdgeForced: true,
        },
        {
            nodeId: 'notes-thread',
            type: 'aiChatThread',
            referenceId: 'thread-notes',
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
            descriptorStatus: 'ready',
            descriptorSummary: 'unrelated mountain landscape',
            entityTags: ['mountain'],
            styleTags: ['landscape'],
            fileId: 'landscape-file',
            imageUrl: 'nats-obj://workspace-workspace-1-files/landscape-file',
            isExplicitChip: false,
            isEdgeForced: false,
        },
    ],
}

const baseCandidates: ImageBranchCandidateImage[] = [
    {
        nodeId: 'goat-image',
        fileId: 'goat-file',
        workspaceId: 'workspace-1',
        imageUrl: 'nats-obj://workspace-workspace-1-files/goat-file',
        roleHints: ['base-context', 'generated-variant', 'branch-leaf'],
        branchId: 'branch-goat',
        ancestorNodeIds: ['goat-image'],
        sourceContextNodeIds: ['goat-image'],
        visualEntitySummary: 'a white goat standing in a field',
        entityTags: ['goat'],
    },
    {
        nodeId: 'landscape-image',
        fileId: 'landscape-file',
        workspaceId: 'workspace-1',
        imageUrl: 'nats-obj://workspace-workspace-1-files/landscape-file',
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
        eventMeta: {},
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
        imageBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
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
    const getDocument = vi.fn(async () => ({
        documentId: 'doc-cubist',
        workspaceId: 'workspace-1',
        revision: 1,
        title: 'Cubist Dog',
        content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Full cubist dog document text.' }] }],
        }),
        prevRevision: 1,
        createdAt: 1,
        updatedAt: 1,
    }))
    const getAiChatThread = vi.fn(async () => ({
        workspaceId: 'workspace-1',
        threadId: 'thread-notes',
        title: 'Seaside notes',
        content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Full chat thread notes.' }] }],
        },
        aiModel: 'OpenAI:gpt-4.1',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
    }))
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
    const patchCanvasNodeDescriptor = vi.fn(async () => true)

    return {
        deps: {
            natsService: natsService as any,
            publisher: publisher as any,
            callLlm,
            getDocument: getDocument as any,
            getAiChatThread: getAiChatThread as any,
            describeMediaStill: describeMediaStill as any,
            describeTextContent: describeTextContent as any,
            patchCanvasNodeDescriptor: patchCanvasNodeDescriptor as any,
        },
        natsService,
        publisher,
        callLlm,
        getDocument,
        getAiChatThread,
        describeMediaStill,
        describeTextContent,
        patchCanvasNodeDescriptor,
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
    it('ranks workspace descriptors, force-includes chips and edge nodes, and assembles selected content', async () => {
        const { deps, publisher, getDocument, getAiChatThread, callLlm } = createDeps({
            selections: [
                { nodeId: 'goat-image', rationale: 'The prompt asks for the goat.', needsBetterDescriptor: false },
                { nodeId: 'notes-thread', rationale: 'The notes may help explain the scene.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState(), deps)
        const selections = update.workspaceContextResolution?.selections

        expect(callLlm).toHaveBeenCalledOnce()
        expect(callLlm.mock.calls[0]?.[0].userMessages[0]?.content).toContain('Workspace node descriptor JSON')
        expect(selections).toEqual([
            { nodeId: 'cubist-doc', role: 'forced-chip' },
            { nodeId: 'team-video', role: 'forced-edge' },
            { nodeId: 'goat-image', role: 'auto', rationale: 'The prompt asks for the goat.' },
            { nodeId: 'notes-thread', role: 'auto', rationale: 'The notes may help explain the scene.' },
        ])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual(['team-video', 'goat-image'])
        expect(publisher.contextRelevanceResolved).toHaveBeenCalledOnce()
        expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-cubist', workspaceId: 'workspace-1', revision: 1 }))
        expect(getAiChatThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-notes', workspaceId: 'workspace-1' }))

        const textBlocks = getInputTextBlocks(update)
        expect(textBlocks.some((text) => text.includes('Full cubist dog document text.'))).toBe(true)
        expect(textBlocks.some((text) => text.includes('Full chat thread notes.'))).toBe(true)
        expect(textBlocks.some((text) => text.includes('"type":"workspace_video"'))).toBe(true)
        expect(update.messages?.at(1)).toEqual({ role: 'user', content: 'put the goat beside the cubist dog' })
    })

    it('narrows the image-branch candidate snapshot and adds selected media outside the old candidate set', async () => {
        const { deps } = createDeps({
            selections: [
                { nodeId: 'goat-image', rationale: 'Goat is relevant.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            imageModelVersion: 'gpt-image-1',
            imageProviderName: 'OpenAI',
        }), deps)

        expect(update.imageBranchCandidateSnapshot?.activeTargetNodeId).toBeUndefined()
        expect(update.imageBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['team-video', 'goat-image'])
        const addedVideo = update.imageBranchCandidateSnapshot?.candidates.find((candidate) => candidate.nodeId === 'team-video')
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
            imageBranchCandidateSnapshot: {
                ...createState().imageBranchCandidateSnapshot!,
                candidates: [baseCandidates[0]!],
            },
            imageModelVersion: 'gpt-image-1',
            imageProviderName: 'OpenAI',
        })

        const update = await resolveWorkspaceContext(state, deps)

        expect(update.workspaceContextResolution?.selections).toEqual([
            { nodeId: 'cubist-doc', role: 'forced-chip' },
        ])
        expect(update.workspaceContextResolution?.narrowedMediaNodeIds).toEqual([])
        expect(update.imageBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['goat-image'])
    })

    it('resolves media object references immediately on text-only turns', async () => {
        const { deps, natsService } = createDeps({
            selections: [
                { nodeId: 'goat-image', rationale: 'Goat is relevant.', needsBetterDescriptor: false },
            ],
        })

        const update = await resolveWorkspaceContext(createState({
            imageBranchCandidateSnapshot: undefined,
            imageModelVersion: undefined,
            videoModelVersion: undefined,
        }), deps)
        const first = update.messages?.[0]
        const imageBlock = Array.isArray(first?.content)
            ? first.content.find((block) => block?.type === 'input_image')
            : undefined

        expect(natsService.getObject).toHaveBeenCalled()
        expect(imageBlock?.image_url).toBe(resolvedTinyPngUrl)
        expect(update.imageBranchCandidateSnapshot?.candidates.map((candidate) => candidate.nodeId)).toEqual(['team-video', 'goat-image'])
    })

    it('self-heals a failed media descriptor, persists it, and reranks exactly once', async () => {
        const weakSnapshot: WorkspaceContextSnapshot = {
            ...baseWorkspaceSnapshot,
            nodes: baseWorkspaceSnapshot.nodes.map((node) => node.nodeId === 'goat-image'
                ? { ...node, descriptorStatus: 'failed' as const, descriptorSummary: 'goat' }
                : node
            ),
        }
        const { deps, callLlm, describeMediaStill, patchCanvasNodeDescriptor } = createDeps([
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
        expect(patchCanvasNodeDescriptor).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            nodeId: 'goat-image',
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
        const { deps, describeTextContent, patchCanvasNodeDescriptor } = createDeps([
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
            imageBranchCandidateSnapshot: undefined,
        }), deps)

        expect(describeTextContent).toHaveBeenCalledOnce()
        expect(describeTextContent).toHaveBeenCalledWith(expect.objectContaining({
            text: 'Full cubist dog document text.',
            title: 'Cubist Dog',
        }))
        expect(patchCanvasNodeDescriptor).toHaveBeenCalledWith(expect.objectContaining({
            nodeId: 'cubist-doc',
            descriptor: expect.objectContaining({
                summary: 'A healed text descriptor about cubist dog notes.',
            }),
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
})
