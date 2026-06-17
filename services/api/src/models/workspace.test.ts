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
