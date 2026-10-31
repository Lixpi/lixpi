import { describe, expect, it } from 'vitest'
import { AgentInput } from './agent-input.ts'
import { ConversationCheckpointSaver } from './conversation-checkpoint-saver.ts'
import { createConversationExecutionFixture, MemoryAgentPayloads } from './conversation-test-support.ts'

describe('necessary conversation input', () => {
    it('retains an interrupt across owner recovery and resumes that exact question once', async () => {
        const {
            owner,
            repository,
            partition,
        } = await createConversationExecutionFixture()
        const payloads = new MemoryAgentPayloads()
        const saver = new ConversationCheckpointSaver(repository, payloads, {
            partition,
            threadId: 'input-thread',
            assertRead: async () => void (await owner.fences(0)),
            writeFences: () => owner.fences(0),
        })
        const request = {
            threadId: 'input-thread',
            question: 'Which source should I use?',
        }
        const first = await new AgentInput(saver).ask(request)
        expect(first.interruptId).toEqual(expect.any(String))
        const recovered = await new AgentInput(saver).ask(request)
        expect(recovered.interruptId).toBe(first.interruptId)
        const answered = await new AgentInput(saver).ask({
            ...request,
            answer: {
                interruptId: first.interruptId!,
                text: 'Use the attached clip.',
            },
        })
        expect(answered).toEqual({ answer: 'Use the attached clip.' })
        expect(await new AgentInput(saver).ask(request)).toEqual(answered)
    })
})
