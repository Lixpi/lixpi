import { createHash } from 'node:crypto'
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

const INLINE_BYTES = 8000
const PAGE_BYTES = 8000
const readErrors = {
    AGENT_TOOL_RESULT_INPUT_INVALID: 'Use the exact resultId from resultReference, a string JSON pointer, format structure or json, and integer offsets and limits.',
    AGENT_TOOL_RESULT_RANGE_INVALID: 'Start at offset 0 with limit from 1 to 4000, then use the returned nextOffset. Do not guess an offset beyond the returned total.',
    AGENT_TOOL_RESULT_POINTER_INVALID: 'Use an empty pointer to read the root structure, then copy an exact pointer from its entries.',
    AGENT_TOOL_RESULT_POINTER_NOT_FOUND: 'That field does not exist. Read pointer "" with format structure, then follow the exact pointers returned in entries. Do not infer paths from a summary.',
    AGENT_TOOL_RESULT_POINTER_TOO_LARGE_USE_JSON_RANGE: 'Read a shorter parent pointer or the root with format json and follow nextOffset to retrieve character ranges.',
}

class AgentToolResultInputError extends Error {
    constructor(readonly code: keyof typeof readErrors) {
        super(code)
    }
}

const identityFields = new Set([
    'status',
    'state',
    'operationId',
    'assetId',
    'outputAssetId',
    'pipelineId',
    'sequenceId',
    'jobId',
    'revision',
    'sequenceRevision',
    'code',
])
const identityContainers = new Set([
    'data',
    'artifact',
    'pipeline',
    'sequence',
    'result',
    'error',
])

type ResultRecord = {
    resultId: string
    toolName: string
    payload: AgentPayload
}

export type AgentToolResultRead = {
    resultId: string
    pointer?: string
    offset?: number
    limit?: number
    format?: 'structure' | 'json'
}

// Full receipts stay in the native checkpoint. These immutable references only
// bound what reaches a model, and cannot be read from another context namespace.
export class AgentToolResults {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly owner: ConversationOwner,
        private readonly namespace: string,
        private readonly continuationEpoch: number,
        private readonly assertCurrent: () => Promise<void>,
    ) {}

    async messages(messages: BaseMessage[]): Promise<BaseMessage[]> {
        const bounded: BaseMessage[] = []

        for (const message of messages) {
            const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)

            if (
                message.getType() !== 'tool'
                || Buffer.byteLength(content, 'utf8') <= INLINE_BYTES
            ) {
                bounded.push(message)

                continue
            }

            await this.assertCurrent()
            const original = message as ToolMessage
            const bytes = Buffer.from(content, 'utf8')
            const resultId = createHash('sha256')
                .update(`${original.name ?? ''}\n`)
                .update(bytes)
                .digest('hex')
            const key = this.key(resultId)

            if (!(await this.repository.read(this.owner.partition, key))) {
                const prepared = await this.payloads.prepare(
                    'agent-tool-result',
                    bytes,
                    key,
                )
                await this.repository.commit([
                    ...await this.owner.fences(this.continuationEpoch),
                    this.repository.put(
                        this.owner.partition,
                        key,
                        {
                            resultId,
                            toolName: original.name ?? '',
                            payload: prepared.payload,
                        },
                    ),
                    ...prepared.operations,
                ])
            }

            const value = this.parse(content)
            const summary = this.identitySummary(value)
            bounded.push(
                new ToolMessage({
                    ...original.toDict().data,
                    id: original.id,
                    tool_call_id: original.tool_call_id,
                    name: original.name,
                    status: original.status,
                    content: JSON.stringify({
                        ...summary,
                        resultReference: {
                            resultId,
                            toolName: original.name,
                            byteSize: bytes.byteLength,
                            readTool: 'read_tool_result',
                        },
                        summaryOnly: true,
                        note: 'The complete result is stored privately. This summary omits large fields; identifiers shown here are complete. Start read_tool_result with this resultId, pointer "", and format structure to discover exact field pointers. Follow the returned entry pointers and nextOffset; do not infer omitted paths from this summary. Use format json for exact JSON character ranges.',
                        structure: this.describe(value),
                    }),
                }),
            )
        }

        return bounded
    }

    async readForModel(input: unknown): Promise<unknown> {
        try {
            return await this.read(input)
        } catch (error) {
            if (!(error instanceof AgentToolResultInputError))
                throw error

            return {
                status: 'error',
                error: {
                    code: error.code,
                    message: readErrors[error.code],
                    recoverable: true,
                },
            }
        }
    }

    async read(value: unknown): Promise<unknown> {
        await this.assertCurrent()
        await this.owner.fences(this.continuationEpoch)
        const input = this.readInput(value)
        const offset = input.offset ?? 0
        const limit = input.limit ?? (input.format === 'json' ? 2000 : 16)

        if (
            !Number.isSafeInteger(offset)
            || offset < 0
            || !Number.isSafeInteger(limit)
            || limit < 1
            || limit > 4000
        )
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_RANGE_INVALID')

        const record = await this.repository.read<ResultRecord>(
            this.owner.partition,
            this.key(input.resultId),
        )

        if (!record)
            throw new Error('AGENT_TOOL_RESULT_NOT_IN_CONTEXT')

        const text = Buffer.from(await this.payloads.read(record.payload)).toString('utf8')
        const pointer = input.pointer ?? ''

        if (Buffer.byteLength(
            JSON.stringify(pointer),
            'utf8',
        ) > 2500)
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_POINTER_TOO_LARGE_USE_JSON_RANGE')

        const selected = this.select(
            this.parse(text),
            pointer,
        )
        const raw = input.format === 'json'
            ? JSON.stringify(selected)
            : typeof selected === 'string'
                ? selected
                : undefined

        if (raw !== undefined) {
            if (offset > raw.length)
                throw new AgentToolResultInputError('AGENT_TOOL_RESULT_RANGE_INVALID')

            let end = Math.min(raw.length, offset + limit)
            const range = () => ({
                resultId: input.resultId,
                pointer,
                format: input.format ?? 'text',
                offset,
                text: raw.slice(offset, end),
                totalCharacters: raw.length,
                ...(end < raw.length ? { nextOffset: end } : {}),
            })

            while (Buffer.byteLength(
                JSON.stringify(
                    range(),
                ),
                'utf8',
            ) > PAGE_BYTES)
                end = offset + Math.floor((end - offset) / 2)

            return range()
        }

        if (
            selected === null
            || typeof selected !== 'object'
        )
            return {
                resultId: input.resultId,
                pointer: input.pointer ?? '',
                value: selected,
            }

        const entries = Object.entries(selected)

        if (offset > entries.length)
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_RANGE_INVALID')

        const page: Array<{
            key: string
            pointer: string
            value: unknown
        }> = []
        let cursor = offset

        for (const [key, field] of entries.slice(offset, offset + Math.min(limit, 32))) {
            const item = {
                key,
                pointer: `${input.pointer ?? ''}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
                value: this.describe(field),
            }

            if (Buffer.byteLength(
                JSON.stringify([...page, item]),
                'utf8',
            ) > PAGE_BYTES - 3500)
                break

            page.push(item)
            cursor++
        }

        return {
            resultId: input.resultId,
            pointer: input.pointer ?? '',
            kind: Array.isArray(selected) ? 'array' : 'object',
            entries: page,
            totalEntries: entries.length,
            ...(cursor < entries.length ? { nextOffset: cursor } : {}),
            ...(!page.length
                && offset < entries.length
                ? { note: 'This field name exceeds the structural page bound. Read this value with format json and character offsets.' }
                : {}),
        }
    }

    private readInput(value: unknown): AgentToolResultRead {
        if (
            !value
            || typeof value !== 'object'
            || Array.isArray(value)
        )
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_INPUT_INVALID')

        const input = value as Record<string, unknown>

        if (
            typeof input.resultId !== 'string'
            || !/^[a-f0-9]{64}$/.test(input.resultId)
            || (input.pointer !== undefined && typeof input.pointer !== 'string')
            || (input.offset !== undefined && typeof input.offset !== 'number')
            || (input.limit !== undefined && typeof input.limit !== 'number')
            || (input.format !== undefined && input.format !== 'structure' && input.format !== 'json')
            || Object.keys(input).some(key => !['resultId', 'pointer', 'offset', 'limit', 'format'].includes(key))
        )
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_INPUT_INVALID')

        return input as AgentToolResultRead
    }

    private identitySummary(
        value: unknown,
        depth = 0,
        budget = {
            bytes: 2500,
            fields: 32,
        },
    ): Record<string, unknown> {
        if (
            !value
            || typeof value !== 'object'
            || Array.isArray(value)
            || depth > 4
        )
            return {}

        const summary: Record<string, unknown> = {}

        for (const [key, field] of Object.entries(value)) {
            if (
                budget.fields <= 0
                || budget.bytes <= 100
            )
                break

            if (
                identityFields.has(key)
                && (typeof field === 'number' || (typeof field === 'string' && field.length <= 256))
            ) {
                const bytes = Buffer.byteLength(
                    JSON.stringify({ [key]: field }),
                    'utf8',
                )

                if (bytes > budget.bytes)
                    continue

                summary[key] = field
                budget.bytes -= bytes
                budget.fields--
            } else if (identityContainers.has(key)) {
                budget.bytes -= key.length + 5
                summary[key] = this.identitySummary(
                    field,
                    depth + 1,
                    budget,
                )
            }
        }

        return summary
    }

    private describe(value: unknown): unknown {
        if (
            typeof value === 'string'
            && value.length > 256
        )
            return {
                kind: 'string',
                characters: value.length,
                requiresRangeRead: true,
            }

        if (Array.isArray(value))
            return {
                kind: 'array',
                entries: value.length,
            }

        if (
            value
            && typeof value === 'object'
        )
            return {
                kind: 'object',
                entries: Object.keys(value).length,
            }

        return value
    }

    private select(
        value: unknown,
        pointer: string,
    ): unknown {
        if (!pointer)
            return value

        if (
            !pointer.startsWith('/')
            || pointer.length > 4096
        )
            throw new AgentToolResultInputError('AGENT_TOOL_RESULT_POINTER_INVALID')

        for (const encoded of pointer.slice(1).split('/')) {
            if (/~(?:[^01]|$)/.test(encoded))
                throw new AgentToolResultInputError('AGENT_TOOL_RESULT_POINTER_INVALID')

            const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')

            if (
                !value
                || typeof value !== 'object'
                || !Object.hasOwn(value, key)
            )
                throw new AgentToolResultInputError('AGENT_TOOL_RESULT_POINTER_NOT_FOUND')

            value = (value as Record<string, unknown>)[key]
        }

        return value
    }

    private parse(text: string): unknown {
        try {
            return JSON.parse(text)
        } catch {
            return text
        }
    }

    private key(resultId: string): string {
        return `TOOL_RESULT#${Buffer.from(this.namespace).toString('base64url')}#${resultId}`
    }
}
