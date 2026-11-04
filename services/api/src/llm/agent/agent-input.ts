import {
    Annotation,
    Command,
    END,
    START,
    StateGraph,
    interrupt,
} from '@langchain/langgraph'
import {
    type BaseCheckpointSaver,
} from '@langchain/langgraph-checkpoint'
import { createHash } from 'node:crypto'
import {
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages'
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons'
import {
    type ConversationTurn,
} from '@lixpi/constants'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'
import { conversationMessageText } from './conversation-protocol.ts'

const inputState = Annotation.Root({
    question: Annotation<string>,
    answer: Annotation<string>,
})

// This graph persists the input boundary independently of model inference.
// Resuming it never replays a provider request or a workspace mutation.
export class AgentInput {
    constructor(private readonly checkpointer: BaseCheckpointSaver) {}

    async ask(input: {
        threadId: string
        question: string
        answer?: {
            interruptId: string
            text: string
        }
        signal?: AbortSignal
    }): Promise<{
        interruptId?: string
        answer?: string
    }> {
        // A question graph owns a separate saver. Inheriting a parent harness
        // runnable would replace it with that graph's thread/checkpointer.
        return await AsyncLocalStorageProviderSingleton.runWithConfig(
            {},
            async () => {
                const graph = new StateGraph(inputState)
                .addNode('await_input', state => ({ answer: interrupt({ question: state.question }) as string }))
                .addEdge(START, 'await_input')
                .addEdge('await_input', END)
                .compile({ checkpointer: this.checkpointer })
                const config = {
                    configurable: { thread_id: input.threadId },
                    signal: input.signal,
                }
                const checkpoint = await this.checkpointer.getTuple(config)

                if (checkpoint) {
                    const saved = await graph.getState(config)

                    if (
                        !saved.next.length
                        && typeof saved.values.answer === 'string'
                    )
                        return { answer: saved.values.answer }
                }

                const state = await graph.invoke(
                    input.answer
                        ? new Command({ resume: { [input.answer.interruptId]: input.answer.text } })
                        : checkpoint
                            ? null
                            : { question: input.question },
                    config,
                )
                const pending = (state as typeof state & { __interrupt__?: Array<{ id?: string }> }).__interrupt__?.[0]

                return pending ? { interruptId: pending.id } : { answer: state.answer }
            },
            true,
        )
    }
}

export class AgentInputPending extends Error {
    constructor(readonly interruptId: string) {
        super('AGENT_INPUT_PENDING')
    }
}

type InputResult = {
    payload: AgentPayload
    responseMessageId: string
}

// The harness saves the native request tool result before reaching this boundary.
// An answer overlay and its queue acknowledgement share one owner transaction.
export class AgentInputTools {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly owner: ConversationOwner,
        private readonly turn: ConversationTurn,
        private readonly continuationEpoch: number,
        private readonly ports: {
            input: (key: string) => {
                graph: AgentInput
                threadId: string
            }
            answer: (interruptId: string) => Promise<ConversationTurn | undefined>
            question: (question: string) => Promise<void>
            responseId: (answer: ConversationTurn) => string
            selectResponse: (messageId: string) => Promise<void>
        },
    ) {}

    async beforeModel(messages: BaseMessage[]): Promise<BaseMessage[]> {
        const resolved: BaseMessage[] = []

        for (const message of messages) {
            const question = this.question(message)

            if (!question) {
                resolved.push(message)

                continue
            }

            const native = message as ToolMessage
            const identity = createHash('sha256')
                .update(
                    JSON.stringify([this.turn.turnId, this.continuationEpoch, native.tool_call_id]),
                )
                .digest('hex')
            const key = `INPUT_RESULT#${identity}`
            let result = await this.repository.read<InputResult>(this.owner.partition, key)

            if (!result) {
                const {
                    graph,
                    threadId,
                } = this.ports.input(identity)
                let state = await graph.ask({
                    threadId,
                    question,
                    signal: this.owner.abort.signal,
                })
                const answer = state.interruptId ? await this.ports.answer(state.interruptId) : undefined

                if (
                    state.interruptId
                    && !answer
                ) {
                    await this.ports.question(question)

                    throw new AgentInputPending(state.interruptId)
                }

                if (answer)
                    state = await graph.ask({
                        threadId,
                        question,
                        signal: this.owner.abort.signal,
                        answer: {
                            interruptId: answer.interruptId!,
                            text: conversationMessageText(answer.fragment),
                        },
                    })

                // A crash can leave the question graph completed before the
                // atomic answer overlay. Recover its author through the run ID.
                const accepted = answer ?? (await this.ports.answer((await this.owner.read()).run?.interruptId ?? ''))

                if (
                    !accepted
                    || state.answer === undefined
                )
                    throw new Error('AGENT_INPUT_ANSWER_MISSING')

                const prepared = await this.payloads.prepare(
                    'json',
                    Buffer.from(
                        JSON.stringify({
                            status: 'completed',
                            answer: state.answer,
                        }),
                    ),
                    key,
                )
                result = {
                    payload: prepared.payload,
                    responseMessageId: this.ports.responseId(accepted),
                }
                await this.owner.completeInputAnswer(
                    accepted,
                    [
                        this.repository.put(
                            this.owner.partition,
                            key,
                            result,
                        ),
                        this.repository.replace(
                            this.owner.partition,
                            `INPUT_RESPONSE#${this.turn.turnId}`,
                            { responseMessageId: result.responseMessageId },
                        ),
                        ...prepared.operations,
                    ],
                )
            }

            await this.ports.selectResponse(result.responseMessageId)
            resolved.push(
                new ToolMessage({
                    id: native.id,
                    tool_call_id: native.tool_call_id,
                    name: native.name,
                    content: Buffer.from(await this.payloads.read(result.payload)).toString('utf8'),
                    status: 'success',
                }),
            )
        }

        return resolved
    }

    private question(message: BaseMessage): string | undefined {
        if (
            message.getType() !== 'tool'
            || (message as ToolMessage).name !== 'request_user_input'
            || typeof message.content !== 'string'
        )
            return undefined

        try {
            const value = JSON.parse(message.content)

            return value?.status === 'input-required'
                && typeof value.question === 'string'
                && value.question.trim()
                && value.question.length <= 2000
                ? value.question
                : undefined
        } catch {
            return undefined
        }
    }
}
