'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasState, MediaBranchLineagePlan, MediaGenerationRunMeta } from '@lixpi/constants'
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
