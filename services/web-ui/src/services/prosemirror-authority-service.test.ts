'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    getDocumentStepSubject,
    type StepEnvelope,
    type StepStreamEvent,
    type SubmitResult,
} from '@lixpi/prosemirror'

import { ProseMirrorAuthorityService } from '$src/services/prosemirror-authority-service.ts'

const { DOC_SUBMIT_STEPS, DOC_RESUME } = NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS

const mocks = vi.hoisted(() => ({
    getData: vi.fn(),
    getTokenSilently: vi.fn(),
    uuid: vi.fn(() => 'client-uuid'),
    stepFromJSON: vi.fn(),
}))

let consoleErrorSpy: { mockRestore: () => void } | null = null

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

vi.mock('@lixpi/prosemirror', async () => {
    const actual = await vi.importActual<typeof import('@lixpi/prosemirror')>('@lixpi/prosemirror')

    return {
        ...actual,
        Step: {
            ...actual.Step,
            fromJSON: mocks.stepFromJSON,
        },
    }
})

type MockTransaction = {
    metadata: Map<string, unknown>
    setMeta: ReturnType<typeof vi.fn>
    replaceWith: ReturnType<typeof vi.fn>
    step: ReturnType<typeof vi.fn>
}

function flushPromises(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function createTransaction(): MockTransaction {
    const transaction: MockTransaction = {
        metadata: new Map(),
        setMeta: vi.fn((key: string, value: unknown) => {
            transaction.metadata.set(key, value)
            return transaction
        }),
        replaceWith: vi.fn(() => transaction),
        step: vi.fn(() => transaction),
    }

    return transaction
}

function createView() {
    const transactions: MockTransaction[] = []
    const doc = {
        content: { size: 0 },
        toJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    }

    return {
        transactions,
        view: {
            state: {
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
            },
            dispatch: vi.fn(),
        },
    }
}

function createNats() {
    return {
        subscribe: vi.fn(),
        request: vi.fn(),
    }
}

function createEvent(overrides: Record<string, unknown>) {
    return {
        workspaceId: 'workspace-1',
        docType: DOCUMENT_TYPE.DOCUMENT,
        docId: 'thread-1',
        ...overrides,
    }
}

const coordinate = {
    workspaceId: 'workspace-1',
    docType: DOCUMENT_TYPE.DOCUMENT,
    docId: 'thread-1',
}

describe('ProseMirrorAuthorityService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        mocks.getTokenSilently.mockResolvedValue('auth-token')
        mocks.stepFromJSON.mockReturnValue({
            toJSON: vi.fn(() => ({ type: 'replace' })),
            invert: vi.fn(() => ({})),
            getMap: vi.fn(() => ({})),
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('subscribes to the document step subject and resumes authority state', async () => {
        const nats = createNats()
        nats.request.mockResolvedValue({
            snapshot: null,
            currentVersion: 0,
            currentStreamSeq: 0,
            events: [],
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

        await flushPromises()

        expect(nats.subscribe).toHaveBeenCalledWith(
            getDocumentStepSubject(coordinate),
            expect.any(Function),
        )
        expect(nats.request).toHaveBeenCalledWith(
            DOC_RESUME,
            expect.objectContaining({
                token: 'auth-token',
                workspaceId: coordinate.workspaceId,
                docType: coordinate.docType,
                docId: coordinate.docId,
                baseVersion: 0,
                localVersion: 0,
                localStreamSeq: 0,
            }),
        )
        service.disconnect()
        expect(onReceivingChange).not.toHaveBeenCalled()
    })

    it('does not submit local transactions in receive-only mode', async () => {
        const nats = createNats()
        nats.request.mockResolvedValue({
            snapshot: null,
            currentVersion: 0,
            currentStreamSeq: 0,
            events: [],
        })
        mocks.getData.mockReturnValue(nats)
        const { view } = createView()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            receiveOnly: true,
            getView: () => view,
        })

        await flushPromises()

        service.submitLocalTransaction({
            docChanged: true,
            getMeta: vi.fn(() => false),
            steps: [{ toJSON: () => ({ type: 'replace', index: 1 }) }],
            docs: [{}],
        } as any)

        expect(view.dispatch).not.toHaveBeenCalled()
        expect(nats.request).toHaveBeenCalledTimes(1)
        service.disconnect()
    })

    it('batches multiple local steps and submits one request after the debounce window', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 0,
                events: [],
            })
            .mockResolvedValueOnce({
                status: 'ACCEPTED',
                version: 2,
            })
        mocks.getData.mockReturnValue(nats)

        const { view } = createView()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)

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
            DOC_SUBMIT_STEPS,
            expect.objectContaining({
                token: 'auth-token',
                workspaceId: coordinate.workspaceId,
                docType: coordinate.docType,
                docId: coordinate.docId,
                expectedVersion: 0,
                steps: [
                    expect.objectContaining({
                        msgId: expect.stringContaining('pm-client-client-uuid-'),
                        clientId: 'client-uuid',
                    }),
                    expect.objectContaining({
                        msgId: expect.stringContaining('pm-client-client-uuid-'),
                        clientId: 'client-uuid',
                    }),
                ],
            }),
        )

        service.disconnect()
    })

    it('flushes immediately when local batch reaches max size', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        const submitResponse: SubmitResult = { status: 'ACCEPTED', version: 50 }
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 0,
                events: [],
            })
            .mockResolvedValueOnce(submitResponse)
        mocks.getData.mockReturnValue(nats)

        const { view } = createView()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)

        const steps = Array.from({ length: 50 }, (_, index) => ({ toJSON: () => ({ type: 'replace', index }) }))
        service.submitLocalTransaction({
            docChanged: true,
            getMeta: vi.fn(() => false),
            steps,
            docs: Array.from({ length: 50 }, () => ({})),
        } as any)

        await Promise.resolve()

        expect(nats.request).toHaveBeenCalledTimes(2)
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            DOC_SUBMIT_STEPS,
            expect.objectContaining({
                expectedVersion: 0,
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        clientId: 'client-uuid',
                    }),
                ]),
            }),
        )
        service.disconnect()
    })

    it('applies out-of-order steps once replayed and drains backlog', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 0,
                events: [],
            })
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 1,
                currentStreamSeq: 2,
                events: [
                    createEvent({
                        kind: 'STEP',
                        version: 1,
                        step: { stepType: 'replace' },
                        subjectSeq: 1,
                        streamSequence: 2,
                    }),
                ],
            })
        mocks.getData.mockReturnValue(nats)

        const { view } = createView()
        const onRemoteDocumentChange = vi.fn()
        let subscriptionHandler: (event: StepStreamEvent) => void = () => undefined
        nats.subscribe.mockImplementation((_subject: string, handler: (event: StepStreamEvent) => void) => {
            subscriptionHandler = handler
            return { unsubscribe: vi.fn() }
        })

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
            onRemoteDocumentChange,
        })

        await vi.advanceTimersByTimeAsync(0)

        subscriptionHandler(createEvent({
            kind: 'STEP',
            version: 2,
            step: { stepType: 'replace' },
            subjectSeq: 2,
            streamSequence: 2,
        }) as StepEnvelope)
        await vi.advanceTimersByTimeAsync(0)
        await Promise.resolve()

        expect(onRemoteDocumentChange).toHaveBeenCalledTimes(2)
        expect(nats.request).toHaveBeenCalledTimes(2)
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            DOC_RESUME,
            expect.objectContaining({
                localVersion: 0,
                localStreamSeq: 2,
            }),
        )

        service.disconnect()
    })

    it('retries snapshot recovery until a settled snapshot arrives', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 0,
                events: [],
            })
            .mockResolvedValueOnce({
                snapshot: null,
                currentVersion: 0,
                currentStreamSeq: 2,
                events: [],
            })
            .mockResolvedValueOnce({
                snapshot: {
                    ...coordinate,
                    version: 1,
                    schemaVersion: 'prosemirror-v1',
                    doc: { type: 'doc', content: [] },
                },
                currentVersion: 1,
                currentStreamSeq: 2,
                events: [],
            })
        mocks.getData.mockReturnValue(nats)

        let subscriptionHandler: (event: StepStreamEvent) => void = () => undefined
        nats.subscribe.mockImplementation((_subject: string, handler: (event: StepStreamEvent) => void) => {
            subscriptionHandler = handler
            return { unsubscribe: vi.fn() }
        })

        const { view } = createView()

        mocks.stepFromJSON.mockImplementation(() => {
            throw new Error('failed to parse step')
        })

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)

        subscriptionHandler(createEvent({
            kind: 'STEP',
            version: 1,
            step: { stepType: 'replace' },
            subjectSeq: 1,
            streamSequence: 1,
        }) as StepEnvelope)

        await vi.advanceTimersByTimeAsync(0)
        expect(nats.request).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(1000)
        expect(nats.request).toHaveBeenCalledTimes(3)

        expect(view.state.schema.nodeFromJSON).toHaveBeenCalledWith({ type: 'doc', content: [] })
        service.disconnect()
    })

    it('applies snapshots and updates expected version for future local submits', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request
            .mockResolvedValueOnce({
                snapshot: {
                    ...coordinate,
                    version: 2,
                    schemaVersion: 'prosemirror-v1',
                    doc: { type: 'doc', content: [] },
                },
                currentVersion: 2,
                currentStreamSeq: 3,
                events: [],
            })
            .mockResolvedValueOnce({
                status: 'ACCEPTED',
                version: 2,
            })
        mocks.getData.mockReturnValue(nats)

        const { view } = createView()

        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)
        service.submitLocalTransaction({
            docChanged: true,
            getMeta: vi.fn(() => false),
            steps: [{ toJSON: () => ({ type: 'replace', index: 1 }) }],
            docs: [{}],
        } as any)

        expect(nats.request).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(100)
        await Promise.resolve()

        expect(view.state.schema.nodeFromJSON).toHaveBeenCalledWith({ type: 'doc', content: [] })
        expect(nats.request).toHaveBeenNthCalledWith(
            2,
            DOC_SUBMIT_STEPS,
            expect.objectContaining({
                expectedVersion: 2,
            }),
        )

        service.disconnect()
    })

    it('prevents new work and unsubscribes when disconnected', async () => {
        vi.useFakeTimers()
        const nats = createNats()
        nats.request.mockResolvedValue({
            snapshot: null,
            currentVersion: 0,
            currentStreamSeq: 0,
            events: [],
        })
        const unsubscribeMock = vi.fn()
        nats.subscribe.mockReturnValue({ unsubscribe: unsubscribeMock })
        mocks.getData.mockReturnValue(nats)

        const { view } = createView()
        const service = new ProseMirrorAuthorityService({
            ...coordinate,
            baseVersion: 0,
            getView: () => view,
        })

        await vi.advanceTimersByTimeAsync(0)
        service.disconnect()

        service.submitLocalTransaction({
            docChanged: true,
            getMeta: vi.fn(() => false),
            steps: [{ toJSON: () => ({ type: 'replace', index: 1 }) }],
            docs: [{}],
        } as any)

        await vi.advanceTimersByTimeAsync(100)
        expect(unsubscribeMock).toHaveBeenCalled()
        expect(nats.request).toHaveBeenCalledTimes(1)
        service.disconnect()
    })
})
