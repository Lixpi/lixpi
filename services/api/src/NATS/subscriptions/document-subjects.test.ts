'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    debug: {
        log: vi.fn(),
        info: vi.fn(),
        infoStr: vi.fn(),
        warn: vi.fn(),
        err: vi.fn(),
    },
    workspace: {
        getWorkspace: vi.fn(),
    },
    document: {
        getDocument: vi.fn(),
        createDocument: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        addTagToDocument: vi.fn(),
        removeTagFromDocument: vi.fn(),
    },
    aiChatThread: {
        getAiChatThread: vi.fn(),
    },
    transport: {
        ensureWorkspaceStream: vi.fn(),
        submitSteps: vi.fn(),
        getCurrentSubjectSequence: vi.fn(),
        getCurrentSubjectStateOrNull: vi.fn(),
        replayDocumentStepEvents: vi.fn(),
    },
    getDocumentStepSubject: vi.fn((coordinate: any) =>
        `subject-${coordinate.workspaceId}-${coordinate.docType}-${coordinate.docId}`),
    getWorkspaceStepStreamName: vi.fn((workspaceId: string) => `stream-${workspaceId}`),
}))

vi.mock('@lixpi/debug-tools', () => mocks.debug)
vi.mock('@lixpi/prosemirror', () => ({
    DOCUMENT_TYPE: {
        DOCUMENT: 'document',
        AI_CHAT_THREAD: 'aiChatThread',
    },
    PROSEMIRROR_SCHEMA_VERSION: 'prosemirror-v1',
    getDocumentStepSubject: mocks.getDocumentStepSubject,
    getWorkspaceStepStreamName: mocks.getWorkspaceStepStreamName,
}))

vi.mock('../../prosemirror/prosemirror-step-transport.ts', () => ({
    ProseMirrorStepTransport: {
        fromSingleton: () => mocks.transport,
    },
}))

vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/document.ts', () => ({ default: mocks.document }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: mocks.aiChatThread }))

import { documentSubjects } from './document-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS.DOCUMENT_SUBJECTS
const STEP_SUBJECTS = NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS
const getHandler = (subject: string) =>
    documentSubjects.find((subscription) => subscription.subject === subject)!.handler

const baseDocumentData = {
    user: { userId: 'user-1' },
    workspaceId: 'workspace-1',
    documentId: 'document-1',
}

describe('Document subject handlers — ownership and persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.document.getDocument.mockResolvedValue({ documentId: 'document-1', content: '{}' })
        mocks.document.createDocument.mockResolvedValue({ documentId: 'document-1' })
        mocks.document.update.mockResolvedValue(undefined)
        mocks.document.delete.mockResolvedValue(undefined)
        mocks.document.addTagToDocument.mockResolvedValue({ success: true })
        mocks.document.removeTagFromDocument.mockResolvedValue({ success: true })
        mocks.aiChatThread.getAiChatThread.mockResolvedValue({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: '{}',
            version: 1,
            proseMirrorVersion: 1,
        })
        mocks.transport.ensureWorkspaceStream.mockResolvedValue(undefined)
        mocks.transport.submitSteps.mockResolvedValue({ success: true })
        mocks.transport.getCurrentSubjectSequence.mockResolvedValue(0)
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValue({
            subjectSeq: 0,
            streamSequence: 0,
            documentVersion: 0,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValue([])
        mocks.getDocumentStepSubject.mockClear()
        mocks.getWorkspaceStepStreamName.mockClear()
    })

    it('returns workspace errors for GET_DOCUMENT', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })
        const result = await getHandler(SUBJECTS.GET_DOCUMENT)(baseDocumentData)

        expect(result).toEqual({ error: 'WORKSPACE_NOT_FOUND' })
        expect(mocks.document.getDocument).not.toHaveBeenCalled()
    })

    it('returns a persisted document for GET_DOCUMENT', async () => {
        const persisted = { documentId: 'document-1', workspaceId: 'workspace-1' }
        mocks.document.getDocument.mockResolvedValueOnce(persisted)

        const result = await getHandler(SUBJECTS.GET_DOCUMENT)(baseDocumentData)

        expect(mocks.document.getDocument).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            documentId: 'document-1'
        })
        expect(result).toEqual(persisted)
    })

    it('persists CREATE_DOCUMENT with workspace metadata', async () => {
        const payload = {
            ...baseDocumentData,
            title: 'Draft',
            content: { type: 'doc' },
        }

        const created = { documentId: 'new-document' }
        mocks.document.createDocument.mockResolvedValueOnce(created)

        const result = await getHandler(SUBJECTS.CREATE_DOCUMENT)(payload)

        expect(mocks.document.createDocument).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            title: 'Draft',
            content: { type: 'doc' },
        })
        expect(result).toEqual(created)
    })

    it('updates a document and returns a canonical success object', async () => {
        const payload = {
            ...baseDocumentData,
            title: 'Updated',
            content: { type: 'doc' },
        }

        const result = await getHandler(SUBJECTS.UPDATE_DOCUMENT)(payload)

        expect(mocks.document.update).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated',
            content: { type: 'doc' },
        })
        expect(result).toEqual({ success: true, documentId: 'document-1' })
    })

    it('deletes a document and returns a canonical success object', async () => {
        const result = await getHandler(SUBJECTS.DELETE_DOCUMENT)(baseDocumentData)

        expect(mocks.document.delete).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
        })
        expect(result).toEqual({ success: true, documentId: 'document-1' })
    })

    it('adds a tag by delegating to the document model', async () => {
        const result = await getHandler(SUBJECTS.ADD_TAG_TO_DOCUMENT)({
            ...baseDocumentData,
            tagId: 'tag-1',
        })

        expect(mocks.document.addTagToDocument).toHaveBeenCalledWith({
            userId: 'user-1',
            documentId: 'document-1',
            tagId: 'tag-1',
        })
        expect(result).toEqual({ success: true })
    })

    it('removes a tag by delegating to the document model', async () => {
        const result = await getHandler(SUBJECTS.REMOVE_TAG_FROM_DOCUMENT)({
            ...baseDocumentData,
            tagId: 'tag-1',
        })

        expect(mocks.document.removeTagFromDocument).toHaveBeenCalledWith({
            documentId: 'document-1',
            tagId: 'tag-1',
        })
        expect(result).toEqual({ success: true })
    })
})

describe('Document step submissions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
    })

    it('returns workspace errors before submitting document step batches', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            baseVersion: 1,
            expectedVersion: 1,
            steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
            user: { userId: 'user-1' },
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.transport.submitSteps).not.toHaveBeenCalled()
    })

    it('rechecks workspace access after a denied submit instead of caching denied access', async () => {
        const payload = {
            ...baseDocumentData,
            workspaceId: 'workspace-recheck',
            docType: 'document',
            docId: 'document-recheck',
            baseVersion: 1,
            expectedVersion: 1,
            steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
            user: { userId: 'user-recheck' },
        }
        const transportResult = { status: 'ACCEPTED', version: 2 }

        mocks.workspace.getWorkspace
            .mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })
            .mockResolvedValueOnce({ workspaceId: 'workspace-recheck' })
        mocks.transport.submitSteps.mockResolvedValueOnce(transportResult)

        const firstResult = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)
        const secondResult = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)

        expect(firstResult).toEqual({ error: 'PERMISSION_DENIED' })
        expect(secondResult).toEqual(transportResult)
        expect(mocks.workspace.getWorkspace).toHaveBeenCalledTimes(2)
        expect(mocks.transport.submitSteps).toHaveBeenCalledTimes(1)
    })

    it('submits one document step through the batch subject with client-edit origin', async () => {
        const payload = {
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            baseVersion: 1,
            expectedVersion: 1,
            steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
            user: { userId: 'user-1' },
        }

        const transportResult = { success: true, version: 2 }
        mocks.transport.submitSteps.mockResolvedValueOnce(transportResult)

        const result = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)

        expect(mocks.transport.submitSteps).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            docType: 'document',
            docId: 'document-1',
            baseVersion: 1,
            expectedVersion: 1,
            steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
            origin: 'client-edit',
        })
        expect(result).toEqual(transportResult)
    })

    it('schedules a debounced snapshot job when DOC_SUBMIT_STEPS is accepted', async () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

        try {
            const payload = {
                ...baseDocumentData,
                docType: 'document',
                docId: 'document-1',
                baseVersion: 1,
                expectedVersion: 1,
                steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
                user: { userId: 'user-1' },
            }
            mocks.transport.submitSteps.mockResolvedValueOnce({ status: 'ACCEPTED', version: 2 })

            const result = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)

            expect(result).toEqual({ status: 'ACCEPTED', version: 2 })
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
            expect(setTimeoutSpy.mock.calls[0]?.[0]).toBeInstanceOf(Function)
        } finally {
            setTimeoutSpy.mockRestore()
            vi.useRealTimers()
        }
    })

    it('does not schedule snapshot persistence when DOC_SUBMIT_STEPS is not accepted', async () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

        try {
            const payload = {
                ...baseDocumentData,
                docType: 'document',
                docId: 'document-1',
                baseVersion: 1,
                expectedVersion: 1,
                steps: [{ step: { type: 'replace' }, msgId: 'msg-1', clientId: 'client-1' }],
                user: { userId: 'user-1' },
            }
            mocks.transport.submitSteps.mockResolvedValueOnce({ status: 'REJECTED', version: 2 })

            const result = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)

            expect(result).toEqual({ status: 'REJECTED', version: 2 })
            expect(setTimeoutSpy).not.toHaveBeenCalled()
        } finally {
            setTimeoutSpy.mockRestore()
            vi.useRealTimers()
        }
    })

    it('submits document step batches to the prosemirror transport with one workspace access check', async () => {
        const payload = {
            ...baseDocumentData,
            workspaceId: 'workspace-batch',
            docType: 'document',
            docId: 'document-1',
            baseVersion: 4,
            expectedVersion: 4,
            steps: [
                { step: { type: 'replace', index: 1 }, msgId: 'msg-1', clientId: 'client-1' },
                { step: { type: 'replace', index: 2 }, msgId: 'msg-2', clientId: 'client-1' },
            ],
            user: { userId: 'user-batch' },
        }
        const transportResult = { status: 'ACCEPTED', version: 6 }
        mocks.transport.submitSteps.mockResolvedValueOnce(transportResult)

        const result = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)
        const secondResult = await getHandler(STEP_SUBJECTS.DOC_SUBMIT_STEPS)(payload)

        expect(mocks.workspace.getWorkspace).toHaveBeenCalledOnce()
        expect(mocks.workspace.getWorkspace).toHaveBeenCalledWith({
            userId: 'user-batch',
            workspaceId: 'workspace-batch',
        })
        expect(mocks.transport.submitSteps).toHaveBeenCalledWith({
            workspaceId: 'workspace-batch',
            docType: 'document',
            docId: 'document-1',
            baseVersion: 4,
            expectedVersion: 4,
            steps: payload.steps,
            origin: 'client-edit',
        })
        expect(result).toEqual(transportResult)
        expect(secondResult).toEqual({ success: true })
    })
})

describe('Document resume reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.document.getDocument.mockResolvedValue({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: '{"type":"doc","content":[]}',
            version: 4,
            proseMirrorVersion: 2,
        })
        mocks.transport.ensureWorkspaceStream.mockResolvedValue(undefined)
        mocks.transport.getCurrentSubjectSequence.mockResolvedValue(2)
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValue({
            subjectSeq: 2,
            streamSequence: 2,
            documentVersion: 2,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValue([])
    })

    it('denies DOC_RESUME when workspace access fails', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            localVersion: 0,
            user: { userId: 'user-1' },
        })

        expect(result).toEqual({ error: 'WORKSPACE_NOT_FOUND' })
        expect(mocks.aiChatThread.getAiChatThread).not.toHaveBeenCalled()
        expect(mocks.document.getDocument).not.toHaveBeenCalled()
        expect(mocks.transport.replayDocumentStepEvents).not.toHaveBeenCalled()
    })

    it('returns current snapshot and no events when client is at current version', async () => {
        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'aiChatThread',
            docId: 'thread-1',
            localVersion: 7,
            localStreamSeq: 2,
            user: { userId: 'user-1' },
        })

        expect(mocks.aiChatThread.getAiChatThread).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
        })
        expect(mocks.transport.getCurrentSubjectStateOrNull).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
        }))
        expect(mocks.transport.replayDocumentStepEvents).not.toHaveBeenCalled()
        expect(mocks.getDocumentStepSubject).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
        }))
        expect(result.currentVersion).toBe(2)
        expect(result.currentStreamSeq).toBe(2)
        expect(result.events).toEqual([])
        expect(result.snapshot).toMatchObject({
            workspaceId: 'workspace-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
            version: 1,
            schemaVersion: 'prosemirror-v1',
            doc: {},
        })
    })

    it('replays and filters events when the client lags behind current version', async () => {
        mocks.document.getDocument.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: '{"type":"doc","content":[{"type":"paragraph"}]}',
            version: 4,
            proseMirrorVersion: 2,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 6,
            streamSequence: 8,
            documentVersion: 8,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValueOnce([
            { kind: 'START', baseVersion: -1, version: 1, streamSequence: 1 },
            { kind: 'START', baseVersion: 1, version: 2, streamSequence: 2 },
            { kind: 'START', baseVersion: 2, version: 3, streamSequence: 3 },
            { kind: 'STEP', version: 0, streamSequence: 4 },
            { kind: 'STEP', version: 3, streamSequence: 5 },
            { kind: 'END', baseVersion: 3, finalVersion: 1, version: 2, streamSequence: 6 },
            { kind: 'END', baseVersion: 3, finalVersion: 4, version: 2, streamSequence: 7 },
            { kind: 'ERROR', finalVersion: 99, version: 8, streamSequence: 8 },
        ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            localVersion: 0,
            user: { userId: 'user-1' },
        })

        expect(mocks.document.getDocument).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
        })
        expect(result.events).toEqual([
            { kind: 'START', baseVersion: 1, version: 2, streamSequence: 2 },
            { kind: 'START', baseVersion: 2, version: 3, streamSequence: 3 },
            { kind: 'STEP', version: 3, streamSequence: 5 },
            { kind: 'END', baseVersion: 3, finalVersion: 1, version: 2, streamSequence: 6 },
            { kind: 'END', baseVersion: 3, finalVersion: 4, version: 2, streamSequence: 7 },
            { kind: 'ERROR', finalVersion: 99, version: 8, streamSequence: 8 },
        ])
        expect(result.currentVersion).toBe(8)
        expect(result.currentStreamSeq).toBe(8)
        expect(result.snapshot?.version).toBe(2)
        expect(result.streamName).toBe('stream-workspace-1')
        expect(result.subject).toBe('subject-workspace-1-document-document-1')
    })

    it('uses baseVersion as localVersion when localVersion is omitted', async () => {
        mocks.document.getDocument.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: '{"type":"doc","content":[{"type":"paragraph"}]}',
            version: 4,
            proseMirrorVersion: 2,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 3,
            streamSequence: 4,
            documentVersion: 3,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValueOnce([
            { kind: 'START', baseVersion: 1, version: 2, streamSequence: 1 },
            { kind: 'START', baseVersion: 2, version: 3, streamSequence: 2 },
            { kind: 'STEP', version: 1, streamSequence: 3 },
            { kind: 'STEP', version: 3, streamSequence: 4 },
        ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            baseVersion: 2,
            user: { userId: 'user-1' },
        })

        expect(result.events).toEqual([
            { kind: 'START', baseVersion: 2, version: 3, streamSequence: 2 },
            { kind: 'STEP', version: 3, streamSequence: 4 },
        ])
        expect(result.currentVersion).toBe(3)
    })

    it('loads thread snapshots from aiChatThread with valid JSON content', async () => {
        mocks.aiChatThread.getAiChatThread.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: '{\"type\":\"doc\",\"content\":[]}',
            proseMirrorVersion: 7,
            version: 4,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 0,
            streamSequence: 0,
            documentVersion: 0,
        })

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'aiChatThread',
            docId: 'thread-1',
            localVersion: 10,
            user: { userId: 'user-1' },
        })

        expect(result.snapshot).toMatchObject({
            workspaceId: 'workspace-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
            version: 7,
            schemaVersion: 'prosemirror-v1',
            doc: { type: 'doc', content: [] },
        })
        expect(result.currentVersion).toBe(7)
    })

    it('returns null snapshot for malformed document content and still replays lifecycle events', async () => {
        mocks.document.getDocument.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: 'not-json',
            version: 2,
            proseMirrorVersion: 3,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 1,
            streamSequence: 2,
            documentVersion: 4,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValueOnce([
            { kind: 'START', baseVersion: 0, version: 1, streamSequence: 1 },
            { kind: 'ERROR', finalVersion: 5, version: 4, streamSequence: 2 },
        ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            localVersion: 0,
            user: { userId: 'user-1' },
        })

        expect(result.snapshot).toBeNull()
        expect(result.currentVersion).toBe(4)
        expect(result.events).toEqual([
            { kind: 'START', baseVersion: 0, version: 1, streamSequence: 1 },
            { kind: 'ERROR', finalVersion: 5, version: 4, streamSequence: 2 },
        ])
    })

    it('falls back to version 0 and null snapshot when stored content is malformed', async () => {
        mocks.aiChatThread.getAiChatThread.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: 'not-json',
            version: -1,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 3,
            streamSequence: 2,
            documentVersion: 3,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValueOnce([
            { kind: 'STEP', version: 1, streamSequence: 1 },
            { kind: 'STEP', version: 3, streamSequence: 2 },
        ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'aiChatThread',
            docId: 'thread-1',
            localVersion: 0,
            user: { userId: 'user-1' },
        })

        expect(result.snapshot).toBeNull()
        expect(result.currentVersion).toBe(3)
        expect(result.events).toEqual([
            { kind: 'STEP', version: 1, streamSequence: 1 },
            { kind: 'STEP', version: 3, streamSequence: 2 },
        ])
    })

    it('uses stream sequence to resume lifecycle events even when document version is already current', async () => {
        mocks.aiChatThread.getAiChatThread.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            content: '{\"type\":\"doc\",\"content\":[]}',
            proseMirrorVersion: 2,
            version: 4,
        })
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 4,
            streamSequence: 5,
            documentVersion: 2,
        })
        mocks.transport.replayDocumentStepEvents.mockResolvedValueOnce([
            {
                kind: 'START',
                workspaceId: 'workspace-1',
                docType: 'aiChatThread',
                docId: 'thread-1',
                baseVersion: 2,
                version: 2,
                subjectSeq: 3,
                streamSequence: 3,
            },
        ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'aiChatThread',
            docId: 'thread-1',
            localVersion: 2,
            localStreamSeq: 2,
            user: { userId: 'user-1' },
        })

        expect(mocks.transport.replayDocumentStepEvents).toHaveBeenCalledWith(expect.objectContaining({
            startStreamSeq: 3,
        }))
        expect(result.currentVersion).toBe(2)
        expect(result.currentStreamSeq).toBe(5)
        expect(result.events).toEqual([
            expect.objectContaining({
                kind: 'START',
                baseVersion: 2,
                streamSequence: 3,
            }),
        ])
    })

    it('continues replay scans past stale events until it reaches relevant stream events', async () => {
        mocks.transport.getCurrentSubjectStateOrNull.mockResolvedValueOnce({
            subjectSeq: 7,
            streamSequence: 5,
            documentVersion: 4,
        })
        mocks.transport.replayDocumentStepEvents
            .mockResolvedValueOnce([
                { kind: 'START', baseVersion: -1, version: 0, streamSequence: 1 },
                { kind: 'STEP', version: 1, streamSequence: 2 },
            ])
            .mockResolvedValueOnce([
                { kind: 'STEP', version: 4, streamSequence: 5 },
            ])

        const result = await getHandler(STEP_SUBJECTS.DOC_RESUME)({
            ...baseDocumentData,
            docType: 'document',
            docId: 'document-1',
            localVersion: 3,
            localStreamSeq: 0,
            user: { userId: 'user-1' },
        })

        expect(mocks.transport.replayDocumentStepEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({
            startStreamSeq: 1,
        }))
        expect(mocks.transport.replayDocumentStepEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({
            startStreamSeq: 3,
        }))
        expect(result.events).toEqual([
            { kind: 'STEP', version: 4, streamSequence: 5 },
        ])
        expect(result.currentVersion).toBe(4)
        expect(result.currentStreamSeq).toBe(5)
    })
})
