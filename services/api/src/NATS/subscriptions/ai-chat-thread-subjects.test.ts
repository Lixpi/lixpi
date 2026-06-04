'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
    },
    aiChatThread: {
        createAiChatThread: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: mocks.aiChatThread }))

import { aiChatThreadSubjects } from './ai-chat-thread-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS.AI_CHAT_THREAD_SUBJECTS
const getHandler = (subject: string) =>
    aiChatThreadSubjects.find((subscription) => subscription.subject === subject)!.handler

describe('AI chat thread session ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ canvasState: { nodes: [] } })
    })

    it('persists standalone ownership metadata on creation', async () => {
        mocks.aiChatThread.createAiChatThread.mockResolvedValue({ threadId: 'thread-1' })

        await getHandler(SUBJECTS.CREATE_AI_CHAT_THREAD)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: {},
            aiModel: 'openai:test',
            title: 'AI Chat',
            owner: { type: 'standalone' },
        })

        expect(mocks.aiChatThread.createAiChatThread).toHaveBeenCalledWith(expect.objectContaining({
            owner: { type: 'standalone' },
            title: 'AI Chat',
        }))
    })

    it('deletes an ordinary standalone session', async () => {
        const result = await getHandler(SUBJECTS.DELETE_AI_CHAT_THREAD)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            threadId: 'standalone-1',
        })

        expect(mocks.aiChatThread.delete).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            threadId: 'standalone-1',
        })
        expect(result).toEqual({ success: true, threadId: 'standalone-1' })
    })
})
