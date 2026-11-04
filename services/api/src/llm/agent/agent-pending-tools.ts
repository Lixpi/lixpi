import {
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

export type ConversationMediaOperations = {
    get?: (
        owner: ConversationOwner,
        operationId: string,
    ) => Promise<unknown>
    cancelOperation?: (
        owner: ConversationOwner,
        operationId: string,
    ) => Promise<unknown>
    advance: (owner: ConversationOwner) => Promise<{
        pending: boolean
        completed: Array<{
            operationId: string
            result: unknown
        }>
    }>
    acknowledge: (
        owner: ConversationOwner,
        operationId: string,
    ) => Promise<void>
    cancel: (owner: ConversationOwner) => Promise<void>
}

type ContinuationRecord = {
    operationId: string
    continuationEpoch: number
    payload: AgentPayload
}

export class AgentToolsPending extends Error {
    constructor() {
        super('AGENT_TOOLS_PENDING')
    }
}

// Completion overlays replace the original native tool result by tool_call_id.
// They are persisted before acknowledgment and reapplied on every model attempt,
// including recovery of a checkpoint that still contains the pending receipt.
export class AgentPendingTools {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly owner: ConversationOwner,
        private readonly continuationEpoch: number,
        private readonly operations?: ConversationMediaOperations,
    ) {}

    async beforeModel(messages: BaseMessage[]): Promise<BaseMessage[]> {
        const progress = await this.operations?.advance(this.owner)

        for (const completed of progress?.completed ?? []) {
            const key = this.key(completed.operationId)

            if (!(await this.repository.read(this.owner.partition, key))) {
                const prepared = await this.payloads.prepare(
                    'json',
                    Buffer.from(
                        JSON.stringify(completed.result),
                    ),
                    key,
                )
                await this.repository.commit([
                    ...await this.owner.fences(this.continuationEpoch),
                    this.repository.put(
                        this.owner.partition,
                        key,
                        {
                            operationId: completed.operationId,
                            continuationEpoch: this.continuationEpoch,
                            payload: prepared.payload,
                        },
                    ),
                    ...prepared.operations,
                ])
            }

            await this.operations!.acknowledge(this.owner, completed.operationId)
        }

        const resolved: BaseMessage[] = []
        let waiting = progress?.pending ?? false

        for (const message of messages) {
            const operationId = this.pendingOperation(message)

            if (!operationId) {
                resolved.push(message)

                continue
            }

            const completion = await this.repository.read<ContinuationRecord>(
                this.owner.partition,
                this.key(operationId),
            )

            if (
                !completion
                || completion.continuationEpoch !== this.continuationEpoch
            ) {
                waiting = true
                resolved.push(message)

                continue
            }

            const original = message as ToolMessage
            resolved.push(
                new ToolMessage({
                    id: original.id,
                    tool_call_id: original.tool_call_id,
                    name: original.name,
                    content: Buffer.from(await this.payloads.read(completion.payload)).toString('utf8'),
                    status: 'success',
                }),
            )
        }

        if (waiting)
            throw new AgentToolsPending()

        return resolved
    }

    private pendingOperation(message: BaseMessage): string | undefined {
        if (
            message.getType() !== 'tool'
            || typeof message.content !== 'string'
        )
            return undefined

        try {
            const receipt = JSON.parse(message.content)

            return receipt?.status === 'pending'
                && typeof receipt.operationId === 'string'
                ? receipt.operationId
                : undefined
        } catch {
            return undefined
        }
    }

    private key(operationId: string): string {
        return `CONTINUATION#${this.continuationEpoch}#${operationId}`
    }
}
