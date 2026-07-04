'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasState, MediaBranchLineagePlan, MediaGenerationRunMeta } from '@lixpi/constants'

const workspaceMutateCanvasState = vi.hoisted(() => vi.fn())

vi.mock('../models/workspace.ts', () => ({
    default: {
        mutateCanvasState: workspaceMutateCanvasState,
    },
}))

import {
    upsertGeneratedImageToCanvas,
    upsertGeneratedVideoToCanvas,
    upsertMediaLineagePlanToCanvas,
} from './media-generation-canvas-projection.ts'

const emptyCanvasState = (): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
})

const latestMutator = (): ((canvasState: CanvasState) => { canvasState: CanvasState, changed: boolean }) => {
    const call = workspaceMutateCanvasState.mock.calls.at(-1)
    expect(call).toBeDefined()
    return call![0].mutate
}

const nodeRect = (node: CanvasState['nodes'][number]): { x: number; y: number; width: number; height: number } => ({
    x: node.position.x,
    y: node.position.y,
    width: node.dimensions.width,
    height: node.dimensions.height,
})

const groupRect = (nodes: CanvasState['nodes']): { x: number; y: number; width: number; height: number } => {
    const minX = Math.min(...nodes.map(node => node.position.x))
    const minY = Math.min(...nodes.map(node => node.position.y))
    const maxX = Math.max(...nodes.map(node => node.position.x + node.dimensions.width))
    const maxY = Math.max(...nodes.map(node => node.position.y + node.dimensions.height))
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    }
}

const rectsOverlap = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
): boolean =>
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y

const expectNoOverlappingRects = (rects: Array<{ id: string; rect: { x: number; y: number; width: number; height: number } }>): void => {
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]
            const b = rects[j]
            expect(
                rectsOverlap(a.rect, b.rect),
                `${a.id} should not overlap ${b.id}`
            ).toBe(false)
        }
    }
}

const lineagePlan = (): MediaBranchLineagePlan => ({
    planVersion: 'media-branch-lineage-v1',
    generationRequestId: 'request-1',
    branchId: 'branch-1',
    promptText: 'make it brighter',
    referenceNodeIds: ['ref-1'],
    sourceContextNodeIds: ['ctx-1'],
    branchOrigin: {
        nodeId: 'origin-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        provenance: {
            kind: 'branch-root-fork-decision',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            forked: true,
            forkCount: 1,
        },
    },
    branchForks: [{
        nodeId: 'fork-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        parentBranchNodeId: 'origin-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        provenance: {
            kind: 'reasoning-run',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
        },
    }],
    branchLines: [{
        nodeId: 'line-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        parentBranchNodeId: 'fork-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        mediaRunId: 'media-1',
        mediaModelId: 'Google:gemini-2.5-flash-image',
        mediaType: 'image',
        provenance: {
            kind: 'branch-continuation',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
        },
    }],
    runAssignments: [],
    createdAt: 123,
})

const generationRun = (): MediaGenerationRunMeta => ({
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    mediaRunId: 'media-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'Google:gemini-2.5-flash-image',
    mediaType: 'image',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: {
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        mediaRunId: 'media-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        mediaModelId: 'Google:gemini-2.5-flash-image',
        mediaType: 'image',
        mediaIndex: 0,
        branchId: 'branch-1',
        branchOriginNodeId: 'origin-1',
        branchForkNodeId: 'fork-1',
        lineageParentNodeId: 'fork-1',
        referenceNodeIds: ['ref-1'],
        sourceContextNodeIds: ['ctx-1'],
        operationKind: 'fresh_branch',
        promptText: 'make it brighter',
        promptFingerprint: 'prompt-fingerprint',
        createdAt: 123,
    },
})

const matrixLineagePlan = (): MediaBranchLineagePlan => {
    const generationRequestId = 'matrix-request-1'
    const branchId = 'branch-matrix-1'
    const reasoningModelIds = [
        'Anthropic:claude-sonnet-4-6',
        'OpenAI:gpt-5.5',
        'Google:gemini-3-pro',
    ] as const
    const imageModelIds = [
        'Google:gemini-3-pro-image',
        'Google:nano-banana-pro',
        'OpenAI:gpt-image-2',
        'OpenAI:gpt-image-1.5',
    ] as const
    const branchForks = reasoningModelIds.map((reasoningModelId, reasoningIndex) => {
        const reasoningRunId = `${generationRequestId}:reasoning:${reasoningIndex}`
        return {
            nodeId: `branch-fork-${generationRequestId}-reasoning-${reasoningIndex}`,
            generationRequestId,
            branchId,
            reasoningRunId,
            reasoningModelId,
            reasoningIndex,
            provenance: {
                kind: 'reasoning-run',
                promptText: 'matrix prompt',
                referenceNodeIds: ['ref-1'],
                sourceContextNodeIds: ['ctx-1'],
                reasoningRunId,
                reasoningModelId,
                reasoningIndex,
            },
        } satisfies MediaBranchLineagePlan['branchForks'][number]
    })
    const runAssignments = branchForks.flatMap((fork, reasoningIndex) =>
        imageModelIds.map((mediaModelId, mediaIndex) => ({
            generationRequestId,
            reasoningRunId: fork.reasoningRunId,
            mediaRunId: `${fork.reasoningRunId}:image:${mediaIndex}`,
            reasoningModelId: fork.reasoningModelId,
            reasoningIndex,
            mediaModelId,
            mediaType: 'image' as const,
            mediaIndex,
            branchId,
            branchForkNodeId: fork.nodeId,
            lineageParentNodeId: fork.nodeId,
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            operationKind: 'new_image' as const,
            promptText: 'matrix prompt',
            promptFingerprint: 'matrix-prompt',
            createdAt: 10_000 + reasoningIndex * imageModelIds.length + mediaIndex,
        }))
    )

    return {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId,
        branchId,
        promptText: 'matrix prompt',
        promptFingerprint: 'matrix-prompt',
        referenceNodeIds: ['ref-1'],
        sourceContextNodeIds: ['ctx-1'],
        branchForks,
        branchLines: [],
        runAssignments,
        createdAt: 10_000,
    }
}

const generationRunFromAssignment = (
    assignment: MediaBranchLineagePlan['runAssignments'][number],
    variantIndex: number,
): MediaGenerationRunMeta => ({
    requestKind: 'media-generation-matrix',
    generationRequestId: assignment.generationRequestId,
    reasoningRunId: assignment.reasoningRunId!,
    mediaRunId: assignment.mediaRunId,
    reasoningModelId: assignment.reasoningModelId!,
    mediaModelId: assignment.mediaModelId,
    mediaType: assignment.mediaType,
    reasoningIndex: assignment.reasoningIndex ?? 0,
    mediaIndex: assignment.mediaIndex,
    variantIndex,
    lineageAssignment: assignment,
})

let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null

describe('media-generation-canvas-projection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleInfoSpy?.mockRestore()
        consoleInfoSpy = null
    })

    it('projects API media lineage plans into durable branch marker nodes and edges idempotently', async () => {
        const plan = lineagePlan()

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })

        expect(workspaceMutateCanvasState).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            origin: 'upsertMediaLineagePlanToCanvas',
        }))

        const first = latestMutator()(emptyCanvasState())
        expect(first.changed).toBe(true)
        expect(first.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin', aiChatThreadId: 'thread-1' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork', parentBranchNodeId: 'origin-1' }),
            expect.objectContaining({ nodeId: 'line-1', type: 'branchLine', parentBranchNodeId: 'fork-1', mediaRunId: 'media-1' }),
        ]))
        expect(first.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ edgeId: 'edge-origin-1-fork-1', sourceNodeId: 'origin-1', targetNodeId: 'fork-1' }),
            expect.objectContaining({ edgeId: 'edge-fork-1-line-1', sourceNodeId: 'fork-1', targetNodeId: 'line-1' }),
        ]))

        const second = latestMutator()(first.canvasState)
        expect(second.changed).toBe(false)
    })

    it('persists final generated images with API lineage metadata and connector edges', async () => {
        const run = generationRun()

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun: run,
        })

        const first = latestMutator()(emptyCanvasState())
        expect(first.changed).toBe(true)
        expect(first.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork' }),
            expect.objectContaining({
                nodeId: 'node-file-1',
                type: 'image',
                fileId: 'file-1',
                src: '/api/images/workspace-1/file-1',
                generatedBy: expect.objectContaining({
                    aiChatThreadId: 'thread-1',
                    responseId: 'response-1',
                    generationRequestId: 'request-1',
                    reasoningRunId: 'reasoning-1',
                    mediaRunId: 'media-1',
                    branchId: 'branch-1',
                    branchForkNodeId: 'fork-1',
                    referenceImageNodeIds: ['ref-1'],
                    sourceContextNodeIds: ['ctx-1'],
                    promptText: 'make it brighter',
                }),
            }),
        ]))
        expect(first.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'origin-1', targetNodeId: 'fork-1' }),
            expect.objectContaining({ sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' }),
        ]))

        const second = latestMutator()(first.canvasState)
        expect(second.changed).toBe(false)
    })

    it('removes stale marker edges targeting a generated image before adding the assignment edge', async () => {
        const run = generationRun()

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun: run,
        })

        const canvasWithStaleMarkerEdge: CanvasState = {
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: 'fork-other',
                    type: 'branchFork',
                    branchId: 'branch-other',
                    generationRequestId: 'request-other',
                    reasoningRunId: 'reasoning-other',
                    reasoningModelId: 'OpenAI:gpt-5.5',
                    reasoningIndex: 1,
                    position: { x: 0, y: 0 },
                    dimensions: { width: 375, height: 68 },
                    temporary: true,
                } as any,
                {
                    nodeId: 'user-node',
                    type: 'image',
                    fileId: 'user-file',
                    workspaceId: 'workspace-1',
                    src: '/api/images/workspace-1/user-file',
                    aspectRatio: 1,
                    position: { x: 0, y: 100 },
                    dimensions: { width: 100, height: 100 },
                } as any,
            ],
            edges: [
                {
                    edgeId: 'edge-fork-other-node-file-1',
                    sourceNodeId: 'fork-other',
                    targetNodeId: 'node-file-1',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
                {
                    edgeId: 'edge-user-node-node-file-1',
                    sourceNodeId: 'user-node',
                    targetNodeId: 'node-file-1',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
            ],
        }

        const result = latestMutator()(canvasWithStaleMarkerEdge)

        expect(result.changed).toBe(true)
        expect(result.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ edgeId: 'edge-user-node-node-file-1', sourceNodeId: 'user-node', targetNodeId: 'node-file-1' }),
            expect.objectContaining({ edgeId: 'edge-fork-1-node-file-1', sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' }),
        ]))
        expect(result.canvasState.edges).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ edgeId: 'edge-fork-other-node-file-1' }),
        ]))
    })

    it('still reports a changed canvas when an existing media node only needs missing lineage markers', async () => {
        const run = generationRun()
        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun: run,
        })

        const canvasWithExistingImageOnly: CanvasState = {
            ...emptyCanvasState(),
            nodes: [{
                nodeId: 'node-file-1',
                type: 'image',
                fileId: 'file-1',
                workspaceId: 'workspace-1',
                src: '/api/images/workspace-1/file-1',
                aspectRatio: 1,
                position: { x: 0, y: 0 },
                dimensions: { width: 600, height: 600 },
                generatedBy: {
                    aiChatThreadId: 'thread-1',
                    responseId: 'response-1',
                    aiModel: 'Anthropic:claude-sonnet-4-6',
                    imageModelProvider: 'Google',
                    revisedPrompt: 'a brighter image',
                    mediaRunId: 'media-1',
                },
            }],
        }

        const result = latestMutator()(canvasWithExistingImageOnly)
        expect(result.changed).toBe(true)
        expect(result.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork' }),
            expect.objectContaining({ nodeId: 'node-file-1', type: 'image' }),
        ]))
        expect(result.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' }),
        ]))
    })

    it('recreates missing assignment markers with the planned reasoning index instead of collapsing them to zero', async () => {
        const run: MediaGenerationRunMeta = {
            ...generationRun(),
            reasoningRunId: 'reasoning-3',
            mediaRunId: 'media-3',
            reasoningModelId: 'Google:gemini-3-pro',
            reasoningIndex: 2,
            mediaIndex: 1,
            variantIndex: 9,
            lineageAssignment: {
                ...generationRun().lineageAssignment!,
                reasoningRunId: 'reasoning-3',
                mediaRunId: 'media-3',
                reasoningModelId: 'Google:gemini-3-pro',
                reasoningIndex: 2,
                mediaIndex: 1,
                branchForkNodeId: 'fork-3',
                lineageParentNodeId: 'fork-3',
            },
        }

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-3',
            fileId: 'file-3',
            responseId: 'response-3',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-3-pro-image',
            generationRun: run,
        })

        const result = latestMutator()(emptyCanvasState())

        expect(result.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                nodeId: 'fork-3',
                type: 'branchFork',
                reasoningRunId: 'reasoning-3',
                reasoningIndex: 2,
            }),
            expect.objectContaining({
                nodeId: 'node-file-3',
                generatedBy: expect.objectContaining({
                    reasoningRunId: 'reasoning-3',
                    mediaRunId: 'media-3',
                    reasoningIndex: 2,
                    mediaIndex: 1,
                    variantIndex: 9,
                    branchForkNodeId: 'fork-3',
                }),
            }),
        ]))
    })

    it('keeps a 3x4 reasoning/media matrix as three balanced branch trees with one correct fork edge per output', async () => {
        const plan = matrixLineagePlan()
        let state = emptyCanvasState()

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        state = latestMutator()(state).canvasState

        for (const assignmentIndex of [7, 0, 11, 3, 5, 1, 10, 2, 8, 4, 6, 9]) {
            const assignment = plan.runAssignments[assignmentIndex]
            const safeFileId = `file-${assignment.mediaRunId!.replace(/[^a-zA-Z0-9-]/g, '-')}`
            await upsertGeneratedImageToCanvas({
                workspaceId: 'workspace-1',
                aiChatThreadId: 'thread-1',
                imageUrl: `/api/images/workspace-1/${safeFileId}`,
                fileId: safeFileId,
                responseId: `response-${assignmentIndex}`,
                revisedPrompt: 'matrix result',
                aiProvider: 'Anthropic',
                imageModelProvider: assignment.mediaModelId!.split(':')[0],
                imageModelId: assignment.mediaModelId!.split(':').slice(1).join(':'),
                generationRun: generationRunFromAssignment(assignment, assignmentIndex),
            })
            state = latestMutator()(state).canvasState
        }

        const forkNodes = state.nodes.filter(node => node.type === 'branchFork')
        const generatedNodes = state.nodes.filter(node => node.type === 'image' && Boolean(node.generatedBy?.mediaRunId))
        const nodeIds = new Set(state.nodes.map(node => node.nodeId))

        expect(forkNodes).toHaveLength(3)
        expect(generatedNodes).toHaveLength(12)
        expect(state.edges.every(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))).toBe(true)
        expect(new Set(generatedNodes.map(node => node.generatedBy?.mediaRunId)).size).toBe(12)

        const branchGroupRects = forkNodes.map((fork) => {
            const branchChildren = generatedNodes
                .filter(node => node.generatedBy?.branchForkNodeId === fork.nodeId)
                .sort((a, b) => a.position.y - b.position.y)
            expect(branchChildren).toHaveLength(4)
            expect(branchChildren.map(node => node.generatedBy?.reasoningIndex)).toEqual([
                fork.reasoningIndex,
                fork.reasoningIndex,
                fork.reasoningIndex,
                fork.reasoningIndex,
            ])
            expect(branchChildren.map(node => node.generatedBy?.mediaIndex)).toEqual([0, 1, 2, 3])
            expectNoOverlappingRects(branchChildren.map(node => ({ id: node.nodeId, rect: nodeRect(node) })))

            for (const child of branchChildren) {
                const inboundEdges = state.edges.filter(edge => edge.targetNodeId === child.nodeId)
                expect(inboundEdges).toEqual([
                    expect.objectContaining({
                        sourceNodeId: fork.nodeId,
                        targetNodeId: child.nodeId,
                    }),
                ])
            }

            return {
                id: fork.nodeId,
                rect: groupRect([fork, ...branchChildren]),
            }
        })

        expectNoOverlappingRects(branchGroupRects)
    })

    it('persists final generated videos with poster metadata and parsed dimensions', async () => {
        const run: MediaGenerationRunMeta = {
            ...generationRun(),
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            lineageAssignment: {
                ...generationRun().lineageAssignment!,
                mediaModelId: 'Google:veo-3.1-generate-preview',
                mediaType: 'video',
                branchLineNodeId: 'line-1',
                lineageParentNodeId: 'line-1',
            },
        }

        await upsertGeneratedVideoToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            videoUrl: '/api/videos/workspace-1/video-1',
            fileId: 'video-1',
            posterUrl: '/api/images/workspace-1/poster-1',
            posterFileId: 'poster-1',
            frameUrl: '/api/images/workspace-1/frame-1',
            frameFileId: 'frame-1',
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'response-1',
            revisedPrompt: 'a brighter video',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            generationRun: run,
        })

        const result = latestMutator()(emptyCanvasState())
        expect(result.changed).toBe(true)
        expect(result.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'line-1', type: 'branchLine', mediaType: 'video' }),
            expect.objectContaining({
                nodeId: 'node-video-1',
                type: 'video',
                fileId: 'video-1',
                posterFileId: 'poster-1',
                frameFileId: 'frame-1',
                aspectRatio: 16 / 9,
                generatedBy: expect.objectContaining({
                    videoModel: 'Google:veo-3.1-generate-preview',
                    videoModelProvider: 'Google',
                    branchLineNodeId: 'line-1',
                    durationSeconds: 8,
                    aspectRatio: '16:9',
                    hasAudio: true,
                }),
            }),
        ]))
        expect(result.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'line-1', targetNodeId: 'node-video-1' }),
        ]))
    })
})
