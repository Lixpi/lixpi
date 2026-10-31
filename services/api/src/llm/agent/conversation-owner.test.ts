import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ConversationOwner } from './conversation-owner.ts'
import { AgentConfiguration } from './agent-configuration.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'
import { type AgentOperation } from '@lixpi/constants'

// =============================================================================
// LEASE, CONTINUATION AND BUDGET FENCING
// =============================================================================

describe('conversation owner', () => {
    it.each(['stopped', 'lease-lost', 'access-revoked'])('cannot renew an execution budget after %s', async boundary => {
        const {
            owner,
            repository,
            partition,
            turn,
            ports,
        } = await createConversationExecutionFixture()
        const answer = {
            ...turn,
            turnId: 'answer',
            commandSeq: 2,
            state: 'queued' as const,
            interruptId: 'limit',
        }
        await repository.commit([repository.put(partition, 'TURN#answer', answer)])
        await owner.waitForInput('limit')
        await owner.start(turn, new AgentConfiguration({}))

        if (boundary === 'stopped')
            await owner.finish('stopped')
        else if (boundary === 'lease-lost')
            await owner.release()
        else
            ports.authorize = async () => { throw new Error('ACCESS_REVOKED') }

        await expect(owner.renewBudget(answer, new AgentConfiguration({}), 'response')).rejects.toThrow()
        expect((await repository.query(partition, 'BUDGET_ANSWER#')).items).toEqual([])
    })

    it('publishes committed output identities without private execution or authorization fields', async () => {
        const {
            owner,
            repository,
            partition,
            ports,
        } = await createConversationExecutionFixture()
        const publish = vi.spyOn(ports, 'publish')
        const operation: AgentOperation = {
            operationId: 'operation',
            conversationAssetId: 'conversation',
            turnId: 'turn',
            runId: 'run',
            responseMessageId: 'response',
            operationKey: 'image.generate',
            inputHash: 'private-input-hash',
            sources: [],
            authorizationId: 'private-authorization',
            providerRequestId: 'private-provider-request',
            state: 'submitted',
            epoch: owner.epoch,
            continuationEpoch: 0,
            outputAssetIds: { image: 'reserved-output' },
            createdAt: 1000,
            updatedAt: 1000,
        }
        const submitted = await owner.event('operation.status', operation)
        expect(submitted.payload).toMatchObject({
            state: 'submitted',
            outputAssetIds: {},
        })
        expect(submitted.payload).not.toHaveProperty('authorizationId')
        expect(submitted.payload).not.toHaveProperty('providerRequestId')
        expect(submitted.payload).not.toHaveProperty('sources')
        expect(submitted.payload).not.toHaveProperty('inputHash')
        expect(await repository.read(partition, 'PUBLIC_OPERATION#response#operation')).toMatchObject({ outputAssetIds: {} })
        await owner.event('operation.status', {
            ...operation,
            state: 'succeeded',
        })
        expect(await repository.read(partition, 'PUBLIC_OPERATION#response#operation')).toMatchObject({ outputAssetIds: { image: 'reserved-output' } })
        expect(publish.mock.calls.at(-1)?.[0].payload).toMatchObject({ outputAssetIds: { image: 'reserved-output' } })
    })

    it('preserves a steered budget and allocates a linked budget only for an answered execution limit', async () => {
        const {
            owner,
            repository,
            partition,
            turn,
        } = await createConversationExecutionFixture()
        await owner.consumeBudget('modelCalls', 0)
        const steering = {
            ...turn,
            turnId: 'steering',
            commandSeq: 2,
            state: 'queued' as const,
        }
        await repository.commit([repository.put(partition, 'TURN#steering', steering)])
        const run = await owner.steer(steering)
        expect(run.budget.modelCalls).toBe(1)
        expect(run.continuationEpoch).toBe(1)
        const continuing = {
            ...turn,
            turnId: 'continuing',
            commandSeq: 3,
            state: 'queued' as const,
            interruptId: 'budget-question',
        }
        await repository.commit([repository.put(partition, 'TURN#continuing', continuing)])
        await owner.waitForInput('budget-question')
        await owner.start(steering, new AgentConfiguration({}))
        const continued = await owner.renewBudget(continuing, new AgentConfiguration({ AGENT_MAX_MODEL_CALLS: '8' }), 'continued-response')
        expect(continued.continuedFromBudgetAllocationId).toBe(run.budgetAllocationId)
        expect(continued.budgetAllocationId).not.toBe(run.budgetAllocationId)
        expect(continued.runId).toBe(run.runId)
        expect(continued.turnId).toBe(run.turnId)
        expect(continued.continuationEpoch).toBe(run.continuationEpoch)
        expect(continued.budget).toMatchObject({
            modelCalls: 0,
            maxModelCalls: 8,
        })
        expect(await repository.read(partition, `BUDGET_ALLOCATION#${run.budgetAllocationId}`)).toMatchObject({
            budget: { modelCalls: 1 },
        })
        await owner.consumeBudget('modelCalls', continued.continuationEpoch)
        expect((await owner.renewBudget(continuing, new AgentConfiguration({}), 'continued-response')).budget.modelCalls).toBe(1)
        expect((await repository.query(partition, 'BUDGET_ANSWER#')).items).toHaveLength(1)
    })

    it('admits two conversations per user and releases the slot for the next accepted conversation', async () => {
        const {
            owner,
            repository,
            partition,
            job,
            ports,
        } = await createConversationExecutionFixture()
        const base = await repository.read<Record<string, unknown>>(partition, 'META')
        const jobs = ['second', 'third'].map(conversationAssetId => ({
            ...job,
            conversationAssetId,
        }))

        for (const next of jobs)
            await repository.commit([repository.put(partition.replace(job.conversationAssetId, next.conversationAssetId), 'META', {
                ...base,
                conversationAssetId: next.conversationAssetId,
                leaseOwner: undefined,
                leaseExpiresAt: undefined,
            })])

        const second = await ConversationOwner.acquire(jobs[0], repository, ports)
        expect(second).toBeDefined()
        expect(await ConversationOwner.acquire(jobs[1], repository, ports)).toBeUndefined()
        await owner.release()
        const third = await ConversationOwner.acquire(jobs[1], repository, ports)
        expect(third).toBeDefined()
        await second!.release()
        await third!.release()
    })

    it('revokes the lease and pauses accepted work when account admission is cancelled', async () => {
        const {
            owner,
            repository,
            partition,
            job,
            ports,
        } = await createConversationExecutionFixture()
        await owner.pauseForReauthentication()
        const saved = await repository.read<{
            queuePaused: boolean
            run: { state: string }
            leaseOwner?: string
        }>(partition, 'META')
        expect(saved?.queuePaused).toBe(true)
        expect(saved?.run.state).toBe('needs-reauthentication')
        expect(saved?.leaseOwner).toBeUndefined()
        await expect(owner.fences(0)).rejects.toThrow('CONVERSATION_OWNER_LOST')
        const replacement = await ConversationOwner.acquire(job, repository, ports)
        expect((await replacement!.read()).run?.state).toBe('needs-reauthentication')
    })

    it('stores partial response text before final replacement without duplicating message identity', async () => {
        const {
            owner,
            repository,
            partition,
        } = await createConversationExecutionFixture()
        const message = {
            messageId: 'streamed',
            turnId: 'turn',
            role: 'assistant' as const,
            text: 'Hello',
            complete: false,
            createdAt: 1000,
        }
        await owner.partialMessage(message, 'Hello', 0)
        expect((await repository.read<{ text: string }>(partition, 'MESSAGE#streamed'))?.text).toBe('Hello')
        await owner.message({
            ...message,
            text: 'Hello there',
            complete: true,
        })
        const saved = await repository.query(partition, 'MESSAGE#')
        expect(saved.items).toHaveLength(1)
        expect(saved.items[0]).toMatchObject({
            text: 'Hello there',
            complete: true,
        })
    })

    it('allows one active owner and rejects stale writes after lease takeover', async () => {
        const fixture = await createConversationExecutionFixture()
        const {
            owner,
            job,
            repository,
            ports,
            clock,
            turn,
        } = fixture
        expect(await ConversationOwner.acquire(job, repository, ports)).toBeUndefined()
        await owner.consumeBudget('modelCalls', 0)
        clock.now += 30001
        const candidates = await Promise.all([ConversationOwner.acquire(job, repository, ports), ConversationOwner.acquire(job, repository, ports)])
        expect(candidates.filter(Boolean)).toHaveLength(1)
        const replacement = candidates.find(Boolean)!
        expect(replacement.epoch).toBe(owner.epoch + 1)
        await expect(owner.consumeBudget('modelCalls', 0)).rejects.toThrow('CONVERSATION_OWNER_LOST')
        expect(owner.abort.signal.aborted).toBe(true)
        const resumed = await replacement.start(turn, new AgentConfiguration({ AGENT_MAX_MODEL_CALLS: '100' }))
        expect(resumed.budget.modelCalls).toBe(1)
        expect(resumed.budget.maxModelCalls).toBe(24)
    })

    it('enforces owner conditions at transaction commit, including a takeover after the read', async () => {
        const {
            owner,
            database,
            partition,
        } = await createConversationExecutionFixture()
        database.beforeCommit = () => {
            database.beforeCommit = undefined
            const row = database.rows.get(`${partition}|META`)!
            database.rows.set(`${partition}|META`, {
                ...row,
                epoch: Number(row.epoch) + 1,
                leaseOwner: 'replacement',
                revision: Number(row.revision) + 1,
            })
        }
        await expect(owner.consumeBudget('toolCalls', 0)).rejects.toThrow('CONVERSATION_OWNER_LOST')
        const row = database.rows.get(`${partition}|META`)!
        expect((row.run as { budget: { toolCalls: number } }).budget.toolCalls).toBe(0)
    })

    it('rejects old continuations and terminal runs before consuming another action', async () => {
        const { owner } = await createConversationExecutionFixture()
        await owner.mutate(meta => ({
            ...meta,
            run: {
                ...meta.run!,
                continuationEpoch: 1,
                state: 'stopping',
            },
        }))
        await expect(owner.fences(0)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        await expect(owner.consumeBudget('modelCalls', 0)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        await owner.finish('stopped')
        await expect(owner.fences(1)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        await expect(owner.consumeBudget('toolCalls', 1)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
    })

    it('enforces the persisted finite budget under concurrent consumption', async () => {
        const { owner } = await createConversationExecutionFixture()
        await owner.mutate(meta => ({
            ...meta,
            run: {
                ...meta.run!,
                budget: {
                    ...meta.run!.budget,
                    maxModelCalls: 1,
                },
            },
        }))
        const results = await Promise.allSettled([owner.consumeBudget('modelCalls', 0), owner.consumeBudget('modelCalls', 0)])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        expect((await owner.read()).run?.budget.modelCalls).toBe(1)
        await expect(owner.consumeBudget('modelCalls', 0)).rejects.toThrow('AGENT_BUDGET_EXHAUSTED:modelCalls')
    })

    it('persists events before delivery and does not duplicate completed messages after delivery loss', async () => {
        const {
            owner,
            ports,
            database,
        } = await createConversationExecutionFixture()
        const publish = vi.spyOn(ports, 'publish').mockRejectedValueOnce(new Error('OFFLINE'))
        const message = {
            messageId: 'assistant_message',
            turnId: 'turn',
            role: 'assistant' as const,
            fragment: { type: 'aiResponseMessage' },
            createdAt: 1000,
        }
        await expect(owner.message(message)).rejects.toThrow('OFFLINE')
        await owner.message(message)
        expect([...database.rows.values()].filter(row => row.sk === 'MESSAGE#assistant_message')).toHaveLength(1)
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('EVENT#') && row.type === 'message.completed')).toHaveLength(1)
        expect(publish).toHaveBeenCalledTimes(1)
    })
})
