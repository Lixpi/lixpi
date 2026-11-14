import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    AgentExecutionScope,
    AgentReadTargetNotInContext,
    type AgentExecution,
} from './agent-execution-scope.ts'
import { inspectAgentSource } from './agent-source-inspection.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const fixture = async () => {
    const f = await createConversationExecutionFixture()
    const execution: AgentExecution = {
        owner: f.owner,
        turn: {
            ...f.turn,
            references: [{
                assetId: 'accepted-image',
                role: 'media',
                revision: 1,
                blobHash: 'frozen-image',
                acquiredBy: 'explicit',
                relationshipPath: ['accepted-image'],
            }],
        },
        permissions: {
            readOnly: false,
            allowedOperationFamilies: [],
        },
        responseMessageId: 'response',
        continuationEpoch: 0,
        createdAssetIds: new Set(),
    }
    const readSource = vi.fn(async () => ({ source: 'accepted-image' }))

    return {
        execution,
        readSource,
    }
}

describe('agent source inspection', () => {
    it('returns a recoverable error for an unadmitted numeric-looking ID without reading or admitting it', async () => {
        const f = await fixture()

        await AgentExecutionScope.run(f.execution, async () => {
            expect(await inspectAgentSource({
                assetId: '0',
                limit: 1000,
            }, f.readSource)).toMatchObject({
                status: 'error',
                error: {
                    code: 'AGENT_READ_TARGET_NOT_IN_CONTEXT',
                    recoverable: true,
                    message: expect.stringContaining('exact source ID'),
                },
            })
            expect(f.readSource).not.toHaveBeenCalled()
            await expect(AgentExecutionScope.assertReadTargets(['0'])).rejects.toBeInstanceOf(AgentReadTargetNotInContext)
        })
    })

    it('reads the exact admitted source and requested range', async () => {
        const f = await fixture()

        await AgentExecutionScope.run(f.execution, async () => void expect(await inspectAgentSource({
            assetId: 'accepted-image',
            offset: 20,
            limit: 1000,
        }, f.readSource)).toEqual({ source: 'accepted-image' }))
        expect(f.readSource).toHaveBeenCalledExactlyOnceWith('accepted-image', 20, 1000)
    })

    it.each(['ACCESS_REVOKED', 'AGENT_SOURCE_CHANGED', 'AGENT_EXPERT_SOURCE_NOT_DELEGATED'])('keeps %s fatal when current source authorization rejects inspection', async code => {
        const f = await fixture()
        f.execution.assertReadTarget = async () => { throw new Error(code) }

        await AgentExecutionScope.run(f.execution, async () => void (await expect(inspectAgentSource({ assetId: 'accepted-image' }, f.readSource)).rejects.toThrow(code)))
        expect(f.readSource).not.toHaveBeenCalled()
    })

    it('checks continuation and context fences before returning an invalid-target error', async () => {
        const f = await fixture()
        f.execution.assertContextCurrent = async () => { throw new Error('AGENT_CONTEXT_CHANGED') }

        await AgentExecutionScope.run(f.execution, async () => void (await expect(inspectAgentSource({ assetId: '0' }, f.readSource)).rejects.toThrow('AGENT_CONTEXT_CHANGED')))
        f.execution.assertContextCurrent = undefined
        f.execution.continuationEpoch = 999
        await AgentExecutionScope.run(f.execution, async () => void (await expect(inspectAgentSource({ assetId: '0' }, f.readSource)).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')))
        expect(f.readSource).not.toHaveBeenCalled()
    })

    it('does not mask source integrity failures after admission', async () => {
        const f = await fixture()
        f.readSource.mockRejectedValue(new Error('AGENT_SOURCE_CHANGED'))

        await AgentExecutionScope.run(f.execution, async () => void (await expect(inspectAgentSource({ assetId: 'accepted-image' }, f.readSource)).rejects.toThrow('AGENT_SOURCE_CHANGED')))
    })
})
