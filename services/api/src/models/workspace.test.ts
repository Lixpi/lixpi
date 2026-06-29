'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import Workspace from './workspace.ts'
import type { ContentDescriptor, DocumentFile } from '@lixpi/constants'

const dynamo = {
    getItem: vi.fn(),
    updateItem: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
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
        dynamo.updateItem.mockResolvedValue(undefined)

        await expect(Workspace.patchCanvasNodeDescriptor({
            workspaceId: 'workspace-1',
            nodeId: 'node-b',
            descriptor,
        })).resolves.toBe(true)

        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState.#nodes[1].#descriptor = :descriptor, #updatedAt = :updatedAt',
            expressionAttributeValues: expect.objectContaining({
                ':descriptor': descriptor,
            }),
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

        expect(dynamo.updateItem).not.toHaveBeenCalled()
    })
})

// =============================================================================
// WORKSPACE CANVAS MUTATION
// =============================================================================

describe('Workspace.mutateCanvasState', () => {
    it('writes the mutator result with an updatedAt condition and updates workspace meta', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasState: {
                viewport: { x: 1, y: 2, zoom: 3 },
                nodes: [],
                edges: [],
            },
        })
        dynamo.updateItem.mockResolvedValue(undefined)

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
        expect(dynamo.updateItem).toHaveBeenCalledTimes(2)
        expect(dynamo.updateItem.mock.calls[0][0]).toEqual(expect.objectContaining({
            tableName: expect.stringContaining('Workspaces'),
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt',
            conditionExpression: '#updatedAt = :expectedUpdatedAt',
            expressionAttributeNames: {
                '#canvasState': 'canvasState',
                '#updatedAt': 'updatedAt',
            },
            expressionAttributeValues: expect.objectContaining({
                ':canvasState': expect.objectContaining({
                    viewport: { x: 1, y: 2, zoom: 3 },
                    nodes: [expect.objectContaining({ nodeId: 'node-1' })],
                    edges: [],
                }),
                ':expectedUpdatedAt': 10,
                ':updatedAt': expect.any(Number),
            }),
            origin: 'testCanvasMutation',
        }))
        expect(dynamo.updateItem.mock.calls[1][0]).toEqual(expect.objectContaining({
            tableName: expect.stringContaining('Workspaces-Meta'),
            key: { workspaceId: 'workspace-1' },
            updates: { updatedAt: expect.any(Number) },
            origin: 'testCanvasMutation:meta',
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
        expect(dynamo.updateItem).not.toHaveBeenCalled()
    })

    it('guards legacy workspace rows without updatedAt using attribute_not_exists', async () => {
        dynamo.getItem.mockResolvedValue({
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })
        dynamo.updateItem.mockResolvedValue(undefined)

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

        expect(dynamo.updateItem.mock.calls[0][0]).toEqual(expect.objectContaining({
            conditionExpression: 'attribute_not_exists(#updatedAt)',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('re-reads and retries when a concurrent canvas write wins the updatedAt condition', async () => {
        const conditionalFailure = Object.assign(new Error('stale canvas write'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.getItem
            .mockResolvedValueOnce({
                updatedAt: 10,
                canvasState: {
                    viewport: { x: 0, y: 0, zoom: 1 },
                    nodes: [],
                    edges: [],
                },
            })
            .mockResolvedValueOnce({
                updatedAt: 11,
                canvasState: {
                    viewport: { x: 0, y: 0, zoom: 1 },
                    nodes: [{ nodeId: 'concurrent-node', type: 'branchOrigin' }],
                    edges: [],
                },
            })
        dynamo.updateItem
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce(undefined)
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
        expect(dynamo.updateItem).toHaveBeenCalledTimes(3)
        expect(dynamo.updateItem.mock.calls[0][0].expressionAttributeValues[':expectedUpdatedAt']).toBe(10)
        expect(dynamo.updateItem.mock.calls[1][0].expressionAttributeValues[':expectedUpdatedAt']).toBe(11)
        expect(dynamo.updateItem.mock.calls[1][0].expressionAttributeValues[':canvasState'].nodes).toEqual([
            expect.objectContaining({ nodeId: 'concurrent-node' }),
            expect.objectContaining({ nodeId: 'projection-node' }),
        ])
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
            updateExpression: 'SET #files = list_append(if_not_exists(#files, :empty), :newFiles), #updatedAt = :now',
            expressionAttributeNames: {
                '#files': 'files',
                '#updatedAt': 'updatedAt',
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
            updateExpression: 'SET #updatedAt = :now REMOVE #files[1]',
            conditionExpression: '#files[1].#id = :fileId',
            expressionAttributeNames: {
                '#files': 'files',
                '#id': 'id',
                '#updatedAt': 'updatedAt',
            },
            expressionAttributeValues: {
                ':fileId': 'file-1',
                ':now': expect.any(Number),
            },
        }))
        expect(dynamo.updateItem.mock.calls[0][0].updates).toBeUndefined()
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
        expect(dynamo.updateItem.mock.calls[0][0].updateExpression).toBe('SET #updatedAt = :now REMOVE #files[1]')
        expect(dynamo.updateItem.mock.calls[1][0].updateExpression).toBe('SET #updatedAt = :now REMOVE #files[0]')
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
