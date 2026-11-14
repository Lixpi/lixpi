import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CapabilityAgentExpert,
} from '@lixpi/capability-system/backend'
import {
    AgentExecutionScope,
    type AgentExecution,
} from './agent-execution-scope.ts'
import {
    AgentExperts,
    type AgentExpertInvocation,
    type AgentExpertRun,
    type AgentWorkflowExpertRun,
} from './agent-experts.ts'
import { AgentToolsPending } from './agent-pending-tools.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const fixture = async () => {
    const stored = await createConversationExecutionFixture()
    const sourceAccess = vi.fn(async (id: string) => {
        if (id !== 'source')
            throw new Error('SOURCE_NOT_ADMITTED')
    })
    const execution: AgentExecution = {
        owner: stored.owner,
        turn: stored.turn,
        responseMessageId: 'response',
        continuationEpoch: 0,
        permissions: {
            readOnly: false,
            allowedOperationFamilies: ['image', 'sequence-export'],
        },
        createdAssetIds: new Set(),
        assertReadTarget: sourceAccess,
    }
    const expert: CapabilityAgentExpert = {
        kind: 'expert',
        name: 'pipeline-expert',
        description: 'Plan media dependencies.',
        operationFamilies: ['image'],
        runtime: {
            kind: 'agent',
            instructions: 'Use the installed operations.',
            toolNames: [],
            skillIds: [],
        },
    }
    const run = vi.fn(async (_request: AgentExpertRun): Promise<unknown> => ({ text: 'Completed.' }))
    const options = {
        repository: stored.repository,
        payloads: stored.payloads,
        execution,
        resolve: async () => expert,
        run,
        operations: {
            advance: async () => ({
                pending: false,
                completed: [],
            }),
            acknowledge: vi.fn(),
            cancel: vi.fn(),
            cancelOperation: vi.fn(),
        },
    }
    const request = {
        expertName: expert.name,
        task: 'Prepare the requested media.',
        sourceAssetIds: ['source'],
    }

    return {
        ...stored,
        execution,
        sourceAccess,
        expert,
        options,
        run,
        request,
    }
}

// =============================================================================
// DURABLE SPECIALIST INVOCATIONS
// =============================================================================

describe('AgentExperts', () => {
    it('records one specialist allocation and reuses a completed native call receipt', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.execution, async () => {
            const first = await new AgentExperts(f.options).delegate(f.request, 'call-1')
            expect(await new AgentExperts(f.options).delegate(f.request, 'call-1')).toEqual(first)
        })
        expect(f.run).toHaveBeenCalledTimes(1)
        expect((await f.owner.read()).run!.budget.specialistCalls).toBe(1)
        expect(f.run.mock.calls[0][0].execution.permissions.allowedOperationFamilies).toEqual(['image'])
    })

    it('recovers the committed allocation after an acknowledgement is lost', async () => {
        const f = await fixture()
        f.database.failAfterCommit = true
        await AgentExecutionScope.run(f.execution, async () => void (await new AgentExperts(f.options).delegate(f.request, 'call-1')))
        expect((await f.owner.read()).run!.budget.specialistCalls).toBe(1)
        expect(f.run).toHaveBeenCalledTimes(1)
    })

    it('resumes the same child invocation after a pending media operation', async () => {
        const f = await fixture()
        f.run.mockImplementationOnce(async request => {
            await request.retainOperations(['media-1'])

            throw new AgentToolsPending()
        })
        await AgentExecutionScope.run(f.execution, async () => {
            const first = await new AgentExperts(f.options).delegate(f.request, 'call-1')
            expect(first).toMatchObject({ status: 'pending' })
            const resumed = await new AgentExperts(f.options).operations().advance(f.owner)
            expect(resumed.pending).toBe(false)
            expect(resumed.completed).toHaveLength(1)
            expect(f.run.mock.calls[1][0].invocation.operationIds).toEqual(['media-1'])
            expect(f.run.mock.calls[1][0].invocation.operationId).toBe(f.run.mock.calls[0][0].invocation.operationId)
        })
        expect((await f.owner.read()).run!.budget.specialistCalls).toBe(1)
    })

    it('does not retry an uncertain provider invocation', async () => {
        const f = await fixture()
        f.run.mockRejectedValue(new Error('AGENT_MODEL_CALL_OUTCOME_UNKNOWN'))
        await AgentExecutionScope.run(f.execution, async () => {
            const experts = new AgentExperts(f.options)
            expect(await experts.delegate(f.request, 'call-1')).toMatchObject({
                status: 'error',
                error: { code: 'AGENT_MODEL_CALL_OUTCOME_UNKNOWN' },
            })
            expect(await experts.delegate(f.request, 'call-1')).toMatchObject({ status: 'error' })
        })
        expect(f.run).toHaveBeenCalledTimes(1)
    })

    it('rejects changed specialist instructions before resuming inference', async () => {
        const f = await fixture()
        f.run.mockRejectedValueOnce(new AgentToolsPending())
        await AgentExecutionScope.run(f.execution, async () => {
            await new AgentExperts(f.options).delegate(f.request, 'call-1')

            if (f.expert.runtime.kind !== 'agent')
                throw new Error('Invalid fixture')

            f.expert.runtime.instructions = 'Changed instructions.'
            await expect(new AgentExperts(f.options).operations().advance(f.owner)).rejects.toThrow('AGENT_EXPERT_DEFINITION_CHANGED')
        })
        expect(f.run).toHaveBeenCalledTimes(1)
    })

    it('reauthorizes sources before returning a stored result', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.execution, async () => {
            await new AgentExperts(f.options).delegate(f.request, 'call-1')
            f.sourceAccess.mockRejectedValue(new Error('SOURCE_REVOKED'))
            await expect(new AgentExperts(f.options).delegate(f.request, 'call-1')).rejects.toThrow('SOURCE_REVOKED')
        })
        expect(f.run).toHaveBeenCalledTimes(1)
    })

    it('keeps separate native calls distinct even when their task text matches', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.execution, async () => {
            await new AgentExperts(f.options).delegate(f.request, 'call-1')
            await new AgentExperts(f.options).delegate(f.request, 'call-2')
        })
        expect(f.run).toHaveBeenCalledTimes(2)
        expect(f.run.mock.calls[0][0].invocation.operationId).not.toBe(f.run.mock.calls[1][0].invocation.operationId)
        expect((await f.owner.read()).run!.budget.specialistCalls).toBe(2)
    })

    it('exposes only delegated parent-created Assets and the child own outputs', async () => {
        const f = await fixture()
        f.execution.createdAssetIds.add('delegated-parent-created')
        f.execution.createdAssetIds.add('unrelated-parent-created')
        f.request.sourceAssetIds.push('delegated-parent-created')
        f.run.mockImplementation(async ({ execution }) => {
            await AgentExecutionScope.assertReadTargets(['source', 'delegated-parent-created'])
            await expect(AgentExecutionScope.assertReadTargets(['unrelated-parent-created'])).rejects.toThrow('AGENT_EXPERT_SOURCE_NOT_DELEGATED')
            execution.createdAssetIds.add('child-output')
            await AgentExecutionScope.assertReadTargets(['child-output'])

            return { text: 'Completed within the delegated sources.' }
        })
        await AgentExecutionScope.run(f.execution, async () => void expect(await new AgentExperts(f.options).delegate(f.request, 'call-1')).toMatchObject({ status: 'completed' }))
        expect(f.execution.createdAssetIds.has('child-output')).toBe(true)
        expect(f.sourceAccess).not.toHaveBeenCalledWith('unrelated-parent-created')
    })

    it.each(['completed', 'pending'] as const)('keeps cancellation terminal when active work later returns %s', async outcome => {
        const f = await fixture()
        let entered!: (request: AgentExpertRun) => void
        let release!: () => void
        const started = new Promise<AgentExpertRun>(resolve => void (entered = resolve))
        const released = new Promise<void>(resolve => void (release = resolve))
        f.run.mockImplementation(async request => {
            await request.retainOperations(['media-1'])
            entered(request)
            await released

            if (outcome === 'pending')
                throw new AgentToolsPending()

            return { text: 'Late completion.' }
        })
        await AgentExecutionScope.run(f.execution, async () => {
            const active = new AgentExperts(f.options).delegate(f.request, 'call-1')
            const request = await started
            const cancelled = await new AgentExperts(f.options).operations().cancelOperation!(f.owner, request.invocation.operationId)
            release()
            expect(cancelled).toMatchObject({
                status: 'error',
                error: { code: 'AGENT_EXPERT_CANCELLED' },
            })
            expect(await active).toEqual(cancelled)
            expect(await new AgentExperts(f.options).delegate(f.request, 'call-1')).toEqual(cancelled)
            const saved = await f.repository.read<AgentExpertInvocation>(f.owner.partition, `EXPERT#${request.invocation.operationId}`)
            expect(saved?.state).toBe('cancelled')
        })
        expect(f.options.operations.cancelOperation).toHaveBeenCalledWith(f.owner, 'media-1')
        expect(f.run).toHaveBeenCalledTimes(1)
    })

    it('keeps Stop cancellation terminal when a running expert finishes', async () => {
        const f = await fixture()
        let entered!: () => void
        let release!: () => void
        const started = new Promise<void>(resolve => void (entered = resolve))
        const released = new Promise<void>(resolve => void (release = resolve))
        f.run.mockImplementation(async () => {
            entered()
            await released

            return { text: 'Late result after Stop.' }
        })
        await AgentExecutionScope.run(f.execution, async () => {
            const active = new AgentExperts(f.options).delegate(f.request, 'call-1')
            await started
            await AgentExperts.cancelForRun(f.repository, f.owner)
            release()
            expect(await active).toMatchObject({
                status: 'error',
                error: { code: 'AGENT_EXPERT_CANCELLED' },
            })
        })
        const rows = await f.repository.query<AgentExpertInvocation>(f.owner.partition, 'EXPERT#')
        expect(rows.items[0].state).toBe('cancelled')
    })

    it('propagates steering through framework error causes without sealing a failed result', async () => {
        const f = await fixture()
        const steer = new Error('CONVERSATION_STEER_BOUNDARY')
        f.run.mockRejectedValue(new Error('Framework tool failed', { cause: steer }))
        await AgentExecutionScope.run(f.execution, async () => void (await expect(new AgentExperts(f.options).delegate(f.request, 'call-1')).rejects.toBe(steer)))
        const rows = await f.repository.query<AgentExpertInvocation>(f.owner.partition, 'EXPERT#')
        expect(rows.items[0]).toMatchObject({ state: 'prepared' })
        expect(rows.items[0].payload).toBeUndefined()
    })

    it('passes inherited read-only limits into the specialist', async () => {
        const f = await fixture()
        f.execution.permissions.readOnly = true
        f.run.mockImplementation(async () => {
            await expect(AgentExecutionScope.authorize('execute', ['image'])).rejects.toThrow('AGENT_EXECUTION_READ_ONLY')

            return { text: 'Inspected.' }
        })
        await AgentExecutionScope.run(f.execution, async () => void (await new AgentExperts(f.options).delegate(f.request, 'call-1')))
        expect(f.run.mock.calls[0][0].execution.permissions.readOnly).toBe(true)
    })
})

describe('injected workflow experts', () => {
    it('uses reconciliation instead of resubmission after a pending graph', async () => {
        const f = await fixture()
        const workflow: CapabilityAgentExpert = {
            kind: 'expert',
            name: f.request.expertName,
            description: 'Run the existing media graph.',
            operationFamilies: ['image'],
            runtime: {
                kind: 'workflow',
                capabilityId: 'test-workflow',
                schema: { type: 'object' },
                execution: 'media',
            },
        }
        const start = vi.fn(async (_request: AgentWorkflowExpertRun) => ({
            status: 'pending',
            operationId: 'graph-run',
        }))
        const resume = vi.fn(async (_request: AgentWorkflowExpertRun) => ({ outputAssetId: 'output' }))
        const options = {
            ...f.options,
            resolve: async () => workflow,
            workflow: {
                start,
                resume,
            },
        }
        await AgentExecutionScope.run(f.execution, async () => {
            expect(await new AgentExperts(options).delegate(f.request, 'call-1')).toMatchObject({ status: 'pending' })
            expect((await new AgentExperts(options).operations().advance(f.owner)).completed).toHaveLength(1)
        })
        expect(start).toHaveBeenCalledTimes(1)
        expect(resume).toHaveBeenCalledTimes(1)
        expect(f.run).not.toHaveBeenCalled()
        expect(start.mock.calls[0][0].invocation.operationId).toBe(resume.mock.calls[0][0].invocation.operationId)
    })

    it('rejects workflow invocation without a supplied executor', async () => {
        const f = await fixture()
        const workflow: CapabilityAgentExpert = {
            kind: 'expert',
            name: f.request.expertName,
            description: 'Unavailable graph.',
            operationFamilies: ['image'],
            runtime: {
                kind: 'workflow',
                capabilityId: 'test-workflow',
                schema: {},
                execution: 'media',
            },
        }
        await AgentExecutionScope.run(f.execution, async () => void (await expect(new AgentExperts({
            ...f.options,
            resolve: async () => workflow,
        }).delegate(f.request, 'call-1')).rejects.toThrow('AGENT_EXPERT_UNAVAILABLE')))
        expect((await f.owner.read()).run!.budget.specialistCalls).toBe(0)
    })
})
