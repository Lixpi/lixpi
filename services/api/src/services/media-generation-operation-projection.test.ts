'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    mediaGenerationLayoutSettings,
    type CanvasState,
    type MediaBranchLineagePlan,
    type MediaGenerationRun,
    type MediaReferenceBinding,
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
        expect(canvasState.edges).toEqual([])
    })

    it('projects model attribution and lineage onto the reserved output before its first frame', async () => {
        const mediaRun = run({
            mediaRunId: 'media-run-1',
            mediaType: 'video',
            mediaIndex: 0,
            outputAssetId: 'output-asset-1',
            outputNodeId: 'output-node-1',
        })
        const lineagePlan = {
            planVersion: 'media-branch-lineage-v1',
            generationRequestId: 'request-1',
            branchId: 'branch-1',
            promptText: 'Animate the portrait.',
            referenceAssetIds: ['asset-1'],
            referenceNodeIds: ['source-node'],
            sourceContextNodeIds: ['source-node'],
            branchForks: [],
            branchLines: [],
            runAssignments: [{
                assetId: 'output-asset-1',
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-run-1',
                mediaRunId: 'media-run-1',
                reasoningModelId: 'Anthropic:claude',
                reasoningIndex: 0,
                mediaModelId: 'BytePlus:seedance-1-0-pro',
                mediaType: 'video',
                mediaIndex: 0,
                branchId: 'branch-1',
                branchForkNodeId: 'branch-fork-1',
                lineageParentNodeId: 'branch-fork-1',
                referenceAssetIds: ['asset-1'],
                referenceNodeIds: ['source-node'],
                sourceContextNodeIds: ['source-node'],
                promptText: 'Animate the portrait.',
                createdAt: 1,
            }],
            createdAt: 1,
        } satisfies MediaBranchLineagePlan

        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            lineagePlan,
            runs: [mediaRun],
            bindings: [binding],
        })

        const output = canvasState.nodes.find(node => node.nodeId === 'output-node-1')
        const operation = canvasState.nodes.find(node => node.nodeId === mediaRun.operationNodeId)
        expect(output).toMatchObject({
            nodeId: 'output-node-1',
            mediaGenerationPhase: 'pending-before-first-frame',
            generationProgress: expect.objectContaining({
                mediaModelId: 'BytePlus:seedance-1-0-pro',
                mediaModelProvider: 'BytePlus',
                lineageAssignment: expect.objectContaining({
                    branchId: 'branch-1',
                    lineageParentNodeId: 'branch-fork-1',
                }),
            }),
        })
        expect(output).not.toHaveProperty('generatedBy')
        expect(operation).toMatchObject({
            type: 'operationStatus',
            lineageAssignment: expect.objectContaining({
                branchId: 'branch-1',
                lineageParentNodeId: 'branch-fork-1',
            }),
        })
    })

    it('stacks unanchored pending media with the compact pre-frame pitch from shared settings', async () => {
        canvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [],
            edges: [],
        }
        const firstRun = run({
            generationRun: 0,
            operationNodeId: 'operation-request-1-0',
            mediaRunId: 'media-run-0',
            outputAssetId: 'output-asset-0',
            outputNodeId: 'output-node-0',
        })
        const secondRun = run({
            generationRun: 1,
            operationNodeId: 'operation-request-1-1',
            mediaRunId: 'media-run-1',
            outputAssetId: 'output-asset-1',
            outputNodeId: 'output-node-1',
        })

        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [firstRun, secondRun],
            bindings: [],
            visibleArea: { width: 1600, height: 1200 },
        })

        const firstOutput = canvasState.nodes.find(node => node.nodeId === 'output-node-0')!
        const secondOutput = canvasState.nodes.find(node => node.nodeId === 'output-node-1')!
        expect(Math.abs(secondOutput.position.y - firstOutput.position.y)).toBeCloseTo(
            mediaGenerationLayoutSettings.generatedMediaSize
                    * mediaGenerationLayoutSettings.preFrameCircleScale
                + mediaGenerationLayoutSettings.branchRowGap,
            6,
        )
    })

    it('rebinds temporary operation and output identities without losing the reserved slot or lineage edge', async () => {
        const provisionalRun = run({
            mediaRunId: 'provisional-media-run',
            outputAssetId: 'provisional-asset',
            outputNodeId: 'pending-media-provisional',
        })
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [provisionalRun],
            bindings: [binding],
        })
        const provisionalOutput = canvasState.nodes.find(node => node.nodeId === 'pending-media-provisional')!
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
            edges: [{
                edgeId: 'edge-branch-fork-1-pending-media-provisional',
                sourceNodeId: 'branch-fork-1',
                targetNodeId: 'pending-media-provisional',
                sourceHandle: 'right',
                targetHandle: 'left',
                pathType: 'horizontal-bezier',
            }],
        }

        await rebindMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            requestRevision: 3,
            bindings: [{
                previousNodeId: 'operation-request-1-0',
                previousOutputNodeId: 'pending-media-provisional',
                operationNodeId: 'pending-media-request-1-0',
                lineageParentNodeId: 'branch-fork-1',
                run: run({
                    operationNodeId: 'pending-media-request-1-0',
                    mediaRunId: 'authoritative-media-run',
                    outputAssetId: 'authoritative-asset',
                    outputNodeId: 'pending-media-authoritative',
                }),
            }],
        })

        expect(canvasState.nodes.some(node => node.nodeId === 'operation-request-1-0')).toBe(false)
        expect(canvasState.nodes.some(node => node.nodeId === 'pending-media-provisional')).toBe(false)
        expect(canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                nodeId: 'pending-media-request-1-0',
                type: 'operationStatus',
                requestRevision: 3,
                position: { x: 860, y: 300 },
            }),
            expect.objectContaining({
                nodeId: 'pending-media-authoritative',
                type: 'video',
                assetId: 'authoritative-asset',
                position: provisionalOutput.position,
            }),
        ]))
        expect(canvasState.edges).toEqual(expect.arrayContaining([expect.objectContaining({
            sourceNodeId: 'branch-fork-1',
            targetNodeId: 'pending-media-authoritative',
        })]))
        expect(canvasState.edges.some(edge => edge.targetNodeId === 'pending-media-provisional')).toBe(false)
        expect(canvasState.edges.some(edge => edge.targetNodeId === 'pending-media-request-1-0')).toBe(false)
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

    it('keeps the provider run pending while the request awaits an Asset reference', async () => {
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [run({
                mediaRunId: 'media-run-1',
                outputAssetId: 'output-asset-1',
                outputNodeId: 'output-node-1',
            })],
            bindings: [binding],
        })
        await updateMediaGenerationOperationNode({
            workspaceId: 'workspace-1',
            operationNodeId: 'operation-request-1-0',
            status: 'action-required',
            message: 'Choose a reference.',
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-1',
            requestRevision: 2,
        })

        const output = canvasState.nodes.find(node => node.nodeId === 'output-node-1')
        expect(output).toMatchObject({
            generationProgress: {
                status: 'pending',
                message: 'Choose a reference.',
            },
        })
    })

    it('projects terminal failure without illegally removing the reserved Asset node', async () => {
        const failedRun = run({
            mediaType: 'image',
            mediaRunId: 'media-run-1',
            outputAssetId: 'output-asset-1',
            outputNodeId: 'output-node-1',
        })
        await projectMediaGenerationOperationNodes({
            workspaceId: 'workspace-1',
            generationRequestId: 'request-1',
            runs: [failedRun],
            bindings: [binding],
        })
        const reservedOutput = canvasState.nodes.find(node => node.nodeId === 'output-node-1')!
        canvasState = {
            ...canvasState,
            edges: [{
                edgeId: 'edge-source-output',
                sourceNodeId: 'source-node',
                targetNodeId: 'output-node-1',
                sourceHandle: 'right',
                targetHandle: 'left',
            }],
        }

        await updateMediaGenerationOperationNode({
            workspaceId: 'workspace-1',
            operationNodeId: failedRun.operationNodeId,
            generationRequestId: 'request-1',
            generationRun: 0,
            status: 'failed',
            message: 'The generated result was blocked by the provider safety check.',
            requestRevision: 4,
        })

        expect(canvasState.nodes).toEqual(expect.arrayContaining([expect.objectContaining({
            nodeId: 'output-node-1',
            type: 'image',
            generationProgress: expect.objectContaining({ status: 'failed' }),
        })]))
        expect(canvasState.nodes).toEqual(expect.arrayContaining([expect.objectContaining({
            nodeId: failedRun.operationNodeId,
            type: 'operationStatus',
            status: 'failed',
            position: {
                x: reservedOutput.position.x + (reservedOutput.dimensions.width - 360) / 2,
                y: reservedOutput.position.y + (reservedOutput.dimensions.height - 104) / 2,
            },
        })]))
        expect(canvasState.edges).toEqual([expect.objectContaining({
            sourceNodeId: 'source-node',
            targetNodeId: 'output-node-1',
        })])
        expect(mutateCanvasState).toHaveBeenLastCalledWith(expect.not.objectContaining({
            allowUnboundGeneratedMediaReservationMutation: true,
        }))
    })
})
