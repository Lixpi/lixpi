import { describe, expect, it, vi } from 'vitest'
import { AgentExecutionScope, type AgentExecution } from './agent-execution-scope.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

describe('agent read authority', () => {
    it('restricts inspect to accepted sources and created Assets without a discovery resolver', async () => {
        const f = await createConversationExecutionFixture()
        const scope: AgentExecution = {
            owner: f.owner,
            turn: {
                ...f.turn,
                references: [{
                    assetId: 'attached',
                    role: 'content',
                    revision: 1,
                    blobHash: 'hash',
                    acquiredBy: 'explicit',
                    relationshipPath: ['attached'],
                }],
            },
            intent: {
                intent: 'inspect',
                operationFamilies: [],
                targetAssetIds: [],
                confidence: 1,
                needsClarification: false,
            },
            responseMessageId: 'response',
            continuationEpoch: 0,
            createdAssetIds: new Set(['created']),
        }
        await AgentExecutionScope.run(scope, async () => {
            await expect(AgentExecutionScope.authorize('inspect', [], ['attached', 'created'])).resolves.toBe(scope)
            await expect(AgentExecutionScope.authorize('inspect', [], ['arbitrary-workspace-asset'])).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        })
    })

    it('requires the context resolver to authorize a discovery and preserves revocation', async () => {
        const f = await createConversationExecutionFixture()
        const assertReadTarget = vi.fn(async (assetId: string) => { if (assetId !== 'discovered')
            throw new Error('SOURCE_NOT_ADMITTED') })
        const scope: AgentExecution = {
            owner: f.owner,
            turn: f.turn,
            intent: {
                intent: 'inspect',
                operationFamilies: [],
                targetAssetIds: [],
                confidence: 1,
                needsClarification: false,
            },
            responseMessageId: 'response',
            continuationEpoch: 0,
            createdAssetIds: new Set(),
            assertReadTarget,
        }
        await AgentExecutionScope.run(scope, async () => {
            await expect(AgentExecutionScope.authorize('inspect', [], ['discovered'])).resolves.toBe(scope)
            await expect(AgentExecutionScope.authorize('inspect', [], ['not-discovered'])).rejects.toThrow('SOURCE_NOT_ADMITTED')
            assertReadTarget.mockRejectedValue(new Error('SOURCE_REVOKED'))
            await expect(AgentExecutionScope.authorize('inspect', [], ['discovered'])).rejects.toThrow('SOURCE_REVOKED')
        })
    })

    it('rechecks context admission for an originally authorized mutation target after narrowing', async () => {
        const f = await createConversationExecutionFixture()
        const scope: AgentExecution = {
            owner: f.owner,
            turn: f.turn,
            intent: {
                intent: 'execute',
                operationFamilies: ['sequence-edit'],
                targetAssetIds: ['discovered'],
                confidence: 1,
                needsClarification: false,
            },
            responseMessageId: 'response',
            continuationEpoch: 0,
            createdAssetIds: new Set(),
            assertReadTarget: async () => { throw new Error('SOURCE_NOT_ADMITTED') },
        }
        await AgentExecutionScope.run(scope, async () => void (await expect(AgentExecutionScope.authorize('execute', ['sequence-edit'], ['discovered'])).rejects.toThrow('SOURCE_NOT_ADMITTED')))
    })
})
