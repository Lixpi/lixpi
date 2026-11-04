import {
    AIMessage,
    HumanMessage,
    ToolMessage,
    type BaseMessage,
} from '@langchain/core/messages'
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
import { AgentContext } from './agent-context.ts'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

type ContextView = {
    revision: number
    contextMode: ConversationTurn['settings']['contextMode']
    payload?: AgentPayload
}
type SavedMessage =
    | {
        kind: 'human'
        id?: string
        text: string
    }
    | {
        kind: 'assistant'
        id?: string
        text: string
    }
    | {
        kind: 'ai'
        id?: string
        calls: Array<{
            id: string
            name: string
            args: Record<string, unknown>
        }>
    }
    | {
        kind: 'tool'
        id?: string
        name?: string
        callId: string
        content: string
        status?: 'success' | 'error'
    }

export class AgentContextChanged extends Error {
    constructor() {
        super('AGENT_CONTEXT_CHANGED')
    }
}

// A context change keeps the execution and operation identities, but starts a
// clean native context and scratch namespace. Only settled action receipts and
// admissible transcript blocks cross this boundary, never generated summaries.
export class AgentContextBoundary {
    private view: ContextView

    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly owner: ConversationOwner,
        private readonly turn: ConversationTurn,
        private readonly retainedTools: ReadonlySet<string>,
    ) {
        this.view = {
            revision: turn.settingsRevision,
            contextMode: turn.settings.contextMode,
        }
    }

    async load(): Promise<void> {
        this.view = (await this.repository.read<ContextView>(
            this.owner.partition,
            this.key(),
        )) ?? this.view
    }

    effectiveTurn(): ConversationTurn {
        return {
            ...this.turn,
            settingsRevision: this.view.revision,
            settings: {
                ...this.turn.settings,
                contextMode: this.view.contextMode,
            },
        }
    }

    namespace(): string {
        return `context-${this.view.revision}-turn-${this.turn.turnId}`
    }

    async current(): Promise<boolean> {
        return (await this.owner.read()).settings.contextMode === this.view.contextMode
    }

    async assertCurrent(): Promise<void> {
        if (!(await this.current()))
            throw new AgentContextChanged()
    }

    async seed(): Promise<BaseMessage[] | undefined> {
        if (!this.view.payload)
            return undefined

        const messages = JSON.parse(
            Buffer.from(await this.payloads.read(this.view.payload)).toString('utf8'),
        ) as SavedMessage[]

        return messages.map(
            message => message.kind === 'human'
                ? new HumanMessage({
                    id: message.id,
                    content: message.text,
                })
                : message.kind === 'assistant'
                    ? new AIMessage({
                        id: message.id,
                        content: message.text,
                    })
                    : message.kind === 'ai'
                        ? new AIMessage({
                            id: message.id,
                            content: '',
                            tool_calls: message.calls,
                        })
                        : new ToolMessage({
                            id: message.id,
                            name: message.name,
                            tool_call_id: message.callId,
                            content: message.content,
                            status: message.status,
                        }),
        )
    }

    async synchronize(messages: BaseMessage[]): Promise<boolean> {
        const meta = await this.owner.read()

        if (meta.settings.contextMode === this.view.contextMode)
            return false

        await this.assertKnownModelOutcomes()
        const next: ContextView = {
            revision: meta.settingsRevision,
            contextMode: meta.settings.contextMode,
        }
        const context = new AgentContext(
            this.repository,
            this.owner,
            {
                ...this.turn,
                settingsRevision: next.revision,
                settings: {
                    ...this.turn.settings,
                    contextMode: next.contextMode,
                },
            },
            this.payloads,
        )
        await context.initialize()
        const retained: SavedMessage[] = (await context.history()).map(
            message => ({
                kind: message.getType() === 'human' ? 'human' : 'assistant',
                id: message.id,
                text: message.text,
            }),
        )
        retained.push(...this.actionReceipts(messages))
        const prepared = await this.payloads.prepare(
            'agent-context-boundary',
            Buffer.from(
                JSON.stringify(retained),
            ),
            this.key(),
        )
        const previous = await this.repository.read<ContextView>(
            this.owner.partition,
            this.key(),
        )
        const release = previous?.payload
            && previous.payload.hash !== prepared.payload.hash
            ? await this.payloads.release(
                previous.payload,
                this.key(),
            )
            : undefined
        const fences = await this.owner.fences()
        const fence = fences.find(operation => operation.type === 'check' && operation.key.sk === 'META')!
        fence.conditionExpression += ' AND #contextSettings = :contextSettings'
        fence.expressionAttributeNames = {
            ...fence.expressionAttributeNames,
            '#contextSettings': 'settingsRevision',
        }
        fence.expressionAttributeValues = {
            ...fence.expressionAttributeValues,
            ':contextSettings': meta.settingsRevision,
        }

        try {
            await this.repository.commit([
                ...fences,
                this.repository.put(
                    this.owner.partition,
                    this.key(),
                    {
                        ...next,
                        payload: prepared.payload,
                    },
                    previous?.revision,
                ),
                ...prepared.operations,
                ...release?.operations ?? [],
            ])
        } catch (error) {
            const committed = await this.repository.read<ContextView>(
                this.owner.partition,
                this.key(),
            )

            if (committed?.payload?.hash !== prepared.payload.hash) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error

                await this.owner.fences()

                return true
            }

            await this.owner.fences()
        }

        await release?.afterCommit()

        return true
    }

    private actionReceipts(messages: BaseMessage[]): SavedMessage[] {
        const results = new Map(
            messages.filter(message => message.getType() === 'tool').map(message => [(message as ToolMessage).tool_call_id, message as ToolMessage]),
        )
        const retained: SavedMessage[] = []

        for (const message of messages) {
            if (message.getType() !== 'ai')
                continue

            for (const call of (message as AIMessage).tool_calls ?? []) {
                const result = results.get(call.id!)

                if (
                    !result
                    || !this.retainedTools.has(call.name)
                )
                    continue

                retained.push({
                    kind: 'ai',
                    id: `${message.id ?? call.id}-receipt-${call.id}`,
                    calls: [{
                        id: call.id!,
                        name: call.name,
                        args: {},
                    }],
                })
                retained.push({
                    kind: 'tool',
                    id: result.id,
                    name: call.name,
                    callId: call.id!,
                    status: result.status,
                    content: call.name === 'request_user_input' ? String(result.content) : JSON.stringify(
                        this.receipt(
                            String(result.content),
                        ),
                    ),
                })
            }
        }

        return retained
    }

    private receipt(content: string): Record<string, unknown> {
        let value: unknown

        try {
            value = JSON.parse(content)
        } catch {
            return {
                status: 'recorded',
                note: 'This tool finished before the context change. Inspect its authorized output before repeating work.',
            }
        }

        const keep = (input: unknown): Record<string, unknown> => {
            if (
                !input
                || typeof input !== 'object'
                || Array.isArray(input)
            )
                return {}

            const result: Record<string, unknown> = {}

            for (const [key, field] of Object.entries(input)) {
                if (
                    ['status', 'state', 'operationId', 'sequenceId', 'pipelineId', 'jobId', 'assetId', 'outputAssetId', 'code'].includes(key)
                    && typeof field === 'string'
                    && field.length <= 256
                )
                    result[key] = field

                if (
                    ['revision', 'sequenceRevision'].includes(key)
                    && typeof field === 'number'
                    && Number.isSafeInteger(field)
                )
                    result[key] = field

                if (['data', 'error', 'sequence', 'pipeline'].includes(key))
                    result[key] = keep(field)
            }

            return result
        }

        return {
            ...keep(value),
            contextChanged: true,
        }
    }

    private async assertKnownModelOutcomes(): Promise<void> {
        const runId = (await this.owner.read()).run!.runId
        let after: string | undefined

        do {
            const page = await this.repository.query<{
                runId?: string
                occurredAt: string
                state: string
                response?: AgentPayload
            }>(
                this.owner.partition,
                'MODEL#',
                { after },
            )

            for (const row of page.items)
                if (
                    !row.response
                    && ['submitted', 'unknown'].includes(row.state)
                    && (row.runId ? row.runId === runId : Date.parse(row.occurredAt) >= this.turn.createdAt)
                )
                    throw new Error('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')

            after = page.cursor
        } while (after)

        after = undefined

        do {
            const page = await this.repository.query<{
                runId?: string
                turnId?: string
                state: string
            }>(
                this.owner.partition,
                'OPERATION#',
                { after },
            )

            for (const row of page.items)
                if (
                    row.state === 'outcome-unknown'
                    && (row.runId === runId || row.turnId === this.turn.turnId)
                )
                    throw new Error('AGENT_OPERATION_OUTCOME_UNKNOWN')

            after = page.cursor
        } while (after)
    }

    private key(): string {
        return `CONTEXT_SCOPE#${this.turn.turnId}`
    }
}
