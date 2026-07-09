'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    nats: {
        getInstance: vi.fn(),
        createObjectStore: vi.fn(),
        deleteObjectStore: vi.fn(),
    },
    workspace: {
        createWorkspace: vi.fn(),
        delete: vi.fn(),
        getWorkspace: vi.fn(),
        getUserWorkspaces: vi.fn(),
        getBucketName: vi.fn((workspaceId: string) => `workspace-${workspaceId}-files`),
        update: vi.fn(),
        updateCanvasState: vi.fn(),
    },
    document: {
        getWorkspaceDocuments: vi.fn(),
    },
    aiChatThread: {
        deleteWorkspaceAiChatThreads: vi.fn(),
    },
    extractionRun: {
        deleteWorkspaceRuns: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: mocks.nats.getInstance,
    },
}))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/document.ts', () => ({ default: mocks.document }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: mocks.aiChatThread }))
vi.mock('../../models/extraction-run.ts', () => ({ default: mocks.extractionRun }))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) =>
    workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

describe('Workspace subject handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.nats.getInstance.mockReturnValue({
            createObjectStore: mocks.nats.createObjectStore,
            deleteObjectStore: mocks.nats.deleteObjectStore,
        })
        mocks.workspace.createWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            name: 'Workspace',
        })
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'ws-1' })
        mocks.workspace.delete.mockResolvedValue({ status: 'deleted', workspaceId: 'ws-1' })
        mocks.workspace.getUserWorkspaces.mockResolvedValue([{ workspaceId: 'ws-1' }])
        mocks.workspace.update.mockResolvedValue({ status: 'ok' })
        mocks.workspace.updateCanvasState.mockResolvedValue({ status: 'canvas-saved' })
        mocks.document.getWorkspaceDocuments.mockResolvedValue([{ documentId: 'doc-1' }])
        mocks.aiChatThread.deleteWorkspaceAiChatThreads.mockResolvedValue(2)
        mocks.extractionRun.deleteWorkspaceRuns.mockResolvedValue(1)
        mocks.nats.createObjectStore.mockResolvedValue({})
        mocks.nats.deleteObjectStore.mockResolvedValue(true)
    })

    // =========================================================================
    // READS
    // =========================================================================

    it('fetches a workspace via user and workspaceId', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual({ workspaceId: 'ws-1' })
        expect(mocks.workspace.getWorkspace).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
    })

    it('enforces UNAUTHORIZED when GET_USER_WORKSPACES lacks a user id', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_USER_WORKSPACES)({
            user: {} as any,
        })

        expect(result).toEqual({ error: 'UNAUTHORIZED' })
        expect(mocks.workspace.getUserWorkspaces).not.toHaveBeenCalled()
    })

    it('fetches user workspaces for authenticated callers', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_USER_WORKSPACES)({
            user: { userId: 'user-1' },
        })

        expect(result).toEqual([{ workspaceId: 'ws-1' }])
        expect(mocks.workspace.getUserWorkspaces).toHaveBeenCalledWith({ userId: 'user-1' })
    })

    // =========================================================================
    // WRITE / COMMAND HANDLERS
    // =========================================================================

    it('rolls back workspace creation when storage service is unavailable', async () => {
        mocks.nats.getInstance.mockReturnValueOnce(null as any)

        const result = await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.workspace.createWorkspace).toHaveBeenCalledWith({
            name: 'New Workspace',
            permissions: {
                userId: 'user-1',
                accessLevel: 'owner',
            },
        })
        expect(mocks.workspace.delete).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
        expect(result).toEqual({ error: 'STORAGE_SERVICE_UNAVAILABLE' })
    })

    it('rolls back workspace creation when object store creation fails', async () => {
        mocks.nats.createObjectStore.mockRejectedValueOnce(new Error('object store failed'))

        const result = await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.nats.deleteObjectStore).toHaveBeenCalledWith('workspace-ws-1-files')
        expect(mocks.workspace.delete).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
        expect(result).toEqual({ error: 'FAILED_TO_CREATE_BUCKET' })
    })

    it('creates an object store and returns created workspace metadata when storage service is healthy', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.nats.createObjectStore).toHaveBeenCalledWith(
            'workspace-ws-1-files',
            {
                description: 'Files for workspace ws-1',
            },
        )
        expect(mocks.nats.deleteObjectStore).not.toHaveBeenCalled()
        expect(mocks.workspace.delete).not.toHaveBeenCalled()
        expect(result).toEqual({ workspaceId: 'ws-1', name: 'Workspace' })
    })

    it('updates workspace metadata', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.UPDATE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
            name: 'Renamed',
        })

        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
        expect(mocks.workspace.update).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
            name: 'Renamed',
        })
    })

    it('forwards canvas state updates with expected save tokens', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
            canvasState: { nodes: [] },
            expectedCanvasStateUpdatedAt: 123,
            expectedUpdatedAt: 456,
        })

        expect(result).toEqual({ status: 'canvas-saved' })
        expect(mocks.workspace.updateCanvasState).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
            canvasState: { nodes: [] },
            expectedCanvasStateUpdatedAt: 123,
            expectedUpdatedAt: 456,
            persistViewport: false,
        })
    })

    // =========================================================================
    // CLEANUP / DELETION
    // =========================================================================

    it('continues deleting the workspace record when object store cleanup fails', async () => {
        mocks.nats.deleteObjectStore.mockRejectedValueOnce(new Error('bucket delete failed'))

        const result = await getHandler(WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.workspace.delete).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
        expect(mocks.aiChatThread.deleteWorkspaceAiChatThreads).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(mocks.extractionRun.deleteWorkspaceRuns).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
    })

    it('returns the workspace documents for authorized requests', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.document.getWorkspaceDocuments).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(result).toEqual([{ documentId: 'doc-1' }])
    })

    it('does not query documents when workspace access fails', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })

        const result = await getHandler(WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual({ error: 'WORKSPACE_NOT_FOUND' })
        expect(mocks.document.getWorkspaceDocuments).not.toHaveBeenCalled()
    })
})
