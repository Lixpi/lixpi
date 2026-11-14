import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type ProviderUsageClient,
    type ProviderRequestAuthorizationResult,
} from '@lixpi/usage-reporter'
import { AgentModelCalls } from './agent-model-calls.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

vi.mock('../../services/account-request-context.ts', () => ({
    AccountRequestContext: {
        assertActive: () => {},
        prepareCleanup: (operation: () => Promise<void>) => operation,
    },
}))

const fixture = async () => {
    const execution = await createConversationExecutionFixture()
    const metrics = {
        enabled: true,
        authorizeRequest: vi.fn(async (): Promise<ProviderRequestAuthorizationResult> => ({
            authorized: true,
            authorizationId: 'authorization',
        })),
        recordUsage: vi.fn(async () => {}),
        completeRequest: vi.fn(async () => {}),
    }
    const calls = new AgentModelCalls(execution.owner, execution.repository, execution.payloads, metrics as unknown as ProviderUsageClient, 0)
    const invoke = vi.fn(async observe => {
        observe({
            promptTokens: 20,
            completionTokens: 7,
        }, 'provider_request')

        return { text: 'Finished' }
    })
    const input = {
        requestKey: 'step-0',
        modelId: 'approved-model',
        estimatedUnits: 32,
        invoke,
    }

    return {
        ...execution,
        metrics,
        calls,
        input,
        invoke,
    }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

// =============================================================================
// MODEL CALL RECEIPTS AND MEASURED USAGE
// =============================================================================

describe('agent model calls', () => {
    it('replays a durable response without another provider submission or budget charge', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
            owner,
        } = await fixture()
        expect(await calls.execute(input)).toEqual({ text: 'Finished' })
        expect(await calls.execute(input)).toEqual({ text: 'Finished' })
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect((await owner.read()).run?.budget.modelCalls).toBe(1)
        expect(metrics.recordUsage.mock.calls.every(([request]) => request.providerRequestId === 'provider_request' && request.workflowSeq === 1)).toBe(true)
        expect(metrics.completeRequest).toHaveBeenLastCalledWith(expect.objectContaining({ providerRequestIds: ['provider_request'] }))
    })

    it.each([
        {
            result: {
                authorized: false,
                reason: 'request_denied',
            },
            code: 'AGENT_MODEL_CALL_NOT_AUTHORIZED',
        },
        {
            result: {
                authorized: false,
                reason: 'invalid_request',
            },
            code: 'AGENT_MODEL_AUTHORIZATION_INVALID_REQUEST',
        },
        {
            result: {
                authorized: false,
                reason: 'authorization_unavailable',
            },
            code: 'AGENT_MODEL_AUTHORIZATION_UNAVAILABLE',
        },
        {
            result: { authorized: true },
            code: 'AGENT_MODEL_AUTHORIZATION_UNAVAILABLE',
        },
    ] as const)('persists $code without submitting or settling an unauthorized call', async ({
        result,
        code,
    }) => {
        const f = await fixture()
        f.metrics.authorizeRequest.mockResolvedValue(result)

        await expect(f.calls.execute(f.input)).rejects.toThrow(code)
        await expect(f.calls.execute(f.input)).rejects.toThrow(code)
        expect(f.invoke).not.toHaveBeenCalled()
        expect(f.metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect(f.metrics.recordUsage).not.toHaveBeenCalled()
        expect(f.metrics.completeRequest).not.toHaveBeenCalled()
        expect([...f.database.rows.values()].find(row => String(row.sk).startsWith('MODEL#'))).toMatchObject({
            state: 'failed',
            error: code,
        })
    })

    it('quarantines an ambiguous submission and never invokes it again', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
            database,
        } = await fixture()
        invoke.mockRejectedValueOnce(new Error('CONNECTION_LOST'))
        await expect(calls.execute(input)).rejects.toThrow('CONNECTION_LOST')
        await expect(calls.execute(input)).rejects.toThrow('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect(metrics.completeRequest).not.toHaveBeenCalled()
        expect([...database.rows.values()].find(row => String(row.sk).startsWith('MODEL#'))?.state).toBe('unknown')
    })

    it('blocks a changed prompt after an uncertain submission without another authorization or budget charge', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
            owner,
        } = await fixture()
        invoke.mockRejectedValueOnce(new Error('CONNECTION_LOST'))
        await expect(calls.execute(input)).rejects.toThrow('CONNECTION_LOST')
        await expect(calls.execute({
            ...input,
            requestKey: 'changed-system-prompt',
        })).rejects.toThrow('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect((await owner.read()).run?.budget.modelCalls).toBe(1)
    })

    it('keeps concurrent expert calls independent even when their provider inputs match', async () => {
        const {
            calls,
            input,
            metrics,
            owner,
        } = await fixture()
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const first = calls.execute({
            ...input,
            invocationId: 'expert-first',
            invoke: async observe => {
                started.resolve()
                await release.promise
                observe({
                    promptTokens: 3,
                    completionTokens: 2,
                }, 'first-provider-request')

                return { text: 'First expert finished' }
            },
        })
        await started.promise

        try {
            expect(await calls.execute({
                ...input,
                invocationId: 'expert-second',
            })).toEqual({ text: 'Finished' })
        } finally {
            release.resolve()
            await first
        }

        expect(metrics.authorizeRequest).toHaveBeenCalledTimes(2)
        expect(new Set(metrics.authorizeRequest.mock.calls.map(([request]) => request.workflowId)).size).toBe(2)
        expect((await owner.read()).run?.budget.modelCalls).toBe(2)
    })

    it('retries stored measured usage after an ambiguous call without resubmitting the provider request', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
        } = await fixture()
        invoke.mockImplementationOnce(async observe => {
            observe({
                promptTokens: 15,
                completionTokens: 2,
            }, 'partial_provider_request')

            throw new Error('CONNECTION_LOST')
        })
        metrics.recordUsage.mockRejectedValueOnce(new Error('USAGE_OUTBOX_UNAVAILABLE'))
        await expect(calls.execute(input)).rejects.toThrow('USAGE_OUTBOX_UNAVAILABLE')
        await expect(calls.execute(input)).rejects.toThrow('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
        expect(metrics.recordUsage).toHaveBeenCalledTimes(2)
        expect(metrics.completeRequest).toHaveBeenCalledWith(expect.objectContaining({ providerRequestIds: ['partial_provider_request'] }))
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('retains measured usage when the owner expires during a provider request', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
            clock,
            database,
        } = await fixture()
        invoke.mockImplementationOnce(async observe => {
            observe({
                promptTokens: 12,
                completionTokens: 4,
            }, 'late_provider_request')
            clock.now += 30001

            return { text: 'Late response' }
        })
        await expect(calls.execute(input)).rejects.toThrow('CONVERSATION_OWNER_LOST')
        expect(metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
            providerRequestId: 'late_provider_request',
            usage: {
                promptTokens: 12,
                completionTokens: 4,
            },
        }))
        const receipt = [...database.rows.values()].find(row => String(row.sk).startsWith('MODEL#'))!
        expect(receipt.state).toBe('submitted')
        expect(receipt.response).toBeUndefined()
    })

    it('recovers a committed response after transaction acknowledgement loss', async () => {
        const {
            calls,
            input,
            invoke,
            database,
        } = await fixture()
        invoke.mockImplementationOnce(async observe => {
            observe({
                promptTokens: 12,
                completionTokens: 4,
            }, 'request_with_lost_ack')
            database.failAfterCommit = true

            return { text: 'Persisted response' }
        })
        await expect(calls.execute(input)).rejects.toThrow('ACKNOWLEDGEMENT_LOST')
        expect(await calls.execute(input)).toEqual({ text: 'Persisted response' })
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('records a definitive rejection with zero usage and does not retry it', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
        } = await fixture()
        const rejection = new Error('RATE_LIMITED') as Error & { status: number }
        rejection.status = 429
        invoke.mockRejectedValueOnce(rejection)
        await expect(calls.execute(input)).rejects.toThrow('RATE_LIMITED')
        await expect(calls.execute(input)).rejects.toThrow('AGENT_MODEL_REQUEST_REJECTED')
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: {
            promptTokens: 0,
            completionTokens: 0,
        } }))
    })

    it('rechecks continuation after authorization and before any provider submission', async () => {
        const {
            calls,
            input,
            invoke,
            metrics,
            owner,
            database,
        } = await fixture()
        metrics.authorizeRequest.mockImplementationOnce(async () => {
            await owner.mutate(meta => ({
                ...meta,
                run: {
                    ...meta.run!,
                    continuationEpoch: 1,
                    state: 'stopping',
                },
            }))

            return {
                authorized: true,
                authorizationId: 'authorization',
            }
        })
        await expect(calls.execute(input)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        expect(invoke).not.toHaveBeenCalled()
        const receipt = [...database.rows.values()].find(row => String(row.sk).startsWith('MODEL#'))!
        expect(receipt).toMatchObject({
            state: 'failed',
            error: 'AGENT_MODEL_CALL_NOT_SUBMITTED',
            usage: {
                promptTokens: 0,
                completionTokens: 0,
            },
        })
        expect(metrics.completeRequest).toHaveBeenCalledWith(expect.objectContaining({ authorizationId: 'authorization' }))
        await expect(calls.execute(input)).rejects.toThrow('AGENT_MODEL_CALL_NOT_SUBMITTED')
        expect(invoke).not.toHaveBeenCalled()
    })

    it('releases a known unused authorization after its persistence acknowledgement is lost', async () => {
        const f = await fixture()
        f.metrics.authorizeRequest.mockImplementationOnce(async () => {
            f.database.failAfterCommit = true

            return {
                authorized: true,
                authorizationId: 'authorization',
            }
        })
        await expect(f.calls.execute(f.input)).rejects.toThrow('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        expect(f.invoke).not.toHaveBeenCalled()
        expect(f.metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
            authorizationId: 'authorization',
            usage: {
                promptTokens: 0,
                completionTokens: 0,
            },
        }))
        expect(f.metrics.completeRequest).toHaveBeenCalledOnce()
        await expect(f.calls.execute(f.input)).rejects.toThrow('AGENT_MODEL_CALL_NOT_SUBMITTED')
        expect(f.invoke).not.toHaveBeenCalled()
    })

    it('releases a known unused authorization when Stop wins the final submission fence', async () => {
        const f = await fixture()
        const fences = f.owner.fences.bind(f.owner)
        let stopped = false
        vi.spyOn(f.owner, 'fences').mockImplementation(async expected => {
            const submitted = [...f.database.rows.values()].some(row => String(row.sk).startsWith('MODEL#') && row.state === 'submitted')

            if (
                expected === 0
                && submitted
                && !stopped
            ) {
                stopped = true
                await f.owner.mutate(meta => ({
                    ...meta,
                    run: {
                        ...meta.run!,
                        continuationEpoch: 1,
                        state: 'stopping',
                    },
                }))
            }

            return await fences(expected)
        })
        await expect(f.calls.execute(f.input)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        expect(stopped).toBe(true)
        expect(f.invoke).not.toHaveBeenCalled()
        expect(f.metrics.completeRequest).toHaveBeenCalledOnce()
        expect([...f.database.rows.values()].find(row => String(row.sk).startsWith('MODEL#'))).toMatchObject({
            state: 'failed',
            error: 'AGENT_MODEL_CALL_NOT_SUBMITTED',
        })
    })
})
