import {
    describe,
    expect,
    it,
} from 'vitest'

import type {
    CanvasNode,
    CanvasState,
    MediaGenerationRequest,
    MediaGenerationRequestEvent,
    OperationStatusCanvasNode,
} from '@lixpi/constants'

import {
    applyMediaGenerationRequestEventToOperationNodes,
    applyMediaGenerationRequestToOperationNodes,
    applyMediaGenerationStreamFailureToOperationNodes,
} from './operation-recovery.ts'

type GeneratedMediaNode = Extract<CanvasNode, { type: 'image' | 'video' }>

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

function pendingOutputNode(overrides: Partial<GeneratedMediaNode> = {}): GeneratedMediaNode {
    return {
        nodeId: 'pending-image-media-run-1',
        type: 'image',
        assetId: 'asset-1',
        mediaGenerationPhase: 'pending-before-first-frame',
        generationProgress: {
            generationRequestId: 'request-1',
            generationRun: 0,
            mediaRunId: 'media-run-1',
            status: 'running',
            message: 'The provider is generating media.',
            progress: {
                phase: 'rendering',
                completedSteps: 1,
                totalSteps: 3,
                message: 'The provider is generating media.',
            },
            mediaModelId: 'OpenAI:gpt-image-2',
            mediaModelProvider: 'OpenAI',
            lineageAssignment: {
                assetId: 'asset-1',
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-run-1',
                mediaRunId: 'media-run-1',
                reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
                reasoningIndex: 0,
                mediaModelId: 'OpenAI:gpt-image-2',
                mediaType: 'image',
                mediaIndex: 0,
                branchId: 'branch-1',
                branchForkNodeId: 'branch-fork-1',
                lineageParentNodeId: 'branch-fork-1',
                referenceAssetIds: [],
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                promptText: 'Transform the reference.',
                createdAt: 1,
            },
            updatedAt: 2,
        },
        position: { x: 500, y: 200 },
        dimensions: { width: 512, height: 512 },
        ...overrides,
    } as GeneratedMediaNode
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
        const result = applyMediaGenerationRequestToOperationNodes(
            canvasState(),
            request({
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
            }),
        )

        expect(result.changed).toBe(true)
        expect(result.updatedNodeIds).toEqual(['operation-1'])
        expect(result.state.nodes[0]).toMatchObject({
            status: 'action-required',
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-1',
            requestRevision: 2,
        })
    })

    it('does not misclassify request reference ambiguity as provider verification', () => {
        const state: CanvasState = {
            ...canvasState(),
            nodes: [operationNode(), pendingOutputNode()],
        }
        const result = applyMediaGenerationRequestToOperationNodes(
            state,
            request({
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
                runs: [{
                    generationRun: 0,
                    reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
                    reasoningIndex: 0,
                    provider: 'Stability',
                    modelId: 'Stability:sd3.5-large',
                    status: 'pending',
                    operationNodeId: 'operation-1',
                    outputNodeId: 'pending-image-media-run-1',
                    mediaRunId: 'media-run-1',
                }],
            }),
        )

        expect(result.state.nodes.find(node => node.nodeId === 'pending-image-media-run-1')).toMatchObject({
            generationProgress: {
                status: 'pending',
                message: 'Choose which attached Asset the prompt refers to.',
            },
        })
    })

    it('does not combine candidates from later unresolved bindings into the active picker', () => {
        const result = applyMediaGenerationRequestToOperationNodes(
            canvasState(),
            request({
                status: 'awaiting-reference-resolution',
                unresolvedBindings: [{
                    bindingId: 'binding-reference-drawing',
                    promptRange: { from: 0, to: 17 },
                    originalText: 'reference drawing',
                    matcherVersion: '1',
                    candidates: [
                        { assetId: 'asset-1', score: 0.9, previewRenditionName: 'thumbnail' },
                        { assetId: 'asset-2', score: 0.8, previewRenditionName: 'thumbnail' },
                    ],
                }, {
                    bindingId: 'binding-character-sheet',
                    promptRange: { from: 18, to: 33 },
                    originalText: 'character sheet',
                    matcherVersion: '1',
                    candidates: [
                        { assetId: 'asset-2', score: 0.9, previewRenditionName: 'thumbnail' },
                        { assetId: 'asset-3', score: 0.8, previewRenditionName: 'thumbnail' },
                    ],
                }],
            }),
        )

        expect(result.state.nodes[0]).toMatchObject({
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-reference-drawing',
        })
    })

    it('atomically replaces the picker binding and candidates from the next action event', () => {
        const event: MediaGenerationRequestEvent = {
            eventId: 'event-2',
            generationRequestId: 'request-1',
            sequence: 2,
            status: 'MEDIA_GENERATION_ACTION_REQUIRED',
            requestRevision: 2,
            payload: {
                status: 'awaiting-reference-resolution',
                bindingId: 'binding-character-sheet',
                candidateAssetIds: ['asset-2', 'asset-3'],
                resolvedBindingId: 'binding-reference-drawing',
                resolvedAssetId: 'asset-1',
            },
            createdAt: 2,
        }
        const result = applyMediaGenerationRequestEventToOperationNodes(
            canvasState(operationNode({
                status: 'action-required',
                candidateAssetIds: ['asset-1', 'asset-2'],
                unresolvedBindingId: 'binding-reference-drawing',
                requestRevision: 1,
            })),
            event,
        )

        expect(result.state.nodes[0]).toMatchObject({
            status: 'action-required',
            candidateAssetIds: ['asset-2', 'asset-3'],
            unresolvedBindingId: 'binding-character-sheet',
            requestRevision: 2,
        })
    })

    it('ignores a legacy same-revision action that carries a binding without its candidates', () => {
        const currentNode = operationNode({
            status: 'action-required',
            candidateAssetIds: ['asset-2', 'asset-3'],
            unresolvedBindingId: 'binding-character-sheet',
            requestRevision: 2,
        })
        const event: MediaGenerationRequestEvent = {
            eventId: 'legacy-event-2',
            generationRequestId: 'request-1',
            sequence: 2,
            status: 'MEDIA_GENERATION_ACTION_REQUIRED',
            requestRevision: 2,
            payload: {
                status: 'awaiting-reference-resolution',
                bindingId: 'binding-reference-drawing',
                assetId: 'asset-1',
            },
            createdAt: 2,
        }

        const result = applyMediaGenerationRequestEventToOperationNodes(canvasState(currentNode), event)

        expect(result.changed).toBe(false)
        expect(result.state.nodes[0]).toBe(currentNode)
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

    it('preserves complete execution traces while replaying JetStream progress', () => {
        const output = pendingOutputNode()
        const event: MediaGenerationRequestEvent = {
            eventId: 'progress-with-trace',
            generationRequestId: 'request-1',
            sequence: 2,
            status: 'MEDIA_GENERATION_PROGRESS',
            requestRevision: 1,
            payload: {
                status: 'running',
                runStatus: 'running',
                generationRun: 0,
                mediaRunId: 'media-run-1',
                outputNodeId: output.nodeId,
                progress: {
                    phase: 'assessing',
                    completedSteps: 2,
                    totalSteps: 3,
                    message: 'Comparing the rendered result.',
                    items: [{
                        id: 'assess',
                        title: 'Assess result',
                        status: 'running',
                        trace: {
                            traceVersion: 'execution-trace-v1',
                            reasoning: 'The framing matches the requested target.',
                            handles: [{
                                kind: 'media',
                                id: 'asset-1',
                                displayName: 'Source image',
                                mediaKind: 'image',
                                role: 'comparison-source',
                            }],
                            modelCalls: [{
                                id: 'assessment-1',
                                role: 'assessor',
                                provider: 'Anthropic',
                                modelId: 'Anthropic:claude-opus-5',
                                purpose: 'Compare the result with its sources.',
                                params: [{ name: 'framing', value: '0.91' }],
                                inputHandles: [{
                                    kind: 'media',
                                    id: 'asset-1',
                                    displayName: 'Source image',
                                    mediaKind: 'image',
                                }],
                                tokenUsage: { input: 120, output: 30, reasoning: 18 },
                            }],
                            facts: [{ label: 'Overall score', value: '0.91' }],
                        },
                    }],
                },
            },
            createdAt: 2,
        }

        const result = applyMediaGenerationRequestEventToOperationNodes({
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [output],
            edges: [],
        }, event)
        const updated = result.state.nodes[0] as GeneratedMediaNode
        const trace = updated.generationProgress?.progress.items?.[0]?.trace

        expect(trace?.reasoning).toBe('The framing matches the requested target.')
        expect(trace?.handles?.[0]).toMatchObject({ id: 'asset-1', role: 'comparison-source' })
        expect(trace?.modelCalls?.[0]).toMatchObject({
            role: 'assessor',
            params: [{ name: 'framing', value: '0.91' }],
            tokenUsage: { input: 120, output: 30, reasoning: 18 },
        })
        expect(trace?.facts).toEqual([{ label: 'Overall score', value: '0.91' }])
    })

    it('does not erase accumulated trace items when a later status event has only generic progress', () => {
        const output = pendingOutputNode({
            generationProgress: {
                ...pendingOutputNode().generationProgress!,
                progress: {
                    phase: 'assessing',
                    completedSteps: 2,
                    totalSteps: 3,
                    message: 'Assessment is active.',
                    items: [{
                        id: 'assess',
                        title: 'Assess result',
                        status: 'running',
                        trace: {
                            traceVersion: 'execution-trace-v1',
                            facts: [{ label: 'Framing', value: '0.91' }],
                        },
                    }],
                },
            },
        })
        const event: MediaGenerationRequestEvent = {
            eventId: 'generic-running-status',
            generationRequestId: 'request-1',
            sequence: 3,
            status: 'MEDIA_GENERATION_REQUEST_STATUS',
            requestRevision: 2,
            payload: {
                status: 'running',
                runStatus: 'running',
                generationRun: 0,
                mediaRunId: 'media-run-1',
                outputNodeId: output.nodeId,
            },
            createdAt: 3,
        }

        const result = applyMediaGenerationRequestEventToOperationNodes({
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [output],
            edges: [],
        }, event)
        const progress = (result.state.nodes[0] as GeneratedMediaNode).generationProgress?.progress

        expect(progress?.phase).toBe('assessing')
        expect(progress?.items?.[0]?.trace?.facts).toEqual([{ label: 'Framing', value: '0.91' }])
    })

    it('replaces a failed pending output with the existing operation card in its reserved slot', () => {
        const output = pendingOutputNode()
        const operation = operationNode({
            mediaRunId: 'media-run-1',
            outputNodeId: output.nodeId,
        })
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [operation, output],
            edges: [{
                edgeId: 'edge-source-output',
                sourceNodeId: 'source-1',
                targetNodeId: output.nodeId,
            }],
        }
        const failedRequest = request({
            status: 'failed',
            runs: [{
                ...request().runs[0],
                provider: 'OpenAI',
                modelId: 'OpenAI:gpt-image-2',
                mediaRunId: 'media-run-1',
                outputNodeId: output.nodeId,
                status: 'failed',
                problem: {
                    problemVersion: '1',
                    type: 'urn:lixpi:media-problem:provider-moderation',
                    title: 'Provider rejected the request',
                    detail: 'The generated result was blocked by the provider safety check.',
                    category: 'provider-moderation',
                    stage: 'poll',
                    generationRequestId: 'request-1',
                    generationRun: 0,
                    supportCode: 'support-1',
                    action: 'edit-request',
                },
            }],
        })

        const result = applyMediaGenerationRequestToOperationNodes(state, failedRequest)

        expect(result.removedNodeIds).toEqual([operation.nodeId])
        expect(result.state.nodes.some(node => node.nodeId === operation.nodeId)).toBe(false)
        expect(result.state.nodes).toEqual(expect.arrayContaining([expect.objectContaining({
            nodeId: output.nodeId,
            status: 'failed',
            position: { x: 576, y: 404 },
            lineageAssignment: expect.objectContaining({
                branchId: 'branch-1',
                branchForkNodeId: 'branch-fork-1',
            }),
        })]))
        expect(result.state.edges).toEqual([expect.objectContaining({
            sourceNodeId: 'source-1',
            targetNodeId: output.nodeId,
        })])
    })

    it('materializes the failure card from a terminal live event when the hidden operation node is absent', () => {
        const output = pendingOutputNode()
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [output],
            edges: [{
                edgeId: 'edge-source-output',
                sourceNodeId: 'source-1',
                targetNodeId: output.nodeId,
            }],
        }
        const event: MediaGenerationRequestEvent = {
            eventId: 'event-5',
            generationRequestId: 'request-1',
            sequence: 5,
            status: 'MEDIA_GENERATION_PROBLEM',
            requestRevision: 5,
            payload: {
                status: 'failed',
                runStatus: 'failed',
                generationRun: 0,
                mediaRunId: 'media-run-1',
                outputNodeId: output.nodeId,
                problem: {
                    problemVersion: '1',
                    type: 'urn:lixpi:media-problem:provider-moderation',
                    title: 'Provider rejected the request',
                    detail: 'The generated result was blocked by the provider safety check.',
                    category: 'provider-moderation',
                    stage: 'poll',
                    generationRequestId: 'request-1',
                    generationRun: 0,
                    supportCode: 'support-2',
                    action: 'edit-request',
                },
            },
            createdAt: 5,
        }

        const result = applyMediaGenerationRequestEventToOperationNodes(state, event)

        expect(result.removedNodeIds).toEqual([])
        expect(result.updatedNodeIds).toEqual([output.nodeId])
        expect(result.state.nodes).toEqual([expect.objectContaining({
            nodeId: output.nodeId,
            type: 'operationStatus',
            status: 'failed',
            position: { x: 576, y: 404 },
            lineageAssignment: expect.objectContaining({ branchId: 'branch-1' }),
        })])
        expect(result.state.edges).toEqual([expect.objectContaining({
            sourceNodeId: 'source-1',
            targetNodeId: output.nodeId,
        })])
    })

    it('materializes a terminal failure immediately from a generic reasoning stream error', () => {
        const output = pendingOutputNode()
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [output],
            edges: [{
                edgeId: 'edge-source-output',
                sourceNodeId: 'source-1',
                targetNodeId: output.nodeId,
            }],
        }

        const result = applyMediaGenerationStreamFailureToOperationNodes(state, {
            generationRequestId: 'request-1',
            mediaRunId: 'media-run-1',
            outputNodeId: output.nodeId,
            message: 'The reasoning provider could not prepare this media request.',
            requestRevision: 4,
            updatedAt: 4,
        })

        expect(result.removedNodeIds).toEqual([])
        expect(result.state.nodes).toEqual([expect.objectContaining({
            nodeId: output.nodeId,
            type: 'operationStatus',
            status: 'failed',
            message: 'The reasoning provider could not prepare this media request.',
            requestRevision: 4,
            progress: expect.objectContaining({
                message: 'The reasoning provider could not prepare this media request.',
            }),
        })])
        expect(result.state.edges).toEqual([expect.objectContaining({
            sourceNodeId: 'source-1',
            targetNodeId: output.nodeId,
        })])
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
