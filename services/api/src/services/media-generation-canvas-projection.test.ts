'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    CanvasNode,
    CanvasState,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
    MediaRunLineageAssignment,
} from '@lixpi/constants'
import { createDefaultMediaGenerationRunProgress } from '@lixpi/constants'
import {
    estimateBranchMarkerDimensions,
    getPendingGeneratedMediaNodeId,
} from '@lixpi/canvas-engine'

const mocks = vi.hoisted(() => ({
    detachWorkspaceReference: vi.fn(),
    getAssetRecord: vi.fn(),
    getWorkspace: vi.fn(),
    mutateCanvasState: vi.fn(),
}))

vi.mock('../models/workspace.ts', () => ({
    default: {
        getWorkspace: mocks.getWorkspace,
        mutateCanvasState: mocks.mutateCanvasState,
    },
}))

vi.mock('../models/asset.ts', () => ({
    default: { detachWorkspaceReference: mocks.detachWorkspaceReference },
    getAssetRecord: mocks.getAssetRecord,
}))

import {
    detachReviewedGeneratedOutputsFromCanvas,
    projectGeneratedAssetNode,
    refreshMediaGenerationRequestCanvasGeometry,
    removeGeneratedOutputCandidateFromCanvas,
    settleFailedGeneratedMediaRunOnCanvas,
    settleMediaGenerationRequestOnCanvas,
    upsertMediaLineagePlanToCanvas,
} from './asset-canvas-projection.ts'

const emptyCanvasState = (): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
})

const assignment = {
    assetId: 'asset-1',
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    mediaRunId: 'media-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    reasoningIndex: 0,
    mediaModelId: 'OpenAI:gpt-image-1',
    mediaType: 'image',
    mediaIndex: 0,
    branchId: 'branch-1',
    branchOriginNodeId: 'origin-1',
    branchForkNodeId: 'fork-1',
    lineageParentNodeId: 'fork-1',
    referenceAssetIds: [],
    referenceNodeIds: [],
    sourceContextNodeIds: [],
    operationKind: 'fresh_branch',
    promptText: 'draw a goat',
    createdAt: 1,
} as const

const assignmentFor = (mediaIndex: number): MediaRunLineageAssignment => ({
    ...assignment,
    assetId: `asset-${mediaIndex + 1}`,
    mediaRunId: `media-${mediaIndex + 1}`,
    mediaIndex,
})

const twoImageModelAssignments = (): MediaRunLineageAssignment[] => [
    { ...assignmentFor(0), mediaModelId: 'Stability:sd3.5-large' },
    { ...assignmentFor(1), mediaModelId: 'Google:gemini-2.5-flash-image' },
]

const lineagePlan = (): MediaBranchLineagePlan => ({
    planVersion: 'media-branch-lineage-v1',
    generationRequestId: 'request-1',
    branchId: 'branch-1',
    promptText: 'draw a goat',
    referenceAssetIds: [],
    referenceNodeIds: [],
    sourceContextNodeIds: [],
    branchOrigin: {
        nodeId: 'origin-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        provenance: { kind: 'branch-root-fork-decision', promptText: 'draw a goat', referenceNodeIds: [], sourceContextNodeIds: [], forked: true, forkCount: 1 },
    },
    branchForks: [{
        nodeId: 'fork-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        parentBranchNodeId: 'origin-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        provenance: { kind: 'reasoning-run', promptText: 'draw a goat', referenceNodeIds: [], sourceContextNodeIds: [], reasoningRunId: 'reasoning-1', reasoningModelId: 'Anthropic:claude-sonnet-4-6', reasoningIndex: 0 },
    }],
    branchLines: [],
    runAssignments: [assignment],
    createdAt: 1,
})

const selectedMediaFanoutPlan = (): MediaBranchLineagePlan => {
    const runAssignments = twoImageModelAssignments().map((entry) => ({
        ...entry,
        branchOriginNodeId: undefined,
        branchForkNodeId: 'selected-media-fork',
        lineageParentNodeId: 'selected-media-fork',
        parentMediaNodeId: 'selected-media',
        parentImageNodeId: 'selected-media',
        referenceNodeIds: ['selected-media'],
        sourceContextNodeIds: ['selected-media'],
        operationKind: 'edit_existing' as const,
    }))
    return {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId: 'request-1',
        branchId: 'existing-branch',
        promptText: 'make it a mountain omelet',
        sourceNodeId: 'selected-media',
        placementAnchorNodeId: 'selected-media',
        referenceAssetIds: ['selected-media-asset'],
        referenceNodeIds: ['selected-media'],
        sourceContextNodeIds: ['selected-media'],
        branchForks: [{
            nodeId: 'selected-media-fork',
            generationRequestId: 'request-1',
            branchId: 'existing-branch',
            parentBranchNodeId: 'selected-media',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            provenance: {
                kind: 'reasoning-run',
                promptText: 'make it a mountain omelet',
                referenceNodeIds: ['selected-media'],
                sourceContextNodeIds: ['selected-media'],
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                reasoningIndex: 0,
            },
        }],
        branchLines: [],
        runAssignments,
        createdAt: 1,
    }
}

const generationRun = (): MediaGenerationRunMeta => ({
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    mediaRunId: 'media-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'OpenAI:gpt-image-1',
    mediaType: 'image',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: assignment,
})

const generationRunFor = (mediaIndex: number): MediaGenerationRunMeta => {
    const lineageAssignment = assignmentFor(mediaIndex)
    return {
        ...generationRun(),
        mediaRunId: lineageAssignment.mediaRunId,
        mediaIndex,
        variantIndex: mediaIndex,
        lineageAssignment,
    }
}

const videoGenerationRun = (): MediaGenerationRunMeta => {
    const lineageAssignment: MediaRunLineageAssignment = {
        ...assignmentFor(0),
        assetId: 'asset-video-1',
        mediaRunId: 'video-media-1',
        mediaModelId: 'Google:veo-3',
        mediaType: 'video',
    }
    return {
        ...generationRun(),
        mediaRunId: lineageAssignment.mediaRunId,
        mediaModelId: lineageAssignment.mediaModelId,
        mediaType: 'video',
        lineageAssignment,
    }
}

const projectMedia = (
    canvasState: CanvasState,
    mediaIndex: number,
    pendingBeforeFirstFrame: boolean,
    aspectRatio = 1,
): CanvasState => projectGeneratedAssetNode({
    canvasState,
    assetId: `asset-${mediaIndex + 1}`,
    kind: 'image',
    aspectRatio,
    generationRun: generationRunFor(mediaIndex),
    conversationAssetId: 'thread-1',
    pendingBeforeFirstFrame,
}).canvasState

const projectVideo = (
    canvasState: CanvasState,
    pendingBeforeFirstFrame: boolean,
    aspectRatio = 1,
): CanvasState => projectGeneratedAssetNode({
    canvasState,
    assetId: 'asset-video-1',
    kind: 'video',
    aspectRatio,
    generationRun: videoGenerationRun(),
    conversationAssetId: 'thread-1',
    pendingBeforeFirstFrame,
}).canvasState

const canonicalGenerationTree = (canvasState: CanvasState): unknown[] => canvasState.nodes
    .filter((node) => node.type === 'branchOrigin'
        || node.type === 'branchFork'
        || ((node.type === 'image' || node.type === 'video') && node.generatedBy?.generationRequestId === 'request-1'))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((node) => ({
        nodeId: node.nodeId,
        type: node.type,
        position: node.position,
        dimensions: node.dimensions,
        ...((node.type === 'image' || node.type === 'video')
            ? { mediaGenerationPhase: node.mediaGenerationPhase }
            : {}),
    }))

const nodeCenterY = (node: CanvasNode): number => node.position.y + node.dimensions.height / 2

const completedThreadContent = (responseText: string): unknown => ({
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'thread-1' },
        content: [
            {
                type: 'aiUserMessage',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'make it happy' }] }],
            },
            {
                type: 'aiResponseMessage',
                attrs: { generationRequestId: 'request-1' },
                content: [{
                    type: 'aiReasoningSection',
                    attrs: {
                        generationRequestId: 'request-1',
                        reasoningRunId: 'reasoning-1',
                        branchLineNodeId: 'line-1',
                    },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: responseText }] }],
                }],
            },
        ],
    }],
})

describe('asset canvas projection', () => {
    let storedState: CanvasState
    let revision: number

    beforeEach(() => {
        vi.clearAllMocks()
        storedState = emptyCanvasState()
        revision = 100
        mocks.mutateCanvasState.mockImplementation(async ({ mutate }) => {
            const result = mutate(storedState)
            if (result.changed) {
                storedState = result.canvasState
                revision += 1
            }
            return { ...result, canvasState: storedState, canvasStateUpdatedAt: revision }
        })
        mocks.getAssetRecord.mockResolvedValue({
            assetId: 'asset-1',
            ownerUserId: 'user-1',
            organizationId: 'org-1',
        })
        mocks.getWorkspace.mockImplementation(async () => ({
            canvasState: storedState,
            canvasStateUpdatedAt: revision,
            updatedAt: revision,
        }))
        mocks.detachWorkspaceReference.mockImplementation(async ({ workspaceMutation }) => {
            storedState = workspaceMutation.canvasState
            revision = workspaceMutation.canvasStateUpdatedAt
            return { success: true }
        })
    })

    it('seeds only the lineage markers before any media asset is projected, leaving media slots for per-asset projection', async () => {
        const plan = lineagePlan()
        plan.runAssignments = twoImageModelAssignments()
        const geometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: plan,
        })

        expect(mocks.mutateCanvasState).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'upsertAssetMediaLineagePlanToCanvas',
        }))
        expect(storedState.nodes).toEqual([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork' }),
        ])
        expect(storedState.nodes.some(node => node.type === 'image' || node.type === 'video')).toBe(false)
        expect(storedState.edges).toEqual([
            expect.objectContaining({ sourceNodeId: 'origin-1', targetNodeId: 'fork-1' }),
        ])
        expect(geometry).toMatchObject({
            generationRequestId: 'request-1',
            layoutRevision: 101,
            nodeSnapshots: expect.arrayContaining([
                expect.objectContaining({ nodeId: 'origin-1' }),
                expect.objectContaining({ nodeId: 'fork-1' }),
            ]),
        })
    })

    it('keeps a viewport-fallback root visible and balances already-reserved media around it', async () => {
        const plan = lineagePlan()
        plan.runAssignments = twoImageModelAssignments()
        storedState = {
            viewport: { x: -500, y: -300, zoom: 0.5 },
            nodes: [
                ...plan.runAssignments.map((entry, index) => ({
                    nodeId: getPendingGeneratedMediaNodeId(entry),
                    type: 'image' as const,
                    assetId: entry.assetId,
                    mediaGenerationPhase: 'pending-before-first-frame' as const,
                    generationProgress: {
                        generationRequestId: entry.generationRequestId,
                        status: 'pending' as const,
                        message: 'Preparing the media request.',
                        progress: createDefaultMediaGenerationRunProgress('pending', 'Preparing the media request.'),
                        mediaModelId: entry.mediaModelId,
                        lineageAssignment: entry,
                        generationRun: index,
                        mediaRunId: entry.mediaRunId,
                        updatedAt: 1,
                    },
                    position: { x: 0, y: index * 1200 },
                    dimensions: { width: 800, height: 800 },
                })),
                ...plan.runAssignments.map((entry, index) => ({
                    nodeId: `operation-${index}`,
                    type: 'operationStatus' as const,
                    operation: 'media-generation' as const,
                    status: 'in-progress' as const,
                    title: 'Generating',
                    message: 'Working',
                    generationRequestId: entry.generationRequestId,
                    position: { x: 1000, y: 800 + index * 120 },
                    dimensions: { width: 360, height: 104 },
                    createdAt: 1,
                    updatedAt: 1,
                })),
            ],
            edges: [],
        }

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: plan,
            canvasVisibleArea: { width: 1200, height: 800 },
        })

        const origin = storedState.nodes.find(node => node.nodeId === 'origin-1')!
        const fork = storedState.nodes.find(node => node.nodeId === 'fork-1')!
        const outputs = plan.runAssignments.map(entry => (
            storedState.nodes.find(node => node.nodeId === getPendingGeneratedMediaNodeId(entry))!
        ))
        const visibleWorld = { left: 1000, top: 600, right: 3400, bottom: 2200 }
        expect(origin.position.x).toBeGreaterThanOrEqual(visibleWorld.left)
        expect(origin.position.y).toBeGreaterThanOrEqual(visibleWorld.top)
        expect(origin.position.x + origin.dimensions.width).toBeLessThanOrEqual(visibleWorld.right)
        expect(origin.position.y + origin.dimensions.height).toBeLessThanOrEqual(visibleWorld.bottom)
        const averageOutputCenterY = outputs.reduce((sum, output) => sum + nodeCenterY(output), 0) / outputs.length
        expect(averageOutputCenterY).toBeCloseTo(nodeCenterY(origin), 6)
        expect(nodeCenterY(fork)).toBeCloseTo(nodeCenterY(origin), 6)
    })

    it('projects a selected generated-media continuation onto a shared fork marker for every model slot', async () => {
        storedState = {
            ...emptyCanvasState(),
            nodes: [{
                nodeId: 'selected-media',
                type: 'image',
                assetId: 'selected-asset',
                mediaGenerationPhase: 'ready',
                position: { x: 100, y: 200 },
                dimensions: { width: 800, height: 800 },
                generatedBy: {
                    conversationAssetId: 'previous-thread',
                    responseId: '',
                    aiModel: 'Anthropic:claude-sonnet-4-6',
                    revisedPrompt: 'happy cookie',
                    generationRequestId: 'previous-request',
                    reasoningRunId: 'previous-reasoning',
                    mediaRunId: 'previous-media',
                    branchId: 'existing-branch',
                    promptText: 'happy cookie',
                },
            }],
            edges: [],
        } as CanvasState
        const plan = selectedMediaFanoutPlan()

        const geometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: plan,
        })

        const forks = storedState.nodes.filter(node => node.type === 'branchFork' && node.generationRequestId === 'request-1')
        expect(forks).toHaveLength(1)
        expect(forks[0]).toMatchObject({ nodeId: 'selected-media-fork', parentBranchNodeId: 'selected-media' })
        expect(storedState.nodes.some(node => node.type === 'image' || node.type === 'video')).toBe(true)
        // The lineage upsert projects no media assets of its own — only the fork marker.
        expect(storedState.nodes.filter(node => node.type === 'image' && node.nodeId !== 'selected-media')).toHaveLength(0)
        expect(storedState.nodes.some(node => node.type === 'branchOrigin' && node.generationRequestId === 'request-1')).toBe(false)
        expect(storedState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'selected-media', targetNodeId: 'selected-media-fork' }),
        ]))
        expect(geometry?.nodeSnapshots).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'selected-media-fork' }),
        ]))
    })

    it('replays a selected-media lineage plan without duplicating its fork marker', async () => {
        storedState = {
            ...emptyCanvasState(),
            nodes: [{
                nodeId: 'selected-media',
                type: 'image',
                assetId: 'selected-asset',
                mediaGenerationPhase: 'ready',
                position: { x: 100, y: 200 },
                dimensions: { width: 800, height: 800 },
            }],
        } as CanvasState
        const plan = selectedMediaFanoutPlan()

        await upsertMediaLineagePlanToCanvas({ workspaceId: 'workspace-1', conversationAssetId: 'thread-1', lineagePlan: plan })
        await upsertMediaLineagePlanToCanvas({ workspaceId: 'workspace-1', conversationAssetId: 'thread-1', lineagePlan: plan })

        expect(storedState.nodes.filter(node => node.nodeId === 'selected-media-fork')).toHaveLength(1)
        expect(new Set(storedState.edges.map(edge => edge.edgeId)).size).toBe(storedState.edges.length)
    })

    it('reconciles a provisional root to the authoritative continuation without orphaning its media slot', async () => {
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignment)
        storedState = {
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: 'source-media',
                    type: 'image',
                    assetId: 'source-asset',
                    mediaGenerationPhase: 'ready',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 800, height: 800 },
                },
                {
                    nodeId: pendingNodeId,
                    type: 'image',
                    assetId: assignment.assetId,
                    mediaGenerationPhase: 'pending-before-first-frame',
                    position: { x: 1000, y: 0 },
                    dimensions: { width: 800, height: 800 },
                },
            ],
            edges: [],
        } as CanvasState
        const provisionalPlan = lineagePlan()
        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: provisionalPlan,
        })
        const {
            branchOriginNodeId: _branchOriginNodeId,
            branchForkNodeId: _branchForkNodeId,
            ...continuationAssignment
        } = assignment
        const authoritativePlan: MediaBranchLineagePlan = {
            ...provisionalPlan,
            branchId: 'existing-branch',
            sourceNodeId: 'source-media',
            placementAnchorNodeId: 'source-media',
            referenceAssetIds: ['source-asset'],
            referenceNodeIds: ['source-media'],
            sourceContextNodeIds: ['source-media'],
            branchOrigin: undefined,
            branchForks: [],
            branchLines: [{
                nodeId: 'branch-line-request-1-r0-image-0',
                generationRequestId: 'request-1',
                branchId: 'existing-branch',
                parentBranchNodeId: 'source-media',
                reasoningRunId: assignment.reasoningRunId,
                reasoningModelId: assignment.reasoningModelId,
                reasoningIndex: assignment.reasoningIndex,
                mediaRunId: assignment.mediaRunId,
                mediaModelId: assignment.mediaModelId,
                mediaType: 'image',
                provenance: {
                    kind: 'branch-continuation',
                    promptText: assignment.promptText,
                    referenceNodeIds: ['source-media'],
                    sourceContextNodeIds: ['source-media'],
                    reasoningRunId: assignment.reasoningRunId,
                    reasoningModelId: assignment.reasoningModelId,
                    reasoningIndex: assignment.reasoningIndex,
                    mediaRunId: assignment.mediaRunId,
                    mediaModelId: assignment.mediaModelId,
                    mediaType: 'image',
                },
            }],
            runAssignments: [{
                ...continuationAssignment,
                branchId: 'existing-branch',
                parentMediaNodeId: 'source-media',
                parentImageNodeId: 'source-media',
                branchLineNodeId: 'branch-line-request-1-r0-image-0',
                lineageParentNodeId: 'branch-line-request-1-r0-image-0',
                referenceAssetIds: ['source-asset'],
                referenceNodeIds: ['source-media'],
                sourceContextNodeIds: ['source-media'],
                operationKind: 'edit_existing',
            }],
        }

        const geometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: authoritativePlan,
        })

        expect(storedState.nodes).not.toContainEqual(expect.objectContaining({ nodeId: 'origin-1' }))
        expect(storedState.nodes).not.toContainEqual(expect.objectContaining({ nodeId: 'fork-1' }))
        expect(storedState.nodes).toContainEqual(expect.objectContaining({
            nodeId: 'branch-line-request-1-r0-image-0',
            type: 'branchLine',
        }))
        expect(storedState.nodes).toContainEqual(expect.objectContaining({
            nodeId: pendingNodeId,
            type: 'image',
        }))
        expect(storedState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'source-media', targetNodeId: 'branch-line-request-1-r0-image-0' }),
            expect.objectContaining({ sourceNodeId: 'branch-line-request-1-r0-image-0', targetNodeId: pendingNodeId }),
        ]))
        expect(geometry).toMatchObject({
            removedNodeIds: expect.arrayContaining(['origin-1', 'fork-1']),
            removedEdgeIds: expect.arrayContaining([
                'edge-origin-1-fork-1',
                `edge-fork-1-${pendingNodeId}`,
            ]),
        })
    })

    it('attaches a generated asset to the server-owned lineage parent and returns the complete geometry', () => {
        const planned = projectGeneratedAssetNode({
            canvasState: (() => {
                const plan = lineagePlan()
                return {
                    ...emptyCanvasState(),
                    nodes: [
                        { nodeId: plan.branchOrigin!.nodeId, type: 'branchOrigin', branchId: 'branch-1', generationRequestId: 'request-1', position: { x: 0, y: 0 }, dimensions: { width: 120, height: 60 }, provenance: plan.branchOrigin!.provenance },
                        { nodeId: 'fork-1', type: 'branchFork', branchId: 'branch-1', generationRequestId: 'request-1', reasoningRunId: 'reasoning-1', reasoningModelId: 'Anthropic:claude-sonnet-4-6', reasoningIndex: 0, position: { x: 200, y: 0 }, dimensions: { width: 120, height: 60 }, provenance: plan.branchForks[0]!.provenance },
                    ],
                    edges: [{ edgeId: 'edge-origin-1-fork-1', sourceNodeId: 'origin-1', targetNodeId: 'fork-1', sourceHandle: 'right', targetHandle: 'left' }],
                } as CanvasState
            })(),
            assetId: 'asset-1',
            kind: 'image',
            aspectRatio: 1,
            generationRun: generationRun(),
            conversationAssetId: 'thread-1',
        })

        expect(planned.nodeId).toBe(getPendingGeneratedMediaNodeId(assignment))
        expect(planned.canvasState.nodes).toContainEqual(expect.objectContaining({
            nodeId: planned.nodeId,
            assetId: 'asset-1',
            generatedBy: expect.objectContaining({ lineageParentNodeId: 'fork-1' }),
        }))
        expect(planned.canvasState.edges).toContainEqual(expect.objectContaining({
            sourceNodeId: 'fork-1',
            targetNodeId: planned.nodeId,
        }))
        expect(planned.geometryNodes.map(node => node.nodeId)).toContain(planned.nodeId)
    })

    it('produces identical balanced pending trees regardless of sibling stream arrival order', () => {
        const forward = projectMedia(projectMedia(emptyCanvasState(), 0, true), 1, true)
        const reverse = projectMedia(projectMedia(emptyCanvasState(), 1, true), 0, true)

        expect(canonicalGenerationTree(reverse)).toEqual(canonicalGenerationTree(forward))
        expect(forward.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                nodeId: getPendingGeneratedMediaNodeId(assignmentFor(0)),
                mediaGenerationPhase: 'pending-before-first-frame',
            }),
            expect.objectContaining({
                nodeId: getPendingGeneratedMediaNodeId(assignmentFor(1)),
                mediaGenerationPhase: 'pending-before-first-frame',
            }),
        ]))
    })

    it('keeps a pending sibling square and freezes a completed sibling at its reserved card size, ignoring its real aspect ratio', () => {
        const bothPending = projectMedia(projectMedia(emptyCanvasState(), 0, true), 1, true)
        const mixed = projectMedia(bothPending, 0, false, 16 / 9)
        const fork = mixed.nodes.find((node) => node.nodeId === 'fork-1')!
        const first = mixed.nodes.find((node) => node.nodeId === getPendingGeneratedMediaNodeId(assignmentFor(0)))!
        const second = mixed.nodes.find((node) => node.nodeId === getPendingGeneratedMediaNodeId(assignmentFor(1)))!

        // The card reserved its footprint while pending; completing it must not
        // resize the card and trigger a tree reflow, even though the real
        // aspect ratio (16/9) would imply a shorter card.
        expect(first).toMatchObject({
            dimensions: { width: 800, height: 800 },
            mediaGenerationPhase: 'ready',
        })
        expect(second).toMatchObject({
            dimensions: { width: 800, height: 800 },
            mediaGenerationPhase: 'pending-before-first-frame',
        })
        expect(nodeCenterY(fork)).toBeCloseTo((nodeCenterY(first) + nodeCenterY(second)) / 2, 6)
    })

    it('converges on one final tree regardless of both arrival and completion order, with dimensions frozen at their pending size', () => {
        let forward = projectMedia(projectMedia(emptyCanvasState(), 0, true), 1, true)
        forward = projectMedia(forward, 0, false, 16 / 9)
        forward = projectMedia(forward, 1, false, 4 / 3)

        let reverse = projectMedia(projectMedia(emptyCanvasState(), 1, true), 0, true)
        reverse = projectMedia(reverse, 1, false, 4 / 3)
        reverse = projectMedia(reverse, 0, false, 16 / 9)

        expect(canonicalGenerationTree(reverse)).toEqual(canonicalGenerationTree(forward))
        expect(forward.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ dimensions: { width: 800, height: 800 }, mediaGenerationPhase: 'ready' }),
        ]))
        const readyNodes = forward.nodes.filter((node) =>
            (node.type === 'image') && node.mediaGenerationPhase === 'ready')
        expect(readyNodes).toHaveLength(2)
        for (const node of readyNodes) {
            expect(node.dimensions).toEqual({ width: 800, height: 800 })
        }
    })

    it('balances heterogeneous image and video siblings deterministically, both frozen at their pending square size', () => {
        let imageFirst = projectVideo(projectMedia(emptyCanvasState(), 0, true), true)
        imageFirst = projectMedia(imageFirst, 0, false, 4 / 3)
        imageFirst = projectVideo(imageFirst, false, 16 / 9)

        let videoFirst = projectMedia(projectVideo(emptyCanvasState(), true), 0, true)
        videoFirst = projectVideo(videoFirst, false, 16 / 9)
        videoFirst = projectMedia(videoFirst, 0, false, 4 / 3)

        expect(canonicalGenerationTree(videoFirst)).toEqual(canonicalGenerationTree(imageFirst))
        expect(imageFirst.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'image', dimensions: { width: 800, height: 800 } }),
            expect.objectContaining({ type: 'video', dimensions: { width: 800, height: 800 } }),
        ]))
    })

    it('does not emit a geometry update when a refresh has no server-side change', async () => {
        await upsertMediaLineagePlanToCanvas({ workspaceId: 'workspace-1', conversationAssetId: 'thread-1', lineagePlan: lineagePlan() })

        const geometry = await refreshMediaGenerationRequestCanvasGeometry({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
        })

        expect(geometry).toBeNull()
    })

    it('keeps a childless continuation connector straight when streamed response text grows the marker', async () => {
        const markerDimensions = estimateBranchMarkerDimensions('make it happy')
        const parentCenterY = 600
        storedState = {
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: 'parent-media',
                    type: 'image',
                    assetId: 'parent-asset',
                    mediaGenerationPhase: 'ready',
                    position: { x: 0, y: 200 },
                    dimensions: { width: 800, height: 800 },
                    generatedBy: {
                        conversationAssetId: 'previous-thread',
                        responseId: '',
                        aiModel: 'Anthropic:claude-sonnet-4-6',
                        revisedPrompt: 'parent',
                        branchId: 'branch-1',
                    },
                },
                {
                    nodeId: 'line-1',
                    type: 'branchLine',
                    branchId: 'branch-1',
                    generationRequestId: 'request-1',
                    conversationAssetId: 'thread-1',
                    parentBranchNodeId: 'parent-media',
                    reasoningRunId: 'reasoning-1',
                    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                    reasoningIndex: 0,
                    position: {
                        x: 1200,
                        y: parentCenterY - markerDimensions.height / 2,
                    },
                    dimensions: markerDimensions,
                    provenance: {
                        kind: 'reasoning-run',
                        promptText: 'make it happy',
                        referenceNodeIds: [],
                        sourceContextNodeIds: [],
                        reasoningRunId: 'reasoning-1',
                        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                        reasoningIndex: 0,
                    },
                },
            ] as CanvasNode[],
            edges: [{
                edgeId: 'edge-parent-line',
                sourceNodeId: 'parent-media',
                targetNodeId: 'line-1',
                sourceHandle: 'right',
                targetHandle: 'left',
            }],
        }

        await refreshMediaGenerationRequestCanvasGeometry({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            proseMirrorThreadContent: completedThreadContent('I will make the character cheerful.'),
        })

        const marker = storedState.nodes.find((node) => node.nodeId === 'line-1')!
        expect(marker.dimensions.height).toBeGreaterThan(markerDimensions.height)
        expect(nodeCenterY(marker)).toBe(parentCenterY)
    })

    it('removes only persisted unresolved candidates when a request settles', async () => {
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignment)
        storedState = {
            ...emptyCanvasState(),
            nodes: [{
                nodeId: pendingNodeId,
                type: 'image',
                position: { x: 0, y: 0 },
                dimensions: { width: 100, height: 100 },
            }],
            edges: [],
        } as CanvasState

        const geometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            removeProjectedPendingNodes: true,
            lineagePlan: lineagePlan(),
        })

        expect(storedState.nodes).toEqual([])
        expect(geometry).toMatchObject({ removedNodeIds: [pendingNodeId] })
    })

    it('replaces a failed Asset-backed pending node in place with the structured error surface', async () => {
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignmentFor(0))
        const readyNodeId = getPendingGeneratedMediaNodeId(assignmentFor(1))
        const operationNodeId = 'operation-request-1-0'
        storedState = {
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: 'fork-1',
                    type: 'branchFork',
                    branchId: 'branch-1',
                    generationRequestId: 'request-1',
                    position: { x: -200, y: 0 },
                    dimensions: { width: 120, height: 60 },
                    temporary: true,
                },
                {
                    nodeId: pendingNodeId,
                    type: 'image',
                    assetId: 'asset-1',
                    mediaGenerationPhase: 'pending-before-first-frame',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 800, height: 800 },
                    generatedBy: { generationRequestId: 'request-1' },
                },
                {
                    nodeId: operationNodeId,
                    type: 'operationStatus',
                    operation: 'media-generation',
                    status: 'failed',
                    title: 'Generating with OpenAI:gpt-image-1',
                    message: 'The provider rejected this request.',
                    generationRequestId: 'request-1',
                    generationRun: 0,
                    mediaRunId: 'media-1',
                    outputNodeId: pendingNodeId,
                    plannedMediaType: 'image',
                    problem: {
                        problemVersion: '1',
                        type: 'urn:lixpi:media-problem:provider-output',
                        title: 'Provider output failed',
                        detail: 'The provider rejected this request.',
                        category: 'provider-output',
                        stage: 'submit',
                        generationRequestId: 'request-1',
                        supportCode: 'support-1',
                        action: 'none',
                    },
                    position: { x: 0, y: 0 },
                    dimensions: { width: 360, height: 104 },
                    createdAt: 1,
                    updatedAt: 2,
                },
                {
                    nodeId: readyNodeId,
                    type: 'image',
                    assetId: 'asset-2',
                    mediaGenerationPhase: 'ready',
                    position: { x: 1000, y: 0 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: { generationRequestId: 'request-1' },
                },
            ],
            edges: [{
                edgeId: 'edge-fork-output',
                sourceNodeId: 'fork-1',
                targetNodeId: pendingNodeId,
                sourceHandle: 'right',
                targetHandle: 'left',
            }],
        } as CanvasState

        const geometry = await settleFailedGeneratedMediaRunOnCanvas({
            workspaceId: 'workspace-1',
            generationRun: generationRunFor(0),
        })

        expect(storedState.nodes).toContainEqual(expect.objectContaining({
            nodeId: pendingNodeId,
            type: 'operationStatus',
            status: 'failed',
            message: 'The provider rejected this request.',
            problem: expect.objectContaining({ supportCode: 'support-1' }),
            position: { x: 0, y: 0 },
            dimensions: { width: 800, height: 800 },
        }))
        expect(storedState.nodes).toContainEqual(expect.objectContaining({ nodeId: readyNodeId }))
        expect(storedState.nodes).not.toContainEqual(expect.objectContaining({ nodeId: operationNodeId }))
        expect(storedState.edges).toContainEqual(expect.objectContaining({ targetNodeId: pendingNodeId }))
        expect(geometry).toMatchObject({
            removedNodeIds: [operationNodeId],
            nodeSnapshots: expect.arrayContaining([
                expect.objectContaining({ nodeId: pendingNodeId, type: 'operationStatus' }),
            ]),
        })
        expect(mocks.detachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            nodeId: pendingNodeId,
        }))
    })

    it('preserves a failed error slot when terminal request cleanup removes unresolved media reservations', async () => {
        const failedNodeId = getPendingGeneratedMediaNodeId(assignmentFor(0))
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignmentFor(1))
        storedState = {
            ...emptyCanvasState(),
            nodes: [
                {
                    nodeId: failedNodeId,
                    type: 'operationStatus',
                    operation: 'media-generation',
                    status: 'failed',
                    title: 'Generating with OpenAI:gpt-image-1',
                    message: 'Provider failed.',
                    generationRequestId: 'request-1',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 800, height: 800 },
                    createdAt: 1,
                    updatedAt: 2,
                },
                {
                    nodeId: pendingNodeId,
                    type: 'image',
                    assetId: '',
                    mediaGenerationPhase: 'pending-before-first-frame',
                    position: { x: 1000, y: 0 },
                    dimensions: { width: 800, height: 800 },
                },
            ],
            edges: [],
        } as CanvasState
        const plan = lineagePlan()
        plan.runAssignments = [assignmentFor(0), assignmentFor(1)]

        const geometry = await settleMediaGenerationRequestOnCanvas({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            removeProjectedPendingNodes: true,
            lineagePlan: plan,
        })

        expect(storedState.nodes).toEqual([expect.objectContaining({ nodeId: failedNodeId, type: 'operationStatus' })])
        expect(geometry).toMatchObject({ removedNodeIds: [pendingNodeId] })
    })

    it('accept detaches output lineage and removes unreferenced markers, while supersede preserves an explicit marker', () => {
        const state: CanvasState = {
            ...emptyCanvasState(),
            nodes: [
                { nodeId: 'fork-1', type: 'branchFork', branchId: 'branch-1', generationRequestId: 'request-1', reasoningRunId: 'reasoning-1', reasoningModelId: 'Anthropic:claude-sonnet-4-6', reasoningIndex: 0, position: { x: 0, y: 0 }, dimensions: { width: 120, height: 60 }, provenance: {} },
                { nodeId: 'media-1', type: 'image', assetId: 'asset-1', position: { x: 200, y: 0 }, dimensions: { width: 100, height: 100 }, generatedBy: { branchId: 'branch-1', lineageParentNodeId: 'fork-1', generationRequestId: 'request-1', conversationAssetId: 'thread-1', responseId: '', aiModel: 'Anthropic:claude-sonnet-4-6', revisedPrompt: 'draw a goat' } },
            ] as any,
            edges: [{ edgeId: 'edge-fork-1-media-1', sourceNodeId: 'fork-1', targetNodeId: 'media-1', sourceHandle: 'right', targetHandle: 'left' }],
        }

        const accepted = detachReviewedGeneratedOutputsFromCanvas({ canvasState: state, scope: 'output-node', nodeId: 'media-1' })
        const superseded = removeGeneratedOutputCandidateFromCanvas({
            canvasState: state,
            nodeId: 'media-1',
            preserveLineageNodeIds: new Set(['fork-1']),
        })

        expect(accepted.canvasState.nodes).toContainEqual(expect.objectContaining({
            nodeId: 'media-1',
            generatedBy: expect.not.objectContaining({ branchId: 'branch-1' }),
        }))
        expect(accepted.removedNodeIds).toEqual(['fork-1'])
        expect(superseded.canvasState.nodes).toEqual([expect.objectContaining({ nodeId: 'fork-1' })])
        expect(superseded.removedNodeIds).toEqual(['media-1'])
    })
})
