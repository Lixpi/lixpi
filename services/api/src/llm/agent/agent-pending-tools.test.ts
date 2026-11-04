import { describe, expect, it, vi } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { AgentPendingTools, AgentToolsPending } from './agent-pending-tools.ts'
import { createConversationExecutionFixture, MemoryAgentPayloads } from './conversation-test-support.ts'

const messages = () => [
    new AIMessage({
        content: '',
        tool_calls: [{
            id: 'call-1',
            name: 'submit_pipeline',
            args: {},
        }],
    }),
    new ToolMessage({
        id: 'tool-1',
        tool_call_id: 'call-1',
        name: 'submit_pipeline',
        content: JSON.stringify({
            status: 'pending',
            operationId: 'operation-1',
        }),
    }),
]

describe('durable native tool continuations', () => {
    it('pauses at the next model boundary while an operation is pending', async () => {
        const {
            repository,
            owner,
        } = await createConversationExecutionFixture()
        const pending = new AgentPendingTools(repository, new MemoryAgentPayloads(), owner, 0, {
            advance: async () => ({
                pending: true,
                completed: [],
            }),
            acknowledge: vi.fn(),
            cancel: vi.fn(),
        })
        await expect(pending.beforeModel(messages())).rejects.toBeInstanceOf(AgentToolsPending)
    })

    it('persists a completion before acknowledgment and recovers the original tool pairing after acknowledgment loss', async () => {
        const {
            repository,
            owner,
        } = await createConversationExecutionFixture()
        const payloads = new MemoryAgentPayloads()
        const result = {
            state: 'succeeded',
            outputs: { cut: { assetId: 'output' } },
        }
        const operations = {
            advance: vi.fn().mockResolvedValue({
                pending: false,
                completed: [{
                    operationId: 'operation-1',
                    result,
                }],
            }),
            acknowledge: vi.fn().mockRejectedValueOnce(new Error('ACK_LOST')).mockResolvedValue(undefined),
            cancel: vi.fn(),
        }
        await expect(new AgentPendingTools(repository, payloads, owner, 0, operations).beforeModel(messages())).rejects.toThrow('ACK_LOST')
        operations.advance.mockResolvedValue({
            pending: false,
            completed: [],
        })
        const restored = await new AgentPendingTools(repository, payloads, owner, 0, operations).beforeModel(messages())
        expect(restored).toHaveLength(2)
        expect(restored[1]).toBeInstanceOf(ToolMessage)
        expect((restored[1] as ToolMessage).tool_call_id).toBe('call-1')
        expect(restored[1].id).toBe('tool-1')
        expect(JSON.parse(restored[1].content as string)).toEqual(result)
    })

    it('rejects a completion after the continuation was stopped', async () => {
        const {
            repository,
            owner,
        } = await createConversationExecutionFixture()
        await owner.finish('stopped')
        const acknowledge = vi.fn()
        const pending = new AgentPendingTools(repository, new MemoryAgentPayloads(), owner, 0, {
            advance: async () => ({
                pending: false,
                completed: [{
                    operationId: 'operation-1',
                    result: {},
                }],
            }),
            acknowledge,
            cancel: vi.fn(),
        })
        await expect(pending.beforeModel(messages())).rejects.toThrow('CONVERSATION_CONTINUATION_STOPPED')
        expect(acknowledge).not.toHaveBeenCalled()
    })
})
