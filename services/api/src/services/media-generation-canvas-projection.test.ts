'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    mediaGenerationLayoutSettings,
    type BranchForkCanvasNode,
    type CanvasState,
    type MediaBranchLineagePlan,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'
import { getPendingGeneratedMediaNodeId } from '@lixpi/canvas-engine'

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
    refreshMediaGenerationRequestCanvasGeometry,
    settleMediaGenerationRequestOnCanvas,
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

const mockWorkspaceMutationFromState = (state: CanvasState, canvasStateUpdatedAt = 2000): void => {
    workspaceMutateCanvasState.mockImplementationOnce(async ({ mutate }) => {
        const result = mutate(state)
        return {
            changed: result.changed,
            canvasState: result.canvasState,
            canvasStateUpdatedAt,
        }
    })
}

const nodeRect = (node: CanvasState['nodes'][number]): { x: number; y: number; width: number; height: number } => ({
    x: node.position.x,
    y: node.position.y,
    width: node.dimensions.width,
    height: node.dimensions.height,
})

const pendingPreFrameCircleRect = (node: CanvasState['nodes'][number]): { x: number; y: number; width: number; height: number } => {
    const size = Math.min(node.dimensions.width, node.dimensions.height) * mediaGenerationLayoutSettings.preFrameCircleScale
    return {
        x: node.position.x + (node.dimensions.width - size) / 2,
        y: node.position.y + (node.dimensions.height - size) / 2,
        width: size,
        height: size,
    }
}

type TestRect = { x: number; y: number; width: number; height: number }

const groupRectFromRects = (rects: TestRect[]): TestRect => {
    const minX = Math.min(...rects.map(rect => rect.x))
    const minY = Math.min(...rects.map(rect => rect.y))
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width))
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height))
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    }
}

const groupRect = (nodes: CanvasState['nodes']): TestRect => groupRectFromRects(nodes.map(nodeRect))

const rectsOverlap = (
    a: TestRect,
    b: TestRect,
): boolean =>
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y

const expectNoOverlappingRects = (rects: Array<{ id: string; rect: TestRect }>): void => {
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

const mixedImageVideoLineagePlan = (): MediaBranchLineagePlan => {
    const generationRequestId = 'mixed-request-1'
    const branchId = 'branch-mixed-1'
    const reasoningRunId = `${generationRequestId}:reasoning:0`
    const fork = {
        nodeId: `branch-fork-${generationRequestId}-reasoning-0`,
        generationRequestId,
        branchId,
        reasoningRunId,
        reasoningModelId: 'Anthropic:claude-haiku-4.5',
        reasoningIndex: 0,
        provenance: {
            kind: 'reasoning-run',
            promptText: 'make a photo of a mountain goat',
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            reasoningRunId,
            reasoningModelId: 'Anthropic:claude-haiku-4.5',
            reasoningIndex: 0,
        },
    } satisfies MediaBranchLineagePlan['branchForks'][number]
    const runAssignments: MediaBranchLineagePlan['runAssignments'] = [
        {
            generationRequestId,
            reasoningRunId,
            mediaRunId: `${reasoningRunId}:image:0`,
            reasoningModelId: fork.reasoningModelId,
            reasoningIndex: 0,
            mediaModelId: 'Stability:sd-3.5-large',
            mediaType: 'image',
            mediaIndex: 0,
            branchId,
            branchForkNodeId: fork.nodeId,
            lineageParentNodeId: fork.nodeId,
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            operationKind: 'fresh_branch',
            promptText: 'make a photo of a mountain goat',
            promptFingerprint: 'mountain-goat',
            createdAt: 10_000,
        },
        {
            generationRequestId,
            reasoningRunId,
            mediaRunId: `${reasoningRunId}:image:1`,
            reasoningModelId: fork.reasoningModelId,
            reasoningIndex: 0,
            mediaModelId: 'Stability:stable-image-ultra',
            mediaType: 'image',
            mediaIndex: 1,
            branchId,
            branchForkNodeId: fork.nodeId,
            lineageParentNodeId: fork.nodeId,
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            operationKind: 'fresh_branch',
            promptText: 'make a photo of a mountain goat',
            promptFingerprint: 'mountain-goat',
            createdAt: 10_001,
        },
        {
            generationRequestId,
            reasoningRunId,
            mediaRunId: `${reasoningRunId}:video:0`,
            reasoningModelId: fork.reasoningModelId,
            reasoningIndex: 0,
            mediaModelId: 'Google:veo-3',
            mediaType: 'video',
            mediaIndex: 0,
            branchId,
            branchForkNodeId: fork.nodeId,
            lineageParentNodeId: fork.nodeId,
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            operationKind: 'fresh_branch',
            promptText: 'make a photo of a mountain goat',
            promptFingerprint: 'mountain-goat',
            createdAt: 10_002,
        },
    ]

    return {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId,
        branchId,
        promptText: 'make a photo of a mountain goat',
        promptFingerprint: 'mountain-goat',
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        branchForks: [fork],
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

function paragraphText(value: string): unknown {
    return { type: 'paragraph', content: [{ type: 'text', text: value }] }
}

function streamingThreadContentForPlan(
    plan: MediaBranchLineagePlan,
    responseText: string,
): unknown {
    const fork = plan.branchForks[0]
    return {
        type: 'doc',
        content: [{
            type: 'aiChatThread',
            attrs: { threadId: 'thread-1' },
            content: [
                { type: 'aiUserMessage', content: [paragraphText(plan.promptText)] },
                {
                    type: 'aiResponseMessage',
                    attrs: {
                        id: 'response-1',
                        generationRequestId: plan.generationRequestId,
                        isReceivingAnimation: true,
                    },
                    content: [{
                        type: 'aiReasoningSection',
                        attrs: {
                            generationRequestId: plan.generationRequestId,
                            reasoningRunId: fork.reasoningRunId,
                            reasoningModelId: fork.reasoningModelId,
                            reasoningIndex: fork.reasoningIndex,
                            branchForkNodeId: fork.nodeId,
                            isReceivingAnimation: true,
                        },
                        content: [paragraphText(responseText)],
                    }],
                },
            ],
        }],
    }
}

const pendingVideoNodeFromAssignment = (
    assignment: MediaBranchLineagePlan['runAssignments'][number],
): CanvasState['nodes'][number] => ({
    nodeId: getPendingGeneratedMediaNodeId(assignment),
    type: 'video',
    fileId: '',
    posterFileId: '',
    frameFileId: '',
    workspaceId: 'workspace-1',
    src: '',
    posterSrc: '',
    aspectRatio: 1,
    durationSeconds: 0,
    hasAudio: false,
    position: { x: 400, y: 400 },
    dimensions: { width: 800, height: 800 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        responseId: '',
        videoModel: assignment.mediaModelId!,
        revisedPrompt: assignment.promptText,
        responseMessageId: '',
        generationRequestId: assignment.generationRequestId,
        reasoningRunId: assignment.reasoningRunId,
        mediaRunId: assignment.mediaRunId,
        reasoningModelId: assignment.reasoningModelId,
        reasoningIndex: assignment.reasoningIndex,
        mediaModelId: assignment.mediaModelId,
        mediaType: 'video',
        mediaIndex: assignment.mediaIndex,
        branchId: assignment.branchId,
        branchForkNodeId: assignment.branchForkNodeId,
        lineageParentNodeId: assignment.lineageParentNodeId,
    },
} as CanvasState['nodes'][number])

let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null

describe('media-generation-canvas-projection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        workspaceMutateCanvasState.mockResolvedValue({ changed: true, canvasState: null, canvasStateUpdatedAt: 1000 })
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

    it('returns plan-time pending snapshots only for image assignments in a mixed image/video plan', async () => {
        const plan = mixedImageVideoLineagePlan()
        mockWorkspaceMutationFromState(emptyCanvasState(), 2001)

        const canvasGeometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })

        const imageAssignments = plan.runAssignments.filter(assignment => assignment.mediaType === 'image')
        const videoAssignments = plan.runAssignments.filter(assignment => assignment.mediaType === 'video')
        const expectedImagePendingNodeIds = imageAssignments.map(assignment => getPendingGeneratedMediaNodeId(assignment))
        const skippedVideoPendingNodeIds = videoAssignments.map(assignment => getPendingGeneratedMediaNodeId(assignment))
        expect(canvasGeometry).toMatchObject({
            layoutRevision: 2001,
        })
        expect(canvasGeometry?.nodes.map(node => node.nodeId)).toEqual(expect.arrayContaining([
            plan.branchForks[0].nodeId,
            ...expectedImagePendingNodeIds,
        ]))
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).toEqual(expect.arrayContaining([
            plan.branchForks[0].nodeId,
            ...expectedImagePendingNodeIds,
        ]))
        expect(canvasGeometry?.nodeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: expectedImagePendingNodeIds[0], type: 'image' }),
            expect.objectContaining({ nodeId: expectedImagePendingNodeIds[1], type: 'image' }),
        ]))
        for (const pendingNodeId of expectedImagePendingNodeIds) {
            expect(canvasGeometry?.edgeSnapshots).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sourceNodeId: plan.branchForks[0].nodeId,
                    targetNodeId: pendingNodeId,
                }),
            ]))
        }
        expect(canvasGeometry?.nodes.map(node => node.nodeId)).not.toEqual(expect.arrayContaining(skippedVideoPendingNodeIds))
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).not.toEqual(expect.arrayContaining(skippedVideoPendingNodeIds))
        expect(canvasGeometry?.edgeSnapshots?.map(edge => edge.targetNodeId)).not.toEqual(expect.arrayContaining(skippedVideoPendingNodeIds))

        const pendingGeometries = expectedImagePendingNodeIds
            .map(nodeId => canvasGeometry!.nodes.find(node => node.nodeId === nodeId)!)
            .sort((a, b) => a.position.y - b.position.y)
        expect(pendingGeometries).toHaveLength(2)
        const pendingCircleGeometries = pendingGeometries
            .map(pendingPreFrameCircleRect)
            .sort((a, b) => a.y - b.y)
        expect(pendingCircleGeometries[1].y - (pendingCircleGeometries[0].y + pendingCircleGeometries[0].height))
            .toBe(mediaGenerationLayoutSettings.branchRowGap)
    })

    it('does not re-emit geometry for repeated stream refreshes after marker text settles', async () => {
        const plan = mixedImageVideoLineagePlan()
        let storedState = emptyCanvasState()
        let layoutRevision = 3000
        workspaceMutateCanvasState.mockImplementation(async ({ mutate }) => {
            const result = mutate(storedState)
            if (result.changed) {
                storedState = result.canvasState
                layoutRevision += 1
            }
            return {
                changed: result.changed,
                canvasState: storedState,
                canvasStateUpdatedAt: layoutRevision,
            }
        })

        const planGeometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        expect(planGeometry).not.toBeNull()

        const proseMirrorThreadContent = streamingThreadContentForPlan(
            plan,
            'I will make the llama brighter with much more detailed lighting, fur, pose, and background notes.',
        )
        const firstRefresh = await refreshMediaGenerationRequestCanvasGeometry({
            workspaceId: 'workspace-1',
            generationRequestId: plan.generationRequestId,
            aiChatThreadId: 'thread-1',
            proseMirrorThreadContent,
        })
        expect(firstRefresh).not.toBeNull()
        const positionsAfterFirstRefresh = storedState.nodes.map(node => [node.nodeId, node.position])

        const secondRefresh = await refreshMediaGenerationRequestCanvasGeometry({
            workspaceId: 'workspace-1',
            generationRequestId: plan.generationRequestId,
            aiChatThreadId: 'thread-1',
            proseMirrorThreadContent,
        })

        expect(secondRefresh).toBeNull()
        expect(storedState.nodes.map(node => [node.nodeId, node.position])).toEqual(positionsAfterFirstRefresh)
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

    it('returns a live canvas update when only a missing generated-media edge is repaired', async () => {
        const run = generationRun()
        const imageInput = {
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
        } as const

        await upsertGeneratedImageToCanvas(imageInput)
        const projectedState = latestMutator()(emptyCanvasState()).canvasState
        const stateMissingGeneratedEdge: CanvasState = {
            ...projectedState,
            edges: projectedState.edges.filter(edge => !(edge.sourceNodeId === 'fork-1' && edge.targetNodeId === 'node-file-1')),
        }
        mockWorkspaceMutationFromState(stateMissingGeneratedEdge, 2601)

        const canvasGeometry = await upsertGeneratedImageToCanvas(imageInput)

        expect(canvasGeometry).toMatchObject({
            layoutRevision: 2601,
        })
        expect(canvasGeometry?.edgeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({
                edgeId: 'edge-fork-1-node-file-1',
                sourceNodeId: 'fork-1',
                targetNodeId: 'node-file-1',
            }),
        ]))
    })

    it('persists final video geometry even when lineage planning skipped the video placeholder', async () => {
        const plan = mixedImageVideoLineagePlan()
        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const plannedState = latestMutator()(emptyCanvasState()).canvasState
        const videoAssignment = plan.runAssignments.find(assignment => assignment.mediaType === 'video')!
        const pendingNodeId = getPendingGeneratedMediaNodeId(videoAssignment)
        expect(plannedState.nodes.map(node => node.nodeId)).not.toContain(pendingNodeId)
        mockWorkspaceMutationFromState(plannedState, 3001)

        const canvasGeometry = await upsertGeneratedVideoToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            videoUrl: '/api/videos/workspace-1/video-file-1',
            fileId: 'video-file-1',
            posterUrl: '/api/images/workspace-1/poster-file-1',
            posterFileId: 'poster-file-1',
            frameUrl: '/api/images/workspace-1/frame-file-1',
            frameFileId: 'frame-file-1',
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'response-video-1',
            revisedPrompt: 'mountain goat video',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3',
            generationRun: generationRunFromAssignment(videoAssignment, 0),
        })

        const finalVideo = canvasGeometry?.nodeSnapshots?.find(node => node.nodeId === 'node-video-file-1')
        // The API may include the deterministic pending id in removedNodeIds
        // even when the node was never present. That makes removals idempotent
        // across clients that did or did not see a local pending video event.
        expect(canvasGeometry?.removedNodeIds).toEqual([pendingNodeId])
        expect(canvasGeometry?.edgeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceNodeId: videoAssignment.branchForkNodeId,
                targetNodeId: 'node-video-file-1',
            }),
        ]))
        expect(finalVideo).toMatchObject({
            nodeId: 'node-video-file-1',
            type: 'video',
            fileId: 'video-file-1',
            aspectRatio: 16 / 9,
            dimensions: { width: 800, height: 450 },
        })
    })

    it('replaces an existing unresolved video placeholder when final video arrives', async () => {
        const plan = mixedImageVideoLineagePlan()
        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const plannedState = latestMutator()(emptyCanvasState()).canvasState
        const videoAssignment = plan.runAssignments.find(assignment => assignment.mediaType === 'video')!
        const pendingNodeId = getPendingGeneratedMediaNodeId(videoAssignment)
        const stateWithActualVideoPending: CanvasState = {
            ...plannedState,
            nodes: [...plannedState.nodes, pendingVideoNodeFromAssignment(videoAssignment)],
            edges: [
                ...plannedState.edges,
                {
                    edgeId: `edge-${videoAssignment.branchForkNodeId}-${pendingNodeId}`,
                    sourceNodeId: videoAssignment.branchForkNodeId!,
                    targetNodeId: pendingNodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
            ],
        }
        mockWorkspaceMutationFromState(stateWithActualVideoPending, 3002)

        const canvasGeometry = await upsertGeneratedVideoToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            videoUrl: '/api/videos/workspace-1/video-file-2',
            fileId: 'video-file-2',
            posterUrl: '/api/images/workspace-1/poster-file-2',
            posterFileId: 'poster-file-2',
            frameUrl: '/api/images/workspace-1/frame-file-2',
            frameFileId: 'frame-file-2',
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'response-video-2',
            revisedPrompt: 'mountain goat video',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3',
            generationRun: generationRunFromAssignment(videoAssignment, 0),
        })

        expect(canvasGeometry?.removedNodeIds).toEqual([pendingNodeId])
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).toEqual(expect.arrayContaining(['node-video-file-2']))
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).not.toEqual(expect.arrayContaining([pendingNodeId]))
        expect(canvasGeometry?.edgeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceNodeId: videoAssignment.branchForkNodeId,
                targetNodeId: 'node-video-file-2',
            }),
        ]))
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

    it('settles pending media generation request markers by removing marker pendingState', async () => {
        await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
        })

        const state = latestMutator()({
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: 'origin-settle',
                    type: 'branchOrigin',
                    generationRequestId: 'request-1',
                    branchId: 'branch-1',
                    pendingState: { status: 'PENDING' },
                    position: { x: 0, y: 0 },
                    dimensions: { width: 10, height: 10 },
                } as any,
                {
                    nodeId: 'lineage-other',
                    type: 'branchOrigin',
                    generationRequestId: 'request-2',
                    branchId: 'branch-2',
                    pendingState: { status: 'PENDING' },
                    position: { x: 20, y: 20 },
                    dimensions: { width: 10, height: 10 },
                } as any,
                {
                    nodeId: 'image-keep',
                    type: 'image',
                    generationRequestId: 'request-1',
                    pendingState: { status: 'PENDING' },
                    position: { x: 40, y: 40 },
                    dimensions: { width: 100, height: 100 },
                } as any,
            ],
        })

        expect(state.changed).toBe(true)
        expect(state.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                nodeId: 'origin-settle',
                type: 'branchOrigin',
                generationRequestId: 'request-1',
            }),
            expect.objectContaining({
                nodeId: 'lineage-other',
                type: 'branchOrigin',
                generationRequestId: 'request-2',
                pendingState: { status: 'PENDING' },
            }),
            expect.objectContaining({
                nodeId: 'image-keep',
                type: 'image',
                generationRequestId: 'request-1',
                pendingState: { status: 'PENDING' },
            }),
        ]))
        expect(state.canvasState.nodes.find((node) => node.nodeId === 'origin-settle')).not.toHaveProperty('pendingState')
    })

    it('settle removes only unresolved pending generated media for the completed request', async () => {
        const plan = mixedImageVideoLineagePlan()
        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const plannedState = latestMutator()(emptyCanvasState()).canvasState
        const imageAssignment = plan.runAssignments.find(assignment => assignment.mediaType === 'image')!
        const videoAssignment = plan.runAssignments.find(assignment => assignment.mediaType === 'video')!
        const imagePendingNodeId = getPendingGeneratedMediaNodeId(imageAssignment)
        const videoPendingNodeId = getPendingGeneratedMediaNodeId(videoAssignment)
        const stateWithPartialImageAndStuckVideo: CanvasState = {
            ...plannedState,
            nodes: plannedState.nodes.map((node) => node.nodeId === imagePendingNodeId
                ? {
                    ...node,
                    fileId: 'partial-image-file',
                    src: '/api/images/workspace-1/partial-image-file',
                } as CanvasState['nodes'][number]
                : node).concat(pendingVideoNodeFromAssignment(videoAssignment)),
            edges: [
                ...plannedState.edges,
                {
                    edgeId: `edge-${videoAssignment.branchForkNodeId}-${videoPendingNodeId}`,
                    sourceNodeId: videoAssignment.branchForkNodeId!,
                    targetNodeId: videoPendingNodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
            ],
        }
        mockWorkspaceMutationFromState(stateWithPartialImageAndStuckVideo, 2801)

        const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: plan.generationRequestId,
            aiChatThreadId: 'thread-1',
        })

        const unresolvedImagePendingNodeId = getPendingGeneratedMediaNodeId(plan.runAssignments[1])
        expect(canvasGeometry?.removedNodeIds).toEqual([
            unresolvedImagePendingNodeId,
            videoPendingNodeId,
        ])
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).toEqual(expect.arrayContaining([imagePendingNodeId]))
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).not.toEqual(expect.arrayContaining([
            unresolvedImagePendingNodeId,
            videoPendingNodeId,
        ]))
        expect(canvasGeometry?.edgeSnapshots?.map(edge => edge.targetNodeId)).not.toEqual(expect.arrayContaining([
            unresolvedImagePendingNodeId,
            videoPendingNodeId,
        ]))

        const result = latestMutator()(stateWithPartialImageAndStuckVideo)
        expect(result.canvasState.nodes.map(node => node.nodeId)).toEqual(expect.arrayContaining([imagePendingNodeId]))
        expect(result.canvasState.nodes.map(node => node.nodeId)).not.toContain(unresolvedImagePendingNodeId)
        expect(result.canvasState.nodes.map(node => node.nodeId)).not.toContain(videoPendingNodeId)
        expect(result.canvasState.edges.map(edge => edge.targetNodeId)).not.toContain(unresolvedImagePendingNodeId)
        expect(result.canvasState.edges.map(edge => edge.targetNodeId)).not.toContain(videoPendingNodeId)
    })

    it('settle preserves pending generated media when a planned request completes without resolved media', async () => {
        const plan = mixedImageVideoLineagePlan()

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const plannedState = latestMutator()(emptyCanvasState()).canvasState
        const imagePendingNodeIds = plan.runAssignments
            .filter(assignment => assignment.mediaType === 'image')
            .map(getPendingGeneratedMediaNodeId)
        const markerPendingState: NonNullable<BranchForkCanvasNode['pendingState']> = {
            phase: 'planned',
            promptText: plan.promptText,
            reasoningModelIds: ['Anthropic:claude-haiku-4.5'],
            reasoningModelId: 'Anthropic:claude-haiku-4.5',
            reasoningIndex: 0,
            imageModelIds: ['Stability:sd-3.5-large', 'Stability:stable-image-ultra'],
            videoModelIds: [],
        }
        const plannedStateWithPendingMarker: CanvasState = {
            ...plannedState,
            nodes: plannedState.nodes.map((node): CanvasState['nodes'][number] =>
                node.type === 'branchFork'
                    ? { ...node, pendingState: markerPendingState }
                    : node
            ),
        }
        mockWorkspaceMutationFromState(plannedStateWithPendingMarker, 2802)

        const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: plan.generationRequestId,
            aiChatThreadId: 'thread-1',
        })

        expect(canvasGeometry?.removedNodeIds ?? []).toEqual([])
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).toEqual(expect.arrayContaining(imagePendingNodeIds))
        expect(canvasGeometry?.edgeSnapshots?.map(edge => edge.targetNodeId)).toEqual(expect.arrayContaining(imagePendingNodeIds))

        const result = latestMutator()(plannedStateWithPendingMarker)
        expect(result.canvasState.nodes.map(node => node.nodeId)).toEqual(expect.arrayContaining(imagePendingNodeIds))
        expect(result.canvasState.edges.map(edge => edge.targetNodeId)).toEqual(expect.arrayContaining(imagePendingNodeIds))
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

    it('projects pending generated media leaves from the lineage plan before any media completes', async () => {
        const plan = matrixLineagePlan()

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })

        const result = latestMutator()(emptyCanvasState())
        const generatedNodes = result.canvasState.nodes
            .filter(node => node.type === 'image' && Boolean(node.generatedBy?.mediaRunId))
        const expectedNodeIds = plan.runAssignments.map(getPendingGeneratedMediaNodeId)
        const nodeIds = new Set(result.canvasState.nodes.map(node => node.nodeId))

        expect(result.changed).toBe(true)
        expect(generatedNodes).toHaveLength(plan.runAssignments.length)
        expect(generatedNodes.map(node => node.nodeId).sort()).toEqual([...expectedNodeIds].sort())
        expect(generatedNodes.every(node => node.fileId === '' && node.src === '')).toBe(true)
        expect(result.canvasState.edges.every(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))).toBe(true)

        for (const assignment of plan.runAssignments) {
            const nodeId = getPendingGeneratedMediaNodeId(assignment)
            const pendingNode = generatedNodes.find(node => node.nodeId === nodeId)
            expect(pendingNode?.generatedBy).toEqual(expect.objectContaining({
                generationRequestId: assignment.generationRequestId,
                reasoningRunId: assignment.reasoningRunId,
                mediaRunId: assignment.mediaRunId,
                mediaModelId: assignment.mediaModelId,
                mediaIndex: assignment.mediaIndex,
                branchForkNodeId: assignment.branchForkNodeId,
            }))
            expect(result.canvasState.edges).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sourceNodeId: assignment.branchForkNodeId,
                    targetNodeId: nodeId,
                }),
            ]))
        }

        const forkNodes = result.canvasState.nodes.filter(node => node.type === 'branchFork')
        const branchGroupRects = forkNodes.map((fork) => {
            const branchChildren = generatedNodes.filter(node => node.generatedBy?.branchForkNodeId === fork.nodeId)
            expect(branchChildren).toHaveLength(4)
            const childCircleRects = branchChildren
                .map(node => ({ id: node.nodeId, rect: pendingPreFrameCircleRect(node) }))
                .sort((a, b) => a.rect.y - b.rect.y)
            expectNoOverlappingRects(childCircleRects)
            for (let index = 1; index < childCircleRects.length; index += 1) {
                const previous = childCircleRects[index - 1].rect
                const current = childCircleRects[index].rect
                expect(current.y - (previous.y + previous.height))
                    .toBeCloseTo(mediaGenerationLayoutSettings.branchRowGap, 6)
            }
            for (const child of childCircleRects) {
                expect(child.rect.x - (fork.position.x + fork.dimensions.width))
                    .toBeCloseTo(mediaGenerationLayoutSettings.rootToFirstMediaGap, 6)
            }
            return {
                id: fork.nodeId,
                rect: groupRectFromRects([nodeRect(fork), ...childCircleRects.map(child => child.rect)]),
            }
        })
        expectNoOverlappingRects(branchGroupRects)
    })

    it('replaces the deterministic pending media node when a final image arrives', async () => {
        const plan = matrixLineagePlan()
        const assignment = plan.runAssignments[0]
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignment)

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const pendingState = latestMutator()(emptyCanvasState()).canvasState

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-final-1',
            fileId: 'file-final-1',
            responseId: 'response-final-1',
            revisedPrompt: 'matrix result',
            aiProvider: 'Anthropic',
            imageModelProvider: assignment.mediaModelId!.split(':')[0],
            imageModelId: assignment.mediaModelId!.split(':').slice(1).join(':'),
            generationRun: generationRunFromAssignment(assignment, 0),
        })

        const finalState = latestMutator()(pendingState).canvasState

        expect(finalState.nodes.some(node => node.nodeId === pendingNodeId)).toBe(false)
        expect(finalState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                nodeId: 'node-file-final-1',
                type: 'image',
                fileId: 'file-final-1',
                generatedBy: expect.objectContaining({
                    mediaRunId: assignment.mediaRunId,
                    branchForkNodeId: assignment.branchForkNodeId,
                }),
            }),
        ]))
        expect(finalState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceNodeId: assignment.branchForkNodeId,
                targetNodeId: 'node-file-final-1',
            }),
        ]))
        expect(finalState.edges).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ targetNodeId: pendingNodeId }),
        ]))
    })

    it('settle geometry removes stale deterministic pending nodes when final media already replaced them', async () => {
        const plan = mixedImageVideoLineagePlan()
        const imageAssignments = plan.runAssignments.filter(assignment => assignment.mediaType === 'image')
        const firstAssignment = imageAssignments[0]
        const secondAssignment = imageAssignments[1]
        if (!firstAssignment || !secondAssignment) throw new Error('expected two image assignments')

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })
        const pendingState = latestMutator()(emptyCanvasState()).canvasState

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-final-0',
            fileId: 'file-final-0',
            responseId: 'response-final-0',
            revisedPrompt: 'matrix result 0',
            aiProvider: 'Anthropic',
            imageModelProvider: firstAssignment.mediaModelId!.split(':')[0],
            imageModelId: firstAssignment.mediaModelId!.split(':').slice(1).join(':'),
            generationRun: generationRunFromAssignment(firstAssignment, 0),
        })
        const afterFirstComplete = latestMutator()(pendingState).canvasState

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-final-1',
            fileId: 'file-final-1',
            responseId: 'response-final-1',
            revisedPrompt: 'matrix result 1',
            aiProvider: 'Anthropic',
            imageModelProvider: secondAssignment.mediaModelId!.split(':')[0],
            imageModelId: secondAssignment.mediaModelId!.split(':').slice(1).join(':'),
            generationRun: generationRunFromAssignment(secondAssignment, 0),
        })
        const completedState = latestMutator()(afterFirstComplete).canvasState
        const stateWithPendingMarker: CanvasState = {
            ...completedState,
            nodes: completedState.nodes.map((node) => node.nodeId === plan.branchForks[0].nodeId
                ? {
                    ...node,
                    pendingState: {
                        phase: 'planned',
                        promptText: plan.promptText,
                        reasoningModelIds: [plan.branchForks[0].reasoningModelId],
                        imageModelIds: imageAssignments.map(assignment => assignment.mediaModelId!),
                        videoModelIds: [],
                    },
                } as CanvasState['nodes'][number]
                : node),
        }
        mockWorkspaceMutationFromState(stateWithPendingMarker, 3901)

        const canvasGeometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: plan.generationRequestId,
            aiChatThreadId: 'thread-1',
        })

        expect(canvasGeometry?.removedNodeIds).toEqual(expect.arrayContaining([
            getPendingGeneratedMediaNodeId(firstAssignment),
            getPendingGeneratedMediaNodeId(secondAssignment),
        ]))
        expect(canvasGeometry?.nodeSnapshots?.map(node => node.nodeId)).not.toEqual(expect.arrayContaining([
            getPendingGeneratedMediaNodeId(firstAssignment),
            getPendingGeneratedMediaNodeId(secondAssignment),
        ]))
        expect(canvasGeometry?.nodes.map(node => node.nodeId)).toEqual(expect.arrayContaining([
            plan.branchForks[0].nodeId,
            'node-file-final-0',
            'node-file-final-1',
        ]))
        expect(canvasGeometry?.nodes.map(node => node.nodeId)).not.toEqual(expect.arrayContaining([
            getPendingGeneratedMediaNodeId(firstAssignment),
            getPendingGeneratedMediaNodeId(secondAssignment),
        ]))
        expect(canvasGeometry?.edgeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceNodeId: plan.branchForks[0].nodeId,
                targetNodeId: 'node-file-final-0',
            }),
            expect.objectContaining({
                sourceNodeId: plan.branchForks[0].nodeId,
                targetNodeId: 'node-file-final-1',
            }),
        ]))
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

    it('returns authoritative canvasGeometry with the persisted layoutRevision', async () => {
        // The mock runs the real mutator so the geometry diff is captured.
        workspaceMutateCanvasState.mockImplementation(async ({ mutate }: { mutate: (state: CanvasState) => { canvasState: CanvasState; changed: boolean } }) => {
            const result = mutate(emptyCanvasState())
            return { changed: result.changed, canvasState: result.canvasState, canvasStateUpdatedAt: 4242 }
        })

        const geometry = await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            aspectRatio: 16 / 9,
            generationRun: generationRun(),
        })

        expect(geometry).not.toBeNull()
        expect(geometry!.layoutRevision).toBe(4242)
        const imageGeometry = geometry!.nodes.find(node => node.nodeId === 'node-file-1')
        expect(imageGeometry).toBeDefined()
        // Final fitted dimensions are persisted so clients never re-fit on load.
        expect(imageGeometry!.dimensions.width / imageGeometry!.dimensions.height).toBeCloseTo(16 / 9, 3)
        // Markers are text-sized with the shared estimator, not a hardcoded box.
        const forkGeometry = geometry!.nodes.find(node => node.nodeId === 'fork-1')
        expect(forkGeometry).toBeDefined()
    })

    it('returns null geometry when the mutation changed nothing', async () => {
        workspaceMutateCanvasState.mockResolvedValue({ changed: false, canvasState: emptyCanvasState(), canvasStateUpdatedAt: 1 })

        const geometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-missing',
        })
        expect(geometry).toBeNull()
    })
})
