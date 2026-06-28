'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AiChatThread from './ai-chat-thread.ts'

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

// The model references a global `dynamoDBService` (set on the server at boot).
const dynamo = {
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    queryItems: vi.fn(),
    deleteItems: vi.fn(),
}

beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
})

afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
})

// =============================================================================
// createAiChatThread — title metadata
// =============================================================================

    describe('AiChatThread.createAiChatThread', () => {
    it('persists standalone owner and title when provided and marks the thread active', async () => {
        dynamo.putItem.mockResolvedValue(undefined)

        const thread = await AiChatThread.createAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            content: {},
            aiModel: 'openai:test',
            title: 'AI Chat',
            owner: { type: 'standalone' },
        })

        expect(thread).toMatchObject({
            threadId: 'thread-1',
            status: 'active',
            title: 'AI Chat',
            owner: { type: 'standalone' },
        })
        expect(dynamo.putItem).toHaveBeenCalledWith(expect.objectContaining({
            item: expect.objectContaining({ owner: { type: 'standalone' }, title: 'AI Chat' }),
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

describe('AiChatThread.getAiChatThread', () => {
    it('returns NOT_FOUND when getItem returns no payload', async () => {
        dynamo.getItem.mockResolvedValue(undefined)

        const thread = await AiChatThread.getAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'missing-thread',
        })

        expect(thread).toEqual({ error: 'NOT_FOUND' })
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            tableName: expect.any(String),
            key: { workspaceId: 'ws-1', threadId: 'missing-thread' },
        }))
    })

    it('passes workspace/thread keys through to getItem', async () => {
        const result = { workspaceId: 'ws-1', threadId: 'thread-1' }
        dynamo.getItem.mockResolvedValue(result)

        const thread = await AiChatThread.getAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
        })

        expect(thread).toBe(result)
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'ws-1', threadId: 'thread-1' },
        }))
    })
})

describe('AiChatThread.update', () => {
    it('updates only provided values and includes prose mirror version when provided', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await AiChatThread.update({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            content: {},
            aiModel: 'openai:test',
            status: 'deleted',
            proseMirrorVersion: 7,
        })

        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'ws-1', threadId: 'thread-1' },
            updates: expect.objectContaining({
                content: {},
                aiModel: 'openai:test',
                status: 'deleted',
                proseMirrorVersion: 7,
                updatedAt: expect.any(Number),
            }),
        }))
    })

    it('propagates update errors', async () => {
        dynamo.updateItem.mockRejectedValue(new Error('update-failed'))

        await expect(AiChatThread.update({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            status: 'active',
        })).rejects.toThrow('update-failed')
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
