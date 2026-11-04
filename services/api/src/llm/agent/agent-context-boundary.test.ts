import { describe, expect, it, vi } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { AgentContextBoundary } from './agent-context-boundary.ts'
import { AgentScratchStore } from './agent-scratch-store.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

vi.mock('./conversation-adapters.ts', () => ({ ConversationAdapters: class {
    authorize = async (workspaceId: string, userId: string) => ({
        workspaceId,
        userId,
        organizationId: 'org',
        fences: [],
    })
    resolveReferences = async () => []
} }))

describe('active conversation context boundary', () => {
    it('retains paired action receipts while excluding discovered inputs, tool arguments, and old scratch summaries', async () => {
        const f = await createConversationExecutionFixture()
        const turn = {
            ...f.turn,
            settings: {
                ...f.turn.settings,
                contextMode: 'discovery' as const,
            },
        }
        const boundary = new AgentContextBoundary(f.repository, f.payloads, f.owner, turn, new Set(['create_sequence']))
        const oldScratch = new AgentScratchStore(f.repository, f.payloads, f.owner, boundary.namespace(), 0)
        await oldScratch.ports().write('/scratch/context-summary.txt', 'discovered-private-summary', 0)
        const meta = await f.owner.read()
        await f.repository.commit([f.repository.replace(f.owner.partition, 'META', {
            ...meta,
            settingsRevision: 2,
            revision: meta.revision + 1,
        })])
        await boundary.synchronize([
            new AIMessage({
                content: '',
                tool_calls: [{
                    id: 'inspect',
                    name: 'inspect_inputs',
                    args: { assetId: 'discovered-source' },
                }],
            }),
            new ToolMessage({
                tool_call_id: 'inspect',
                name: 'inspect_inputs',
                content: 'discovered-private-source',
            }),
            new AIMessage({
                content: 'discovered-private-thought',
                tool_calls: [{
                    id: 'create',
                    name: 'create_sequence',
                    args: { prompt: 'discovered-private-argument' },
                }],
            }),
            new ToolMessage({
                tool_call_id: 'create',
                name: 'create_sequence',
                content: JSON.stringify({
                    status: 'completed',
                    data: {
                        sequenceId: 'saved-output',
                        privateDescription: 'discovered-private-result',
                    },
                }),
            }),
        ])
        const recovered = new AgentContextBoundary(f.repository, f.payloads, f.owner, turn, new Set(['create_sequence']))
        await recovered.load()
        expect(recovered.effectiveTurn().settings.contextMode).toBe('explicit')
        expect(recovered.namespace()).not.toBe(boundary.namespace())
        const messages = await recovered.seed()
        expect(JSON.stringify(messages)).toContain('saved-output')
        expect(JSON.stringify(messages)).not.toContain('discovered-private')
        expect(JSON.stringify(messages)).not.toContain('discovered-source')
        expect(messages?.filter(message => message.getType() === 'tool').map(message => (message as ToolMessage).tool_call_id)).toEqual(['create'])
        const freshScratch = new AgentScratchStore(f.repository, f.payloads, f.owner, recovered.namespace(), 0)
        expect(await freshScratch.ports().read('/scratch/context-summary.txt')).toBeUndefined()
        expect((await oldScratch.ports().read('/scratch/context-summary.txt'))?.content).toBe('discovered-private-summary')
    })

    it.each(['model', 'operation'])('refuses a namespace rebuild around an unknown %s outcome', async kind => {
        const f = await createConversationExecutionFixture()
        const turn = {
            ...f.turn,
            settings: {
                ...f.turn.settings,
                contextMode: 'discovery' as const,
            },
        }
        const boundary = new AgentContextBoundary(f.repository, f.payloads, f.owner, turn, new Set())
        const run = (await f.owner.read()).run!
        await f.repository.commit([f.repository.put(f.owner.partition, kind === 'model' ? 'MODEL#unknown' : 'OPERATION#unknown', {
            runId: run.runId,
            turnId: turn.turnId,
            state: kind === 'model' ? 'submitted' : 'outcome-unknown',
            occurredAt: new Date().toISOString(),
        })])
        await expect(boundary.synchronize([])).rejects.toThrow(kind === 'model' ? 'AGENT_MODEL_CALL_OUTCOME_UNKNOWN' : 'AGENT_OPERATION_OUTCOME_UNKNOWN')
        expect(await f.repository.read(f.owner.partition, `CONTEXT_SCOPE#${turn.turnId}`)).toBeUndefined()
        expect((await f.owner.read()).run?.budget).toEqual(run.budget)
    })
})
