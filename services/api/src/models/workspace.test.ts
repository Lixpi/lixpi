'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import Workspace from './workspace.ts'
import type { ContentDescriptor, DocumentFile } from '@lixpi/constants'

const dynamo = {
    getItem: vi.fn(),
    updateItem: vi.fn(),
    transactWrite: vi.fn(),
}

// Transactions surface a failed per-item condition as a cancelled transaction,
// not as ConditionalCheckFailedException.
const transactionalConditionalFailure = (message: string) => Object.assign(new Error(message), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
})

beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
})

describe('Workspace.getWorkspace', () => {
    it('normalizes missing workspaces into NOT_FOUND', async () => {
        dynamo.getItem.mockResolvedValueOnce(undefined)

        await expect(Workspace.getWorkspace({ workspaceId: 'workspace-1', userId: 'user-1' })).resolves.toEqual(
            { error: 'NOT_FOUND' },
        )
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
        }))
    })

    it('returns PERMISSION_DENIED when the requesting user lacks access', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            accessList: [{ userId: 'other-user' }],
            canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
        })

        await expect(Workspace.getWorkspace({ workspaceId: 'workspace-1', userId: 'user-1' })).resolves.toEqual(
            { error: 'PERMISSION_DENIED' },
        )
    })

    it('falls back to updatedAt as canvasStateUpdatedAt and keeps an empty edges array', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            accessList: [{ userId: 'user-1' }],
            updatedAt: 10,
            canvasState: { viewport: { x: 1, y: 2, zoom: 1 }, nodes: [{ nodeId: 'n-1', type: 'image' }] },
        })

        const result = await Workspace.getWorkspace({ workspaceId: 'workspace-1', userId: 'user-1' })

        expect(result).toMatchObject({
            workspaceId: 'workspace-1',
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 1, y: 2, zoom: 1 },
                nodes: [{ nodeId: 'n-1', type: 'image' }],
                edges: [],
            },
        })
    })
})

describe('Workspace.patchCanvasNodeDescriptor', () => {
    it('patches only the matched canvas node descriptor path', async () => {
        const descriptor: ContentDescriptor = {
            status: 'ready',
            summary: 'A goat portrait.',
            entityTags: ['goat'],
            styleTags: ['portrait'],
            source: 'analysis',
            version: 'media-descriptor-v1',
            updatedAt: 10,
        }
        dynamo.getItem.mockResolvedValue({
            canvasState: {
                nodes: [
                    { nodeId: 'node-a', type: 'image' },
                    { nodeId: 'node-b', type: 'document' },
                ],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await expect(Workspace.patchCanvasNodeDescriptor({
            workspaceId: 'workspace-1',
            nodeId: 'node-b',
            descriptor,
        })).resolves.toBe(true)

        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState.#nodes[1].#descriptor = :descriptor, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '#canvasState.#nodes[1].#nodeId = :nodeId',
            expressionAttributeValues: expect.objectContaining({
                ':descriptor': descriptor,
                ':nodeId': 'node-b',
            }),
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('returns false when the node is not in the workspace canvas', async () => {
        dynamo.getItem.mockResolvedValue({
            canvasState: {
                nodes: [{ nodeId: 'node-a', type: 'image' }],
            },
        })

        await expect(Workspace.patchCanvasNodeDescriptor({
            workspaceId: 'workspace-1',
            nodeId: 'missing-node',
            descriptor: {
                status: 'ready',
                summary: 'unused',
                entityTags: [],
                styleTags: [],
                source: 'analysis',
                version: 'media-descriptor-v1',
                updatedAt: 1,
            },
        })).resolves.toBe(false)

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })
})

// =============================================================================
// WORKSPACE CANVAS MUTATION
// =============================================================================

describe('Workspace.mutateCanvasState', () => {
    it('writes the mutator result with a canvasStateUpdatedAt condition and updates workspace meta', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasStateUpdatedAt: 7,
            canvasState: {
                viewport: { x: 1, y: 2, zoom: 3 },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            origin: 'testCanvasMutation',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    nodes: [{ nodeId: 'node-1', type: 'branchOrigin' } as any],
                },
            }),
        })

        expect(changed).toBe(true)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const { operations, origin } = dynamo.transactWrite.mock.calls[0][0]
        expect(origin).toBe('testCanvasMutation')
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces'),
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt))',
            expressionAttributeNames: {
                '#canvasState': 'canvasState',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
            },
            expressionAttributeValues: expect.objectContaining({
                ':canvasState': expect.objectContaining({
                    viewport: { x: 1, y: 2, zoom: 3 },
                    nodes: [expect.objectContaining({ nodeId: 'node-1' })],
                    edges: [],
                }),
                ':expectedCanvasStateUpdatedAt': 7,
                ':updatedAt': expect.any(Number),
                ':canvasStateUpdatedAt': expect.any(Number),
            }),
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            key: { workspaceId: 'workspace-1' },
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('does not write when the mutator reports no canvas change', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({ changed: false, canvasState }),
        })

        expect(changed).toBe(false)
        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('uses legacy updatedAt as the canvas save token when canvasStateUpdatedAt is missing', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    edges: [{ edgeId: 'edge-1', sourceNodeId: 'a', targetNodeId: 'b' }],
                },
            }),
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt))',
            expressionAttributeValues: expect.objectContaining({
                ':expectedCanvasStateUpdatedAt': 10,
            }),
        }))
    })

    it('guards rows without any canvas token using attribute_not_exists', async () => {
        dynamo.getItem.mockResolvedValue({
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    edges: [{ edgeId: 'edge-1', sourceNodeId: 'a', targetNodeId: 'b' }],
                },
            }),
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt))',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('re-reads and retries when a concurrent canvas write wins the canvasStateUpdatedAt condition', async () => {
        const conditionalFailure = transactionalConditionalFailure('stale canvas write')
        dynamo.getItem
            .mockResolvedValueOnce({
                updatedAt: 10,
                canvasStateUpdatedAt: 5,
                canvasState: {
                    viewport: { x: 0, y: 0, zoom: 1 },
                    nodes: [],
                    edges: [],
                },
            })
            .mockResolvedValueOnce({
                updatedAt: 11,
                canvasStateUpdatedAt: 6,
                canvasState: {
                    viewport: { x: 0, y: 0, zoom: 1 },
                    nodes: [{ nodeId: 'concurrent-node', type: 'branchOrigin' }],
                    edges: [],
                },
            })
        dynamo.transactWrite
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce(undefined)

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            origin: 'testCanvasMutation',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    nodes: [
                        ...canvasState.nodes,
                        { nodeId: 'projection-node', type: 'branchFork' } as any,
                    ],
                },
            }),
        })

        expect(changed).toBe(true)
        expect(dynamo.getItem).toHaveBeenCalledTimes(2)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(2)
        expect(dynamo.transactWrite.mock.calls[0][0].operations[0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(5)
        expect(dynamo.transactWrite.mock.calls[1][0].operations[0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(6)
        expect(dynamo.transactWrite.mock.calls[1][0].operations[0].expressionAttributeValues[':canvasState'].nodes).toEqual([
            expect.objectContaining({ nodeId: 'concurrent-node' }),
            expect.objectContaining({ nodeId: 'projection-node' }),
        ])
    })
})

// =============================================================================
// FULL WORKSPACE CANVAS SAVES
// =============================================================================

describe('Workspace.updateCanvasState', () => {
    it('writes full canvas state with a canvasStateUpdatedAt condition when the client supplies a save token', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 1, y: 2, zoom: 1 },
                nodes: [{ nodeId: 'node-1', type: 'image', fileId: 'file-1' } as any],
                edges: [],
            },
        })

        expect(result).toEqual({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: expect.any(Number),
            canvasStateUpdatedAt: expect.any(Number),
        })
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const { operations, origin } = dynamo.transactWrite.mock.calls[0][0]
        expect(origin).toBe('updateWorkspaceCanvasState')
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt))',
            expressionAttributeNames: {
                '#canvasState': 'canvasState',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
            },
            expressionAttributeValues: expect.objectContaining({
                ':expectedCanvasStateUpdatedAt': 10,
                ':canvasState': expect.objectContaining({
                    nodes: [expect.objectContaining({ nodeId: 'node-1' })],
                }),
                ':canvasStateUpdatedAt': expect.any(Number),
            }),
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('rejects stale full canvas saves instead of overwriting newer canonical state', async () => {
        const conditionalFailure = transactionalConditionalFailure('stale canvas write')
        dynamo.transactWrite.mockRejectedValueOnce(conditionalFailure)
        dynamo.getItem
            .mockResolvedValueOnce({
                updatedAt: 12,
                canvasStateUpdatedAt: 12,
                canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
            })
            .mockResolvedValueOnce({ updatedAt: 22, canvasStateUpdatedAt: 18 })

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })

        expect(result).toEqual({
            success: false,
            workspaceId: 'workspace-1',
            error: 'STALE_CANVAS_STATE',
            currentUpdatedAt: 22,
            currentCanvasStateUpdatedAt: 18,
        })
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            origin: 'updateWorkspaceCanvasState:stale(workspace-1)',
        }))
    })

    it('allows tokenless full canvas saves only for rows without any canvas token', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt))',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('keeps canonical API lineage when a browser save contains a stale generated node for the same media run', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [
                    {
                        nodeId: 'fork-1',
                        type: 'branchFork',
                        branchId: 'branch-1',
                        generationRequestId: 'request-1',
                        reasoningRunId: 'reasoning-1',
                        reasoningModelId: 'Provider:reasoning',
                        reasoningIndex: 0,
                        position: { x: 100, y: 100 },
                        dimensions: { width: 375, height: 68 },
                        temporary: true,
                    },
                    {
                        nodeId: 'node-final-file',
                        type: 'image',
                        fileId: 'final-file',
                        workspaceId: 'workspace-1',
                        src: '/api/images/workspace-1/final-file',
                        aspectRatio: 1,
                        position: { x: 500, y: 100 },
                        dimensions: { width: 800, height: 600 },
                        generatedBy: {
                            aiChatThreadId: 'thread-1',
                            responseId: 'response-1',
                            aiModel: 'Provider:reasoning',
                            revisedPrompt: 'prompt',
                            responseMessageId: '',
                            generationRequestId: 'request-1',
                            reasoningRunId: 'reasoning-1',
                            mediaRunId: 'run-1',
                            mediaModelId: 'Provider:image',
                            branchId: 'branch-1',
                            branchForkNodeId: 'fork-1',
                            createdAt: 999_000,
                        },
                    },
                ],
                edges: [{
                    edgeId: 'edge-fork-1-node-final-file',
                    sourceNodeId: 'fork-1',
                    targetNodeId: 'node-final-file',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                }],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 1, y: 2, zoom: 1 },
                nodes: [
                    { nodeId: 'user-node', type: 'image', fileId: 'user-file' } as any,
                    {
                        nodeId: 'node-partial-file',
                        type: 'image',
                        fileId: 'partial-file',
                        workspaceId: 'workspace-1',
                        src: '/api/images/workspace-1/partial-file',
                        aspectRatio: 1,
                        position: { x: 700, y: 200 },
                        dimensions: { width: 800, height: 600 },
                        generatedBy: {
                            aiChatThreadId: 'thread-1',
                            responseId: '',
                            aiModel: 'Provider:reasoning',
                            revisedPrompt: 'prompt',
                            responseMessageId: '',
                            generationRequestId: 'request-1',
                            reasoningRunId: 'reasoning-1',
                            mediaRunId: 'run-1',
                            mediaModelId: 'Provider:image',
                            branchId: 'branch-1',
                            branchForkNodeId: 'fork-1',
                            createdAt: 999_000,
                        },
                    },
                ],
                edges: [{
                    edgeId: 'edge-fork-1-node-partial-file',
                    sourceNodeId: 'fork-1',
                    targetNodeId: 'node-partial-file',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                }],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'user-node' }),
            expect.objectContaining({ nodeId: 'fork-1' }),
            expect.objectContaining({ nodeId: 'node-final-file', fileId: 'final-file' }),
        ]))
        expect(writtenState.nodes).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'node-partial-file' }),
        ]))
        expect(writtenState.edges).toEqual([
            expect.objectContaining({ edgeId: 'edge-fork-1-node-final-file' }),
        ])
    })

    it('does not resurrect old API generated nodes omitted by a later browser save', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(3_600_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [
                    {
                        nodeId: 'fork-1',
                        type: 'branchFork',
                        branchId: 'branch-1',
                        generationRequestId: 'request-1',
                        reasoningRunId: 'reasoning-1',
                        reasoningModelId: 'Provider:reasoning',
                        reasoningIndex: 0,
                        position: { x: 100, y: 100 },
                        dimensions: { width: 375, height: 68 },
                        temporary: true,
                    },
                    {
                        nodeId: 'node-old-file',
                        type: 'image',
                        fileId: 'old-file',
                        workspaceId: 'workspace-1',
                        src: '/api/images/workspace-1/old-file',
                        aspectRatio: 1,
                        position: { x: 500, y: 100 },
                        dimensions: { width: 800, height: 600 },
                        generatedBy: {
                            aiChatThreadId: 'thread-1',
                            responseId: 'response-1',
                            aiModel: 'Provider:reasoning',
                            revisedPrompt: 'prompt',
                            responseMessageId: '',
                            generationRequestId: 'request-1',
                            reasoningRunId: 'reasoning-1',
                            mediaRunId: 'run-1',
                            mediaModelId: 'Provider:image',
                            branchId: 'branch-1',
                            branchForkNodeId: 'fork-1',
                            createdAt: 0,
                        },
                    },
                ],
                edges: [{
                    edgeId: 'edge-fork-1-node-old-file',
                    sourceNodeId: 'fork-1',
                    targetNodeId: 'node-old-file',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                }],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{ nodeId: 'user-node', type: 'image', fileId: 'user-file' } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([
            expect.objectContaining({ nodeId: 'user-node' }),
        ])
        expect(writtenState.edges).toEqual([])
    })

    it('does not preserve abandoned marker-only API lineage across full browser saves', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'fork-unreferenced',
                    type: 'branchFork',
                    branchId: 'branch-1',
                    generationRequestId: 'request-1',
                    reasoningRunId: 'reasoning-1',
                    reasoningModelId: 'Provider:reasoning',
                    reasoningIndex: 0,
                    position: { x: 100, y: 100 },
                    dimensions: { width: 375, height: 68 },
                    temporary: true,
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{ nodeId: 'user-node', type: 'image', fileId: 'user-file' } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([
            expect.objectContaining({ nodeId: 'user-node' }),
        ])
        expect(writtenState.edges).toEqual([])
    })

    it('accepts a full canvas save after file upload changes only workspace updatedAt', async () => {
        const workspaceItem: {
            updatedAt: number
            canvasStateUpdatedAt?: number
            canvasState?: unknown
            files: DocumentFile[]
        } = {
            updatedAt: 10,
            files: [],
        }

        dynamo.updateItem.mockImplementation(async (params: any) => {
            if (params.origin === 'model::Workspace->addFile()') {
                workspaceItem.canvasStateUpdatedAt ??= workspaceItem.updatedAt
                workspaceItem.files = [...workspaceItem.files, ...params.expressionAttributeValues[':newFiles']]
                workspaceItem.updatedAt = params.expressionAttributeValues[':now']
                return undefined
            }

            return undefined
        })

        dynamo.transactWrite.mockImplementation(async ({ operations, origin }: any) => {
            const canvasOperation = operations[0]
            if (origin === 'updateWorkspaceCanvasState' && canvasOperation?.updateExpression) {
                const expectedCanvasStateUpdatedAt = canvasOperation.expressionAttributeValues[':expectedCanvasStateUpdatedAt']
                const canvasTokenMatches = workspaceItem.canvasStateUpdatedAt === expectedCanvasStateUpdatedAt
                const legacyTokenMatches = workspaceItem.canvasStateUpdatedAt === undefined && workspaceItem.updatedAt === expectedCanvasStateUpdatedAt

                if (!canvasTokenMatches && !legacyTokenMatches) {
                    throw transactionalConditionalFailure('stale canvas write')
                }

                workspaceItem.canvasState = canvasOperation.expressionAttributeValues[':canvasState']
                workspaceItem.canvasStateUpdatedAt = canvasOperation.expressionAttributeValues[':canvasStateUpdatedAt']
                workspaceItem.updatedAt = canvasOperation.expressionAttributeValues[':updatedAt']
            }

            return undefined
        })

        await Workspace.addFile({
            workspaceId: 'workspace-1',
            file: {
                id: 'uploaded-file',
                name: 'upload.png',
                mimeType: 'image/png',
                size: 100,
            },
        })

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{ nodeId: 'upload-node', type: 'image', fileId: 'uploaded-file' } as any],
                edges: [],
            },
        })

        expect(result).toEqual({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: expect.any(Number),
            canvasStateUpdatedAt: expect.any(Number),
        })
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            origin: 'updateWorkspaceCanvasState:get',
        }))
        expect(workspaceItem.canvasState).toEqual(expect.objectContaining({
            nodes: [expect.objectContaining({ fileId: 'uploaded-file' })],
        }))
    })

    // =========================================================================
    // MEDIA REPLACEMENT MARKER MERGE
    // =========================================================================

    const baseGeneratedBy = {
        aiChatThreadId: 'thread-1',
        responseId: 'response-1',
        aiModel: 'Provider:reasoning',
        revisedPrompt: 'prompt',
        responseMessageId: '',
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        mediaRunId: 'run-1',
        mediaModelId: 'Provider:image',
        branchId: 'branch-1',
        branchForkNodeId: 'fork-1',
        createdAt: 999_000,
    }

    it('applies an incoming image media replacement when the previous fileId matches the canonical node', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'old-file',
                    workspaceId: 'workspace-1',
                    src: '/api/images/workspace-1/old-file',
                    aspectRatio: 1,
                    descriptor: { status: 'ready' },
                    position: { x: 500, y: 100 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: baseGeneratedBy,
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'new-file',
                    workspaceId: 'workspace-1',
                    src: '/api/images/workspace-1/new-file',
                    aspectRatio: 2,
                    descriptor: { status: 'analyzing' },
                    mediaReplacement: { replacedAt: 1_000_000, previousFileId: 'old-file' },
                    generatedBy: baseGeneratedBy,
                } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([expect.objectContaining({
            nodeId: 'node-image-1',
            fileId: 'new-file',
            workspaceId: 'workspace-1',
            src: '/api/images/workspace-1/new-file',
            aspectRatio: 2,
            descriptor: { status: 'analyzing' },
            position: { x: 500, y: 100 },
            dimensions: { width: 800, height: 600 },
        })])
        expect(writtenState.nodes[0]).not.toHaveProperty('mediaReplacement')
    })

    it('applies an incoming video media replacement, including poster fields, when the previous fileId matches', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-video-1',
                    type: 'video',
                    fileId: 'old-video-file',
                    posterFileId: 'old-poster-file',
                    posterSrc: '/api/images/workspace-1/old-poster-file',
                    frameFileId: 'old-frame-file',
                    durationSeconds: 4,
                    hasAudio: false,
                    workspaceId: 'workspace-1',
                    src: '/api/videos/workspace-1/old-video-file',
                    aspectRatio: 1,
                    position: { x: 500, y: 100 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: baseGeneratedBy,
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-video-1',
                    type: 'video',
                    fileId: 'new-video-file',
                    posterFileId: 'new-poster-file',
                    posterSrc: '/api/images/workspace-1/new-poster-file',
                    frameFileId: 'new-frame-file',
                    durationSeconds: 8,
                    hasAudio: true,
                    workspaceId: 'workspace-1',
                    src: '/api/videos/workspace-1/new-video-file',
                    aspectRatio: 2,
                    mediaReplacement: { replacedAt: 1_000_000, previousFileId: 'old-video-file', previousPosterFileId: 'old-poster-file' },
                    generatedBy: baseGeneratedBy,
                } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([expect.objectContaining({
            nodeId: 'node-video-1',
            fileId: 'new-video-file',
            posterFileId: 'new-poster-file',
            posterSrc: '/api/images/workspace-1/new-poster-file',
            frameFileId: 'new-frame-file',
            durationSeconds: 8,
            hasAudio: true,
            aspectRatio: 2,
        })])
        expect(writtenState.nodes[0]).not.toHaveProperty('mediaReplacement')
    })

    it('ignores a media replacement marker when previousFileId does not match the canonical fileId', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'canonical-file',
                    workspaceId: 'workspace-1',
                    src: '/api/images/workspace-1/canonical-file',
                    aspectRatio: 1,
                    position: { x: 500, y: 100 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: baseGeneratedBy,
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'unrelated-new-file',
                    mediaReplacement: { replacedAt: 1_000_000, previousFileId: 'some-other-stale-file' },
                    generatedBy: baseGeneratedBy,
                } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([expect.objectContaining({
            nodeId: 'node-image-1',
            fileId: 'canonical-file',
            src: '/api/images/workspace-1/canonical-file',
        })])
        expect(writtenState.nodes[0]).not.toHaveProperty('mediaReplacement')
    })

    it('strips a stale mediaReplacement marker even when the fileId is unchanged', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'same-file',
                    workspaceId: 'workspace-1',
                    src: '/api/images/workspace-1/same-file',
                    aspectRatio: 1,
                    position: { x: 500, y: 100 },
                    dimensions: { width: 800, height: 600 },
                    generatedBy: baseGeneratedBy,
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [{
                    nodeId: 'node-image-1',
                    type: 'image',
                    fileId: 'same-file',
                    mediaReplacement: { replacedAt: 1_000_000, previousFileId: 'same-file' },
                    generatedBy: baseGeneratedBy,
                } as any],
                edges: [],
            },
        })

        const writtenState = dynamo.transactWrite.mock.calls[0]?.[0].operations[0].expressionAttributeValues[':canvasState']
        expect(writtenState.nodes).toEqual([expect.objectContaining({
            nodeId: 'node-image-1',
            fileId: 'same-file',
        })])
        expect(writtenState.nodes[0]).not.toHaveProperty('mediaReplacement')
    })
})

// =============================================================================
// CANVAS MEDIA REFERENCES
// =============================================================================

describe('Workspace canvas media references', () => {
    it('collects every Object Store file id still referenced by canonical canvas state', () => {
        const fileIds = Workspace.getCanvasStateReferencedFileIds({
            viewport: { x: 0, y: 0, zoom: 1 },
            edges: [],
            nodes: [
                { nodeId: 'image-node', type: 'image', fileId: 'image-file' },
                { nodeId: 'video-node', type: 'video', fileId: 'video-file', posterFileId: 'poster-file', frameFileId: 'frame-file' },
                { nodeId: 'audio-node', type: 'audio', fileId: 'audio-file' },
                { nodeId: 'doc-media-node', type: 'mediaDocument', fileId: 'document-file', posterFileId: 'document-poster-file' },
                { nodeId: 'text-node', type: 'document', referenceId: 'doc-1' },
            ] as any,
        })

        expect([...fileIds].sort()).toEqual([
            'audio-file',
            'document-file',
            'document-poster-file',
            'frame-file',
            'image-file',
            'poster-file',
            'video-file',
        ])
    })

    it('checks current canonical canvas state before allowing a storage delete', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                edges: [],
                nodes: [{ nodeId: 'node-1', type: 'image', fileId: 'file-1' }],
            },
        })

        await expect(Workspace.isFileReferencedByCanvasState({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })).resolves.toBe(true)

        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            origin: 'model::Workspace->isFileReferencedByCanvasState(workspace-1:file-1)',
        }))
    })

    it('treats a canonical derivative reference as a reference to the original file record', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            files: [
                { id: 'original-file', canonicalFileId: 'original-file-canonical' },
            ],
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                edges: [],
                nodes: [{ nodeId: 'node-1', type: 'image', fileId: 'original-file-canonical' }],
            },
        })

        await expect(Workspace.isFileReferencedByCanvasState({
            workspaceId: 'workspace-1',
            fileId: 'original-file',
        })).resolves.toBe(true)
    })
})

// =============================================================================
// WORKSPACE FILE LIST STORAGE
// =============================================================================

describe('Workspace file list storage', () => {
    const file: DocumentFile = {
        id: 'file-1',
        name: 'image.png',
        mimeType: 'image/png',
        size: 100,
    }

    it('adds files with DynamoDB list_append instead of a read-modify-write overwrite', async () => {
        await Workspace.addFile({
            workspaceId: 'workspace-1',
            file,
        })

        expect(dynamo.getItem).not.toHaveBeenCalled()
        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, #updatedAt), #files = list_append(if_not_exists(#files, :empty), :newFiles), #updatedAt = :now',
            expressionAttributeNames: {
                '#files': 'files',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
            },
            expressionAttributeValues: {
                ':empty': [],
                ':newFiles': [file],
                ':now': expect.any(Number),
            },
        }))
    })

    it('removes a file by guarded list index instead of rewriting the whole files array', async () => {
        dynamo.getItem.mockResolvedValue({
            files: [
                { id: 'keep-1' },
                { id: 'file-1' },
                { id: 'keep-2' },
            ],
        })
        dynamo.updateItem.mockResolvedValue(undefined)

        await Workspace.removeFile({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[1]',
            conditionExpression: '#files[1].#id = :fileId',
            expressionAttributeNames: {
                '#files': 'files',
                '#id': 'id',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
            },
            expressionAttributeValues: {
                ':fileId': 'file-1',
                ':now': expect.any(Number),
                ':previousUpdatedAt': expect.any(Number),
            },
        }))
        expect(dynamo.updateItem.mock.calls[0][0].updates).toBeUndefined()
    })

    it('removes the original file record when deletion is requested by canonical file id', async () => {
        dynamo.getItem.mockResolvedValue({
            files: [
                { id: 'keep-1' },
                { id: 'original-file', canonicalFileId: 'original-file-canonical' },
            ],
        })
        dynamo.updateItem.mockResolvedValue(undefined)

        await Workspace.removeFile({
            workspaceId: 'workspace-1',
            fileId: 'original-file-canonical',
        })

        const call = dynamo.updateItem.mock.calls[0]?.[0]
        expect(call).toBeDefined()
        expect(call).toEqual(expect.objectContaining({
            tableName: expect.stringContaining('Workspaces'),
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[1]',
            conditionExpression: '#files[1].#canonicalFileId = :fileId',
            expressionAttributeNames: {
                '#files': 'files',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                '#canonicalFileId': 'canonicalFileId',
            },
            expressionAttributeValues: {
                ':fileId': 'original-file-canonical',
                ':now': expect.any(Number),
                ':previousUpdatedAt': expect.any(Number),
            },
            origin: 'model::Workspace->removeFile()',
        }))
    })

    it('sets canonical pointer fields on the original file record when transcode finishes', async () => {
        dynamo.getItem.mockResolvedValue({
            files: [
                { id: 'original-file', canonicalFileId: 'old-canonical', canonicalMimeType: 'video/mp4' },
            ],
        })
        dynamo.updateItem.mockResolvedValue(undefined)

        await Workspace.setFileCanonical({
            workspaceId: 'workspace-1',
            fileId: 'original-file',
            canonicalFileId: 'new-canonical',
            canonicalMimeType: 'video/quicktime',
        })

        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now, #files[0].#canonicalFileId = :canonicalFileId, #files[0].#canonicalMimeType = :canonicalMimeType',
            conditionExpression: '#files[0].#id = :fileId',
            expressionAttributeNames: {
                '#files': 'files',
                '#id': 'id',
                '#canonicalFileId': 'canonicalFileId',
                '#canonicalMimeType': 'canonicalMimeType',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
            },
            expressionAttributeValues: {
                ':fileId': 'original-file',
                ':canonicalFileId': 'new-canonical',
                ':canonicalMimeType': 'video/quicktime',
                ':now': expect.any(Number),
                ':previousUpdatedAt': expect.any(Number),
            },
        }))
    })

    it('retries setFileCanonical when a concurrent index move is detected', async () => {
        const conditionalFailure = Object.assign(new Error('index changed'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.getItem
            .mockResolvedValueOnce({
                files: [
                    { id: 'file-1' },
                ],
                updatedAt: 10,
            })
            .mockResolvedValueOnce({
                files: [
                    { id: 'file-1' },
                ],
                updatedAt: 11,
            })
        dynamo.updateItem
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce(undefined)

        await Workspace.setFileCanonical({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
            canonicalFileId: 'canonical-1',
            canonicalMimeType: 'image/png',
        })

        expect(dynamo.getItem).toHaveBeenCalledTimes(2)
        expect(dynamo.updateItem).toHaveBeenCalledTimes(2)
    })

    it('throws a deterministic error when setFileCanonical retries are exhausted by concurrent updates', async () => {
        const conditionalFailure = Object.assign(new Error('index changed'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.getItem.mockResolvedValue({
            files: [{ id: 'file-1' }],
            updatedAt: 10,
        })
        dynamo.updateItem.mockRejectedValue(conditionalFailure)

        await expect(
            Workspace.setFileCanonical({
                workspaceId: 'workspace-1',
                fileId: 'file-1',
                canonicalFileId: 'canonical-1',
                canonicalMimeType: 'video/mp4',
            }),
        ).rejects.toThrow('Failed to set file canonical after concurrent updates: workspace-1/file-1')

        expect(dynamo.getItem).toHaveBeenCalledTimes(5)
        expect(dynamo.updateItem).toHaveBeenCalledTimes(5)
    })

    it('does not patch canonical fields when source file id is missing', async () => {
        dynamo.getItem.mockResolvedValue({
            files: [{ id: 'keep-1' }],
        })

        await Workspace.setFileCanonical({
            workspaceId: 'workspace-1',
            fileId: 'missing-file',
            canonicalFileId: 'canonical-missing',
            canonicalMimeType: 'image/png',
        })

        expect(dynamo.updateItem).not.toHaveBeenCalled()
    })

    it('re-reads and retries when another writer shifts the file index', async () => {
        const conditionalFailure = Object.assign(new Error('index changed'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.getItem
            .mockResolvedValueOnce({
                files: [
                    { id: 'keep-1' },
                    { id: 'file-1' },
                ],
            })
            .mockResolvedValueOnce({
                files: [
                    { id: 'file-1' },
                ],
            })
        dynamo.updateItem
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce(undefined)

        await Workspace.removeFile({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(dynamo.getItem).toHaveBeenCalledTimes(2)
        expect(dynamo.updateItem.mock.calls[0][0].updateExpression).toBe('SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[1]')
        expect(dynamo.updateItem.mock.calls[1][0].updateExpression).toBe('SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[0]')
    })

    it('throws a deterministic error when removeFile retries are exhausted by concurrent updates', async () => {
        const conditionalFailure = Object.assign(new Error('index changed'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.getItem.mockResolvedValue({
            files: [{ id: 'file-1' }],
            updatedAt: 10,
        })
        dynamo.updateItem.mockRejectedValue(conditionalFailure)

        await expect(
            Workspace.removeFile({
                workspaceId: 'workspace-1',
                fileId: 'file-1',
            }),
        ).rejects.toThrow('Failed to remove file from workspace after concurrent updates: workspace-1/file-1')

        expect(dynamo.getItem).toHaveBeenCalledTimes(5)
        expect(dynamo.updateItem).toHaveBeenCalledTimes(5)
    })

    it('does not write when the file is already absent', async () => {
        dynamo.getItem.mockResolvedValue({
            files: [{ id: 'keep-1' }],
        })

        await Workspace.removeFile({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(dynamo.updateItem).not.toHaveBeenCalled()
    })
})
