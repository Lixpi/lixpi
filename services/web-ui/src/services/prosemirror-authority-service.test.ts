'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { DOCUMENT_TYPE, getDocumentStepSubject } from '@lixpi/prosemirror'

import { ProseMirrorAuthorityService } from '$src/services/prosemirror-authority-service.ts'

const mocks = vi.hoisted(() => ({
    getData: vi.fn(),
    getTokenSilently: vi.fn(),
    uuid: vi.fn(() => 'client-uuid'),
}))

vi.mock('uuid', () => ({ v4: mocks.uuid }))
vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: mocks.getTokenSilently,
    },
}))
vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: mocks.getData,
    },
}))

type MockTransaction = {
    metadata: Map<string, unknown>
    setMeta: ReturnType<typeof vi.fn>
    replaceWith: ReturnType<typeof vi.fn>
}

function createTransaction(): MockTransaction {
    const transaction: MockTransaction = {
        metadata: new Map(),
        setMeta: vi.fn((key: string, value: unknown) => {
            transaction.metadata.set(key, value)
            return transaction
        }),
        replaceWith: vi.fn(() => transaction),
    }
    return transaction
}

function createView() {
    const transactions: MockTransaction[] = []
    const doc = {
        content: { size: 0 },
        toJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    }
    const state = {
        doc,
        schema: {
            nodeFromJSON: vi.fn(() => ({
                content: { size: 0 },
            })),
        },
        get tr() {
            const transaction = createTransaction()
            transactions.push(transaction)
            return transaction
        },
    }
    return {
        view: {
            state,
            dispatch: vi.fn(),
        } as any,
        transactions,
    }
}

function createNats() {
    return {
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
        request: vi.fn(),
    }
}

async function flushPromises(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
}

async function waitForRequestCount(nats: ReturnType<typeof createNats>, count: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (nats.request.mock.calls.length >= count) return
        await flushPromises()
    }
    throw new Error(`expected ${count} resume requests, saw ${nats.request.mock.calls.length}`)
}

const coordinate = {
    workspaceId: 'workspace-1',
    docType: DOCUMENT_TYPE.AI_CHAT_THREAD,
    docId: 'thread-1',
}

function makeEvent(overrides: Record<string, unknown>) {
    return {
        workspaceId: coordinate.workspaceId,
        docType: coordinate.docType,
        docId: coordinate.docId,
        aiProvider: 'Anthropic',
        ...overrides,
    }
}

// =============================================================================
// PROSEMIRROR AUTHORITY RESUME
// =============================================================================

describe('ProseMirrorAuthorityService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getTokenSilently.mockResolvedValue('auth-token')
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('subscribes to the document step subject and resumes with the local stream cursor', async () => {
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 3,
                events: [
                    makeEvent({
                        kind: 'START',
                        baseVersion: 0,
                        version: 0,
                        subjectSeq: 1,
                        streamSequence: 1,
                    }),
                ],
            })
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 3,
                events: [
                    makeEvent({
                        kind: 'ERROR',
                        version: 0,
                        subjectSeq: 2,
                        streamSequence: 3,
                        error: 'provider stopped',
                    }),
                ],
            })
        mocks.getData.mockReturnValue(nats)
        const { view } = createView()
        const onReceivingChange = vi.fn()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
            onReceivingChange,
        })

        await waitForRequestCount(nats, 2)

        expect(nats.subscribe).toHaveBeenCalledWith(
            getDocumentStepSubject(coordinate),
            expect.any(Function),
        )
        expect(nats.request).toHaveBeenNthCalledWith(
            1,
            NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
            expect.objectContaining({
                token: 'auth-token',
                ...coordinate,
                baseVersion: 0,
                localVersion: 0,
                localStreamSeq: 0,
            }),
        )
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
            expect.objectContaining({
                localVersion: 0,
                localStreamSeq: 1,
            }),
        )
        expect(onReceivingChange).toHaveBeenCalledWith(true, expect.objectContaining({ kind: 'START' }))
        expect(onReceivingChange).toHaveBeenCalledWith(false, expect.objectContaining({ kind: 'ERROR' }))

        service.disconnect()
    })

    it('keeps END pending until resume recovers the missing final document version', async () => {
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 2,
                currentStreamSeq: 2,
                events: [
                    makeEvent({
                        kind: 'START',
                        baseVersion: 0,
                        version: 0,
                        subjectSeq: 1,
                        streamSequence: 1,
                    }),
                    makeEvent({
                        kind: 'END',
                        version: 0,
                        finalVersion: 2,
                        subjectSeq: 2,
                        streamSequence: 2,
                    }),
                ],
            })
            .mockResolvedValueOnce({
                snapshot: {
                    ...coordinate,
                    version: 2,
                    schemaVersion: 'prosemirror-v1',
                    doc: { type: 'doc', content: [] },
                },
                currentVersion: 2,
                currentStreamSeq: 2,
                events: [],
            })
        mocks.getData.mockReturnValue(nats)
        const { view, transactions } = createView()
        const onReceivingChange = vi.fn()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
            onReceivingChange,
        })

        await waitForRequestCount(nats, 2)
        await flushPromises()

        expect(view.state.schema.nodeFromJSON).toHaveBeenCalledWith({ type: 'doc', content: [] })
        expect(view.dispatch).toHaveBeenCalled()
        expect(transactions.some(transaction =>
            transaction.metadata.get('setReceiving') && (transaction.metadata.get('setReceiving') as any).receiving === false
        )).toBe(true)
        expect(onReceivingChange.mock.calls.map(call => call[0])).toEqual([true, false])
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
            expect.objectContaining({
                localVersion: 0,
                localStreamSeq: 2,
            }),
        )

        service.disconnect()
    })

    it('recovers from a failed remote step by retrying resume until the settled snapshot arrives', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        let subscriptionHandler: ((event: any) => void) | null = null
        nats.subscribe.mockImplementation((_subject: string, handler: any) => {
            subscriptionHandler = handler
            return { unsubscribe: vi.fn() }
        })
        nats.request
            // Initial resume on connect: nothing to replay.
            .mockResolvedValueOnce({ snapshot: null, currentVersion: 0, currentStreamSeq: 0, events: [] })
            // Recovery resume while the stream is still active: no settled snapshot yet.
            .mockResolvedValueOnce({ snapshot: null, currentVersion: 1, currentStreamSeq: 2, events: [] })
            // Retry after the stream settles: snapshot is available.
            .mockResolvedValueOnce({
                snapshot: {
                    ...coordinate,
                    version: 1,
                    schemaVersion: 'prosemirror-v1',
                    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
                },
                currentVersion: 1,
                currentStreamSeq: 2,
                events: [],
            })
        mocks.getData.mockReturnValue(nats)
        const { view } = createView()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)
        expect(nats.request).toHaveBeenCalledTimes(1)

        subscriptionHandler!(makeEvent({ kind: 'START', baseVersion: 0, version: 0, subjectSeq: 1, streamSequence: 1 }))
        // The mock view cannot apply steps (state.tr.step is undefined), so this
        // remote step fails to apply and must push the service into snapshot recovery.
        subscriptionHandler!(makeEvent({ kind: 'STEP', version: 1, step: { stepType: 'replace' }, subjectSeq: 2, streamSequence: 2 }))
        await vi.advanceTimersByTimeAsync(0)

        // Recovery resumes from version 0 so the server returns snapshot + full replay.
        expect(nats.request).toHaveBeenCalledTimes(2)
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
            expect.objectContaining({ localVersion: 0, localStreamSeq: 0 }),
        )

        // No snapshot yet → the service must keep retrying instead of going idle.
        await vi.advanceTimersByTimeAsync(1000)
        expect(nats.request).toHaveBeenCalledTimes(3)
        expect(view.state.schema.nodeFromJSON).toHaveBeenCalledWith({ type: 'doc', content: [{ type: 'paragraph' }] })

        // Recovery is resolved: no further retries are scheduled.
        await vi.advanceTimersByTimeAsync(5000)
        expect(nats.request).toHaveBeenCalledTimes(3)

        service.disconnect()
    })

    it('batches multiple local steps into one submit request', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request.mockImplementation(async (subject: string) => {
            if (subject === NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME) {
                return {
                    snapshot: null,
                    currentVersion: 0,
                    currentStreamSeq: 0,
                    events: [],
                }
            }
            if (subject === NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEPS) {
                return { status: 'ACCEPTED', version: 2 }
            }
            return { error: 'unexpected subject' }
        })
        mocks.getData.mockReturnValue(nats)
        const { view } = createView()
        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            docType: DOCUMENT_TYPE.DOCUMENT,
            docId: 'document-1',
            baseVersion: 0,
            getView: () => view,
        })

        await Promise.resolve()
        await Promise.resolve()

        service.submitLocalTransaction({
            docChanged: true,
            getMeta: vi.fn(() => false),
            steps: [
                { toJSON: () => ({ type: 'replace', index: 1 }) },
                { toJSON: () => ({ type: 'replace', index: 2 }) },
            ],
            docs: [{}, {}],
        } as any)

        expect(nats.request).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(100)
        await Promise.resolve()

        expect(nats.request).toHaveBeenCalledTimes(2)
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEPS,
            expect.objectContaining({
                token: 'auth-token',
                workspaceId: coordinate.workspaceId,
                docType: DOCUMENT_TYPE.DOCUMENT,
                docId: 'document-1',
                expectedVersion: 0,
                steps: [
                    expect.objectContaining({
                        step: { type: 'replace', index: 1 },
                        clientId: 'client-uuid',
                    }),
                    expect.objectContaining({
                        step: { type: 'replace', index: 2 },
                        clientId: 'client-uuid',
                    }),
                ],
            }),
        )
        service.disconnect()
    })
})
