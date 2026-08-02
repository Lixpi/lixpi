'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
    CanvasState,
    MediaGenerationRun,
    MediaReferenceBinding,
} from '@lixpi/constants'

const mutateCanvasState = vi.hoisted(() => vi.fn())

vi.mock('../models/workspace.ts', () => ({
    default: { mutateCanvasState },
}))

import {
    projectMediaGenerationOperationNodes,
    rebindMediaGenerationOperationNodes,
    updateMediaGenerationOperationNode,
} from './media-generation-operation-projection.ts'

const run = (overrides: Partial<MediaGenerationRun> = {}): MediaGenerationRun => ({
    generationRun: 0,
    reasoningModelId: 'Anthropic:claude',
    reasoningIndex: 0,
    provider: 'BytePlus',
    modelId: 'BytePlus:seedance-1-0-pro',
    status: 'pending',
    operationNodeId: 'operation-request-1-0',
    ...overrides,
})

const binding: MediaReferenceBinding = {
    assetId: 'asset-1',
    assetRevision: 1,
    nodeId: 'source-node',
    mediaKind: 'image',
    alias: 'REFERENCE_1',
    displayNameSnapshot: 'Source portrait',
    forbiddenNameVariants: ['source portrait'],
    semanticDescriptor: 'painted fictional traveler',
    depictionMedium: 'painting',
    subjectIdentity: {
        classification: 'fictional',
        source: 'user-attestation',
        currentAttestationId: 'attestation-1',
        providerVerifications: [],
    },
}

describe('media generation operation-node projection', () => {
    let canvasState: CanvasState

    beforeEach(() => {
        vi.clearAllMocks()
        canvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [{
                nodeId: 'source-node',
                type: 'image',
                assetId: 'asset-1',
                mediaGenerationPhase: 'ready',
                position: { x: 100, y: 200 },
                dimensions: { width: 400, height: 300 },
            }],
            edges: [],
        }
        mutateCanvasState.mockImplementation(async ({ mutate }) => {
            const result = mutate(canvasState)
            if (result.changed) canvasState = result.canvasState
            return { ...result, canvasState, canvasStateUpdatedAt: 2 }
        })
    })

    it('anchors initial status nodes to selected media and recognizes Seedance as video', async () => {
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [run()],
            bindings: [binding],
        })

        expect(canvasState.nodes).toEqual(expect.arrayContaining([expect.objectContaining({
            nodeId: 'operation-request-1-0',
            type: 'operationStatus',
            operation: 'media-generation',
            plannedMediaType: 'video',
            position: { x: 580, y: 200 },
        })]))
        expect(canvasState.edges).toEqual([expect.objectContaining({
            sourceNodeId: 'source-node',
            targetNodeId: 'operation-request-1-0',
        })])
    })

    it('rebinds the temporary node into the API-planned lineage slot and preserves its edge', async () => {
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [run()],
            bindings: [binding],
        })
        canvasState = {
            ...canvasState,
            nodes: [...canvasState.nodes, {
                nodeId: 'branch-fork-1',
                type: 'branchFork',
                branchId: 'branch-1',
                generationRequestId: 'request-1',
                parentBranchNodeId: 'source-node',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude',
                reasoningIndex: 0,
                provenance: {
                    kind: 'reasoning-run',
                    promptText: 'animate it',
                    referenceNodeIds: ['source-node'],
                    sourceContextNodeIds: ['source-node'],
                    reasoningRunId: 'reasoning-1',
                    reasoningModelId: 'Anthropic:claude',
                    reasoningIndex: 0,
                },
                position: { x: 700, y: 300 },
                dimensions: { width: 80, height: 80 },
                temporary: true,
            }],
        }

        await rebindMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            requestRevision: 3,
            bindings: [{
                previousNodeId: 'operation-request-1-0',
                operationNodeId: 'pending-media-request-1-0',
                lineageParentNodeId: 'branch-fork-1',
                run: run({ operationNodeId: 'pending-media-request-1-0' }),
            }],
        })

        expect(canvasState.nodes.some(node => node.nodeId === 'operation-request-1-0')).toBe(false)
        expect(canvasState.nodes).toEqual(expect.arrayContaining([expect.objectContaining({
            nodeId: 'pending-media-request-1-0',
            type: 'operationStatus',
            requestRevision: 3,
            position: { x: 860, y: 300 },
        })]))
        expect(canvasState.edges).toEqual(expect.arrayContaining([expect.objectContaining({
            sourceNodeId: 'branch-fork-1',
            targetNodeId: 'pending-media-request-1-0',
        })]))
    })

    it('clears stale recovery actions when a paused request resumes', async () => {
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [run()],
            bindings: [binding],
        })
        await updateMediaGenerationOperationNode({
            workspaceId: 'workspace-1',
            operationNodeId: 'operation-request-1-0',
            status: 'action-required',
            message: 'Choose a reference.',
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-1',
            verificationAssetId: 'asset-1',
            requestRevision: 2,
        })
        await updateMediaGenerationOperationNode({
            workspaceId: 'workspace-1',
            operationNodeId: 'operation-request-1-0',
            status: 'in-progress',
            message: 'Resuming.',
            requestRevision: 3,
            clearAction: true,
        })

        const operation = canvasState.nodes.find(node => node.nodeId === 'operation-request-1-0')
        expect(operation).not.toHaveProperty('candidateAssetIds')
        expect(operation).not.toHaveProperty('unresolvedBindingId')
        expect(operation).not.toHaveProperty('verificationAssetId')
        expect(operation).toMatchObject({ status: 'in-progress', message: 'Resuming.', requestRevision: 3 })
    })
})
