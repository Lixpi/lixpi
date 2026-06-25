'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
        delete: vi.fn(),
        getBucketName: vi.fn(() => 'workspace-ws-1-files'),
    },
    aiChatThread: {
        deleteWorkspaceAiChatThreads: vi.fn(),
    },
    extractionRun: {
        deleteWorkspaceRuns: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({ default: { getInstance: vi.fn(() => null) } }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/document.ts', () => ({ default: {} }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: mocks.aiChatThread }))
vi.mock('../../models/extraction-run.ts', () => ({ default: mocks.extractionRun }))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) =>
    workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

describe('Workspace deletion cleans up chat and extraction history', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'ws-1' })
        mocks.workspace.delete.mockResolvedValue({ status: 'deleted', workspaceId: 'ws-1' })
        mocks.aiChatThread.deleteWorkspaceAiChatThreads.mockResolvedValue(2)
        mocks.extractionRun.deleteWorkspaceRuns.mockResolvedValue(1)
    })

    it('deletes workspace AI chat threads and extraction runs before removing the workspace', async () => {
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.aiChatThread.deleteWorkspaceAiChatThreads).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(mocks.extractionRun.deleteWorkspaceRuns).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(mocks.workspace.delete).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' })
        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
    })

    it('still removes the workspace when chat/run cleanup throws', async () => {
        mocks.aiChatThread.deleteWorkspaceAiChatThreads.mockRejectedValueOnce(new Error('throttled'))

        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.workspace.delete).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' })
        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
    })

    it('does not touch history when the workspace is inaccessible', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.aiChatThread.deleteWorkspaceAiChatThreads).not.toHaveBeenCalled()
        expect(mocks.extractionRun.deleteWorkspaceRuns).not.toHaveBeenCalled()
        expect(mocks.workspace.delete).not.toHaveBeenCalled()
    })
})
