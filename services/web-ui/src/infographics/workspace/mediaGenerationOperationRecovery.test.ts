import { describe, expect, it } from 'vitest'

import type {
    CanvasState,
    MediaGenerationRequest,
    MediaGenerationRequestEvent,
    OperationStatusCanvasNode,
} from '@lixpi/constants'

import {
    applyMediaGenerationRequestEventToOperationNodes,
    applyMediaGenerationRequestToOperationNodes,
} from './mediaGenerationOperationRecovery.ts'

function operationNode(overrides: Partial<OperationStatusCanvasNode> = {}): OperationStatusCanvasNode {
    return {
        nodeId: 'operation-1',
        type: 'operationStatus',
        operation: 'media-generation',
        status: 'in-progress',
        title: 'Generating with Stability',
        message: 'Preparing the media request.',
        generationRequestId: 'request-1',
        generationRun: 0,
        position: { x: 20, y: 30 },
        dimensions: { width: 360, height: 104 },
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function canvasState(node = operationNode()): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [node],
        edges: [{
            edgeId: 'edge-1',
            sourceNodeId: 'source-1',
            targetNodeId: node.nodeId,
        }],
    }
}

function request(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
    return {
        generationRequestId: 'request-1',
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        userId: 'user-1',
        conversationAssetId: 'conversation-1',
        status: 'running',
        checkpointBlobHash: 'blob-1',
        checkpointSchemaVersion: '1',
        bindings: [],
        unresolvedBindings: [],
        resolvedReferences: [],
        runs: [{
            generationRun: 0,
            reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
            reasoningIndex: 0,
            provider: 'Stability',
            modelId: 'Stability:sd3.5-large',
            status: 'running',
            operationNodeId: 'operation-1',
        }],
        plannedCanvasNodeIds: ['operation-1'],
        revision: 2,
        createdAt: 1,
        updatedAt: 2,
        statusUpdatedAt: 2,
        ...overrides,
    }
}

describe('media generation operation recovery', () => {
    it('projects a replayed ambiguity snapshot into the existing operation node', () => {
        const result = applyMediaGenerationRequestToOperationNodes(canvasState(), request({
            status: 'awaiting-reference-resolution',
            unresolvedBindings: [{
                bindingId: 'binding-1',
                promptRange: { from: 0, to: 8 },
                originalText: 'portrait',
                matcherVersion: '1',
                candidates: [
                    { assetId: 'asset-1', score: 0.9, previewRenditionName: 'thumbnail' },
                    { assetId: 'asset-2', score: 0.8, previewRenditionName: 'thumbnail' },
                ],
            }],
        }))

        expect(result.changed).toBe(true)
        expect(result.updatedNodeIds).toEqual(['operation-1'])
        expect(result.state.nodes[0]).toMatchObject({
            status: 'action-required',
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-1',
            requestRevision: 2,
        })
    })

    it('removes completed request nodes and their incident edges without reloading workspace Assets', () => {
        const result = applyMediaGenerationRequestToOperationNodes(canvasState(), request({ status: 'completed' }))

        expect(result.changed).toBe(true)
        expect(result.removedNodeIds).toEqual(['operation-1'])
        expect(result.state.nodes).toEqual([])
        expect(result.state.edges).toEqual([])
    })

    it('applies live provider problems from the durable event envelope', () => {
        const problem = {
            problemVersion: '1',
            type: 'urn:lixpi:media-problem:provider-output',
            title: 'Provider failed',
            detail: 'The provider did not return media.',
            category: 'provider-output',
            stage: 'poll',
            generationRequestId: 'request-1',
            generationRun: 0,
            supportCode: 'support-1',
            action: 'edit-request',
        } as const
        const event: MediaGenerationRequestEvent = {
            eventId: 'event-3',
            generationRequestId: 'request-1',
            sequence: 3,
            status: 'MEDIA_GENERATION_PROBLEM',
            requestRevision: 3,
            payload: { status: 'failed', runStatus: 'failed', generationRun: 0, problem },
            createdAt: 3,
        }
        const result = applyMediaGenerationRequestEventToOperationNodes(canvasState(), event)

        expect(result.state.nodes[0]).toMatchObject({
            status: 'failed',
            message: problem.detail,
            problem,
            requestRevision: 3,
        })
    })

    it('removes only the completed run when sibling operation nodes remain active', () => {
        const sibling = operationNode({ nodeId: 'operation-2', generationRun: 1 })
        const state: CanvasState = {
            ...canvasState(),
            nodes: [operationNode(), sibling],
            edges: [
                { edgeId: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'operation-1' },
                { edgeId: 'edge-2', sourceNodeId: 'source-1', targetNodeId: 'operation-2' },
            ],
        }
        const event: MediaGenerationRequestEvent = {
            eventId: 'event-4',
            generationRequestId: 'request-1',
            sequence: 4,
            status: 'MEDIA_GENERATION_REQUEST_STATUS',
            requestRevision: 4,
            payload: { status: 'running', runStatus: 'completed', generationRun: 0 },
            createdAt: 4,
        }
        const result = applyMediaGenerationRequestEventToOperationNodes(state, event)

        expect(result.removedNodeIds).toEqual(['operation-1'])
        expect(result.state.nodes.map(node => node.nodeId)).toEqual(['operation-2'])
        expect(result.state.edges.map(edge => edge.edgeId)).toEqual(['edge-2'])
    })
})
