'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import Workspace from './workspace.ts'
import type { ContentDescriptor } from '@lixpi/constants'

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
