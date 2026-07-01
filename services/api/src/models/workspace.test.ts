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
            updateExpression: 'SET #canvasState.#nodes[1].#descriptor = :descriptor, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '#canvasState.#nodes[1].#nodeId = :nodeId',
            expressionAttributeValues: expect.objectContaining({
                ':descriptor': descriptor,
                ':nodeId': 'node-b',
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

    it('uses legacy updatedAt as the canvas save token when canvasStateUpdatedAt is missing', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
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
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt))',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('re-reads and retries when a concurrent canvas write wins the canvasStateUpdatedAt condition', async () => {
        const conditionalFailure = Object.assign(new Error('stale canvas write'), {
            name: 'ConditionalCheckFailedException',
        })
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
        expect(dynamo.updateItem.mock.calls[0][0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(5)
        expect(dynamo.updateItem.mock.calls[1][0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(6)
        expect(dynamo.updateItem.mock.calls[1][0].expressionAttributeValues[':canvasState'].nodes).toEqual([
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
        dynamo.updateItem.mockResolvedValue(undefined)

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
        expect(dynamo.updateItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
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
            origin: 'updateWorkspaceCanvasState',
        }))
        expect(dynamo.updateItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            tableName: expect.stringContaining('Workspaces-Meta'),
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('rejects stale full canvas saves instead of overwriting newer canonical state', async () => {
        const conditionalFailure = Object.assign(new Error('stale canvas write'), {
            name: 'ConditionalCheckFailedException',
        })
        dynamo.updateItem.mockRejectedValueOnce(conditionalFailure)
        dynamo.getItem.mockResolvedValueOnce({ updatedAt: 22, canvasStateUpdatedAt: 18 })

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
        expect(dynamo.updateItem).toHaveBeenCalledTimes(1)
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            origin: 'updateWorkspaceCanvasState:stale(workspace-1)',
        }))
    })

    it('allows tokenless full canvas saves only for rows without any canvas token', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            canvasState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                nodes: [],
                edges: [],
            },
        })

        expect(dynamo.updateItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt))',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
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

            if (params.origin === 'updateWorkspaceCanvasState' && params.updateExpression) {
                const expectedCanvasStateUpdatedAt = params.expressionAttributeValues[':expectedCanvasStateUpdatedAt']
                const canvasTokenMatches = workspaceItem.canvasStateUpdatedAt === expectedCanvasStateUpdatedAt
                const legacyTokenMatches = workspaceItem.canvasStateUpdatedAt === undefined && workspaceItem.updatedAt === expectedCanvasStateUpdatedAt

                if (!canvasTokenMatches && !legacyTokenMatches) {
                    throw Object.assign(new Error('stale canvas write'), {
                        name: 'ConditionalCheckFailedException',
                    })
                }

                workspaceItem.canvasState = params.expressionAttributeValues[':canvasState']
                workspaceItem.canvasStateUpdatedAt = params.expressionAttributeValues[':canvasStateUpdatedAt']
                workspaceItem.updatedAt = params.expressionAttributeValues[':updatedAt']
                return undefined
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
        expect(dynamo.getItem).not.toHaveBeenCalled()
        expect(workspaceItem.canvasState).toEqual(expect.objectContaining({
            nodes: [expect.objectContaining({ fileId: 'uploaded-file' })],
        }))
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
