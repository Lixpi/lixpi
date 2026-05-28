'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import AiChatThread from './ai-chat-thread.ts'

// The model references a global `dynamoDBService` (set on the server at boot).
const dynamo = {
    putItem: vi.fn(),
    queryItems: vi.fn(),
    deleteItems: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
})

// =============================================================================
// createAiChatThread — ownership + title metadata
// =============================================================================

describe('AiChatThread.createAiChatThread', () => {
    it('persists owner and title when provided and marks the thread active', async () => {
        dynamo.putItem.mockResolvedValue(undefined)

        const thread = await AiChatThread.createAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            content: {},
            aiModel: 'openai:test',
            title: 'AI Chat',
            owner: { type: 'contextRegion', contextRegionNodeId: 'node-1' },
        })

        expect(thread).toMatchObject({
            threadId: 'thread-1',
            status: 'active',
            title: 'AI Chat',
            owner: { type: 'contextRegion', contextRegionNodeId: 'node-1' },
        })
        expect(dynamo.putItem).toHaveBeenCalledWith(expect.objectContaining({
            item: expect.objectContaining({ owner: { type: 'contextRegion', contextRegionNodeId: 'node-1' }, title: 'AI Chat' }),
        }))
    })

    it('omits owner and title keys entirely when not provided', async () => {
        dynamo.putItem.mockResolvedValue(undefined)

        const thread = await AiChatThread.createAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-2',
            content: {},
            aiModel: 'openai:test',
        })

        expect(thread).toBeDefined()
        expect(Object.hasOwn(thread as object, 'owner')).toBe(false)
        expect(Object.hasOwn(thread as object, 'title')).toBe(false)
    })
})

// =============================================================================
// deleteWorkspaceAiChatThreads — workspace cleanup loop
// =============================================================================

describe('AiChatThread.deleteWorkspaceAiChatThreads', () => {
    it('deletes every thread for the workspace and returns the count', async () => {
        dynamo.queryItems.mockResolvedValue({ items: [{ threadId: 't1' }, { threadId: 't2' }, { threadId: 't3' }] })
        dynamo.deleteItems.mockResolvedValue(undefined)

        const deleted = await AiChatThread.deleteWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(deleted).toBe(3)
        expect(dynamo.queryItems).toHaveBeenCalledWith(expect.objectContaining({
            keyConditions: { workspaceId: 'ws-1' },
            fetchAllItems: true,
        }))
        expect(dynamo.deleteItems).toHaveBeenCalledTimes(3)
        expect(dynamo.deleteItems).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'ws-1', threadId: 't2' },
        }))
    })

    it('skips a thread that fails to delete and still counts the successes', async () => {
        dynamo.queryItems.mockResolvedValue({ items: [{ threadId: 't1' }, { threadId: 't2' }, { threadId: 't3' }] })
        dynamo.deleteItems
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('throttled'))
            .mockResolvedValueOnce(undefined)

        const deleted = await AiChatThread.deleteWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(deleted).toBe(2)
        expect(dynamo.deleteItems).toHaveBeenCalledTimes(3)
    })

    it('returns zero when the workspace has no threads', async () => {
        dynamo.queryItems.mockResolvedValue({ items: [] })

        expect(await AiChatThread.deleteWorkspaceAiChatThreads({ workspaceId: 'ws-1' })).toBe(0)
        expect(dynamo.deleteItems).not.toHaveBeenCalled()
    })
})
