'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    CanvasNode,
    CanvasState,
    MediaBranchLineagePlan,
    MediaGenerationRunMeta,
    MediaRunLineageAssignment,
} from '@lixpi/constants'
import { getPendingGeneratedMediaNodeId } from '@lixpi/canvas-engine'

const workspaceMutateCanvasState = vi.hoisted(() => vi.fn())

vi.mock('../models/workspace.ts', () => ({
    default: { mutateCanvasState: workspaceMutateCanvasState },
}))

import {
    detachReviewedGeneratedOutputsFromCanvas,
    projectGeneratedAssetNode,
    refreshMediaGenerationRequestCanvasGeometry,
    removeGeneratedOutputCandidateFromCanvas,
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

const lineagePlan = (): MediaBranchLineagePlan => ({
    planVersion: 'media-branch-lineage-v1',
    generationRequestId: 'request-1',
    branchId: 'branch-1',
    promptText: 'draw a goat',
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

describe('asset canvas projection', () => {
    let storedState: CanvasState
    let revision: number

    beforeEach(() => {
        vi.clearAllMocks()
        storedState = emptyCanvasState()
        revision = 100
        workspaceMutateCanvasState.mockImplementation(async ({ mutate }) => {
            const result = mutate(storedState)
            if (result.changed) {
                storedState = result.canvasState
                revision += 1
            }
            return { ...result, canvasState: storedState, canvasStateUpdatedAt: revision }
        })
    })

    it('persists only API-planned lineage markers; it never creates client-style pending media nodes', async () => {
        const geometry = await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            lineagePlan: lineagePlan(),
        })

        expect(workspaceMutateCanvasState).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'upsertAssetMediaLineagePlanToCanvas',
        }))
        expect(storedState.nodes.map(node => node.nodeId)).toEqual(['origin-1', 'fork-1'])
        expect(storedState.nodes).not.toContainEqual(expect.objectContaining({
            nodeId: getPendingGeneratedMediaNodeId(assignment),
        }))
        expect(geometry).toMatchObject({
            generationRequestId: 'request-1',
            layoutRevision: 101,
            nodeSnapshots: expect.arrayContaining([
                expect.objectContaining({ nodeId: 'origin-1' }),
                expect.objectContaining({ nodeId: 'fork-1' }),
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

    it('keeps the parent centered while one sibling is ready and the other is still pending', () => {
        const bothPending = projectMedia(projectMedia(emptyCanvasState(), 0, true), 1, true)
        const mixed = projectMedia(bothPending, 0, false, 16 / 9)
        const fork = mixed.nodes.find((node) => node.nodeId === 'fork-1')!
        const first = mixed.nodes.find((node) => node.nodeId === getPendingGeneratedMediaNodeId(assignmentFor(0)))!
        const second = mixed.nodes.find((node) => node.nodeId === getPendingGeneratedMediaNodeId(assignmentFor(1)))!

        expect(first).toMatchObject({
            dimensions: { width: 800, height: 450 },
            mediaGenerationPhase: 'ready',
        })
        expect(second).toMatchObject({
            dimensions: { width: 800, height: 800 },
            mediaGenerationPhase: 'pending-before-first-frame',
        })
        expect(nodeCenterY(fork)).toBeCloseTo((nodeCenterY(first) + nodeCenterY(second)) / 2, 6)
    })

    it('converges on one final tree regardless of both arrival and completion order', () => {
        let forward = projectMedia(projectMedia(emptyCanvasState(), 0, true), 1, true)
        forward = projectMedia(forward, 0, false, 16 / 9)
        forward = projectMedia(forward, 1, false, 4 / 3)

        let reverse = projectMedia(projectMedia(emptyCanvasState(), 1, true), 0, true)
        reverse = projectMedia(reverse, 1, false, 4 / 3)
        reverse = projectMedia(reverse, 0, false, 16 / 9)

        expect(canonicalGenerationTree(reverse)).toEqual(canonicalGenerationTree(forward))
        expect(forward.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ dimensions: { width: 800, height: 450 }, mediaGenerationPhase: 'ready' }),
            expect.objectContaining({ dimensions: { width: 800, height: 600 }, mediaGenerationPhase: 'ready' }),
        ]))
    })

    it('balances heterogeneous image and video siblings deterministically', () => {
        let imageFirst = projectVideo(projectMedia(emptyCanvasState(), 0, true), true)
        imageFirst = projectMedia(imageFirst, 0, false, 4 / 3)
        imageFirst = projectVideo(imageFirst, false, 16 / 9)

        let videoFirst = projectMedia(projectVideo(emptyCanvasState(), true), 0, true)
        videoFirst = projectVideo(videoFirst, false, 16 / 9)
        videoFirst = projectMedia(videoFirst, 0, false, 4 / 3)

        expect(canonicalGenerationTree(videoFirst)).toEqual(canonicalGenerationTree(imageFirst))
        expect(imageFirst.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'image', dimensions: { width: 800, height: 600 } }),
            expect.objectContaining({ type: 'video', dimensions: { width: 800, height: 450 } }),
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

    it('removes failed Asset-backed pending nodes without deleting ready siblings', async () => {
        const pendingNodeId = getPendingGeneratedMediaNodeId(assignmentFor(0))
        const readyNodeId = getPendingGeneratedMediaNodeId(assignmentFor(1))
        storedState = {
            ...emptyCanvasState(),
            nodes: [
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
                    nodeId: readyNodeId,
                    type: 'image',
                    assetId: 'asset-2',
                    mediaGenerationPhase: 'ready',
                    position: { x: 1000, y: 0 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: { generationRequestId: 'request-1' },
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

        expect(storedState.nodes.map((node) => node.nodeId)).toEqual([readyNodeId])
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

        const accepted = detachReviewedGeneratedOutputsFromCanvas({ canvasState: state, scope: 'media-node', nodeId: 'media-1' })
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
