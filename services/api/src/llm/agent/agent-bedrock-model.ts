import { createHash } from 'node:crypto'

import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import {
    type Message,
    type MessageParam,
    type MessageCreateParamsNonStreaming,
    type RawMessageStreamEvent,
    type Tool,
    type ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages'
import {
    BaseChatModel,
    type BaseChatModelCallOptions,
    type BindToolsInput,
} from '@langchain/core/language_models/chat_models'
import {
    AIMessageChunk,
    type BaseMessage,
} from '@langchain/core/messages'
import {
    ChatGenerationChunk,
    type ChatResult,
} from '@langchain/core/outputs'
import {
    type CallbackManagerForLLMRun,
} from '@langchain/core/callbacks/manager'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import {
    type AiModel,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'
import {
    type MeasuredUsage,
} from '@lixpi/usage-reporter'

import { bedrockInference } from '../providers/bedrock-inference.ts'
import { estimateInputTokens } from '../providers/provider-input-budget.ts'
import {
    type AgentModelCallInput,
} from './agent-model-calls.ts'

export type AgentBedrockModelProfile = Pick<AiModel, 'model' | 'modelVersion' | 'contextWindow' | 'maxCompletionSize' | 'inferenceCapabilities' | 'reasoningGenerationControls'> & {
    inferenceProviderCalledByThePlatform: string
}

export type AgentBedrockCallOptions = BaseChatModelCallOptions & {
    tools?: Tool[]
    emitText?: boolean
}

export type AgentBedrockTransport = {
    create: (
        request: MessageCreateParamsNonStreaming,
        signal?: AbortSignal,
    ) => Promise<Message>
    stream: (
        request: MessageCreateParamsNonStreaming,
        signal?: AbortSignal,
    ) => AsyncIterable<RawMessageStreamEvent> & { finalMessage: () => Promise<Message> }
}

export type AgentBedrockModelOptions = {
    profile: AgentBedrockModelProfile
    calls: { execute: <T>(input: AgentModelCallInput<T>) => Promise<T> }
    maxTokens: number
    reasoningEffort?: string
    region?: string
    transport?: AgentBedrockTransport
    resolveModelId?: (modelVersion: string) => Promise<string>
    onTextDelta?: (text: string) => Promise<void> | void
}

export const resolveAgentReasoningOptions = (
    profile: AgentBedrockModelProfile,
    modelId: string,
    groups: MediaGenerationConfigSelectionGroup[] = [],
): Pick<AgentBedrockModelOptions, 'reasoningEffort'> => {
    const selected = new Map<string, string>()

    for (const group of groups.filter(group => group.modelIds.includes(modelId)))
        for (const [key, value] of Object.entries(group.values)) {
            if (key !== 'reasoningEffort')
                throw new Error(`AGENT_REASONING_CONTROL_UNSUPPORTED:${key}`)

            if (
                selected.has(key)
                && selected.get(key) !== value
            )
                throw new Error('AGENT_REASONING_CONTROL_CONFLICT')

            const control = profile.reasoningGenerationControls?.find(control => control.key === key)

            if (
                !control
                || !control.options.some(option => option.value === value)
            )
                throw new Error('AGENT_REASONING_EFFORT_UNSUPPORTED')

            selected.set(key, value)
        }

    const reasoningEffort = selected.get('reasoningEffort') ?? profile.reasoningGenerationControls?.find(control => control.key === 'reasoningEffort')?.defaultValue

    if (
        reasoningEffort
        && !profile.reasoningGenerationControls?.some(
            control => control.key === 'reasoningEffort' && control.options.some(option => option.value === reasoningEffort),
        )
    )
        throw new Error('AGENT_REASONING_EFFORT_UNSUPPORTED')

    return reasoningEffort ? { reasoningEffort } : {}
}

export class AgentBedrockModel extends BaseChatModel<AgentBedrockCallOptions> {
    readonly modelName: string
    readonly profile: AgentBedrockModelProfile
    readonly maxTokens: number
    private readonly transport: AgentBedrockTransport

    constructor(private readonly options: AgentBedrockModelOptions) {
        super({
            maxRetries: 0,
            cache: false,
        })
        this.profile = structuredClone(options.profile)
        this.modelName = options.profile.modelVersion
        this.maxTokens = options.maxTokens

        if (this.profile.inferenceProviderCalledByThePlatform !== 'aws-bedrock')
            throw new Error('AGENT_MODEL_REQUIRES_BEDROCK_ROUTE')

        if (
            !Number.isSafeInteger(options.maxTokens)
            || options.maxTokens < 1
            || options.maxTokens > this.profile.maxCompletionSize
        )
            throw new Error('AGENT_MODEL_COMPLETION_LIMIT_INVALID')

        if (
            !Number.isSafeInteger(this.profile.contextWindow)
            || this.profile.contextWindow <= options.maxTokens
        )
            throw new Error('AGENT_MODEL_CONTEXT_LIMIT_INVALID')

        if (!this.profile.inferenceCapabilities)
            throw new Error('AGENT_MODEL_CAPABILITIES_REQUIRED')

        if (
            options.reasoningEffort
            && !this.profile.reasoningGenerationControls?.find(control => control.key === 'reasoningEffort')?.options.some(
                option => option.value === options.reasoningEffort,
            )
        )
            throw new Error('AGENT_MODEL_REASONING_EFFORT_UNSUPPORTED')

        if (options.transport)
            this.transport = options.transport
        else {
            const client = new AnthropicBedrock({
                awsRegion: options.region ?? bedrockInference.region,
                maxRetries: 0,
            })
            this.transport = {
                create: async (request, signal) => await client.messages.create(request, { signal }),
                stream: (request, signal) => client.messages.stream(request, { signal }),
            }
        }
    }

    _llmType(): string {
        return 'lixpi-bedrock'
    }

    override get callKeys(): string[] {
        return [...super.callKeys, 'tools', 'emitText']
    }

    override bindTools(
        tools: BindToolsInput[],
        kwargs: Partial<AgentBedrockCallOptions> = {},
    ) {
        const nativeTools = tools.map(tool => {
            const native = tool as {
                name?: string
                description?: string
                input_schema?: Tool['input_schema']
            }

            if (
                native.name
                && native.input_schema
            )
                return {
                    name: native.name,
                    description: native.description,
                    input_schema: structuredClone(native.input_schema),
                }

            const formatted = convertToOpenAITool(tool)

            return {
                name: formatted.function.name,
                description: formatted.function.description,
                input_schema: formatted.function.parameters as Tool['input_schema'],
            }
        })

        if (this.profile.inferenceCapabilities.requiresClosedJsonSchema) {
            for (const tool of nativeTools)
                assertClosedSchema(tool.input_schema)
        }

        return this.withConfig({
            ...kwargs,
            tools: nativeTools,
        })
    }

    async _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): Promise<ChatResult> {
        const native = await this.call(
            messages,
            options,
            this.options.onTextDelta
                || runManager
                ? async event => {
                    if (
                        event.type === 'content_block_delta'
                        && event.delta.type === 'text_delta'
                    ) {
                        if (options.emitText !== false)
                            await this.options.onTextDelta?.(event.delta.text)

                        await runManager?.handleLLMNewToken(event.delta.text)
                    }
                }
                : undefined,
        )
        const message = toAgentMessage(native)

        return {
            generations: [{
                text: visibleText(native),
                message,
            }],
            llmOutput: {
                tokenUsage: measuredUsage(native),
                stopReason: native.stop_reason,
            },
        }
    }

    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
    ): AsyncGenerator<ChatGenerationChunk> {
        const abort = new AbortController()
        const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
        const queue = new AgentChunkQueue()
        let emitted = false
        const produce = async (): Promise<void> => {
            try {
                const native = await this.call(
                    messages,
                    {
                        ...options,
                        signal,
                    },
                    async event => {
                        emitted = true
                        const chunk = chunkFromEvent(event)

                        if (!chunk)
                            return

                        queue.push(chunk)

                        if (chunk.text) {
                            if (options.emitText !== false)
                                await this.options.onTextDelta?.(chunk.text)

                            await runManager?.handleLLMNewToken(chunk.text)
                        }
                    },
                )
                queue.push(
                    new ChatGenerationChunk({
                        text: emitted ? '' : visibleText(native),
                        message: emitted ? new AIMessageChunk({
                            content: '',
                            id: native.id,
                            additional_kwargs: { anthropic: { content: native.content } },
                            response_metadata: {
                                stop_reason: native.stop_reason,
                                model: native.model,
                            },
                            usage_metadata: langchainUsage(native),
                        }) : toAgentMessage(native),
                    }),
                )
                queue.finish()
            } catch (error) {
                queue.finish(error)
            }
        }
        const pending = produce()

        try {
            for await (const chunk of queue)
                yield chunk

            await pending
        } finally {
            abort.abort()
            await pending
        }
    }

    private async call(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        onEvent?: (event: RawMessageStreamEvent) => Promise<void>,
    ): Promise<Message> {
        options.signal?.throwIfAborted()
        const converted = convertAgentMessages(messages, this.profile)
        const model = await (this.options.resolveModelId ?? (async version => await bedrockInference.resolveModelId('anthropic', version)))(this.modelName)
        const request: MessageCreateParamsNonStreaming = {
            model,
            messages: converted.messages,
            max_tokens: this.options.maxTokens,
            ...(converted.system.length ? { system: converted.system } : {}),
            ...(options.tools?.length ? { tools: options.tools } : {}),
            ...(options.stop?.length ? { stop_sequences: options.stop } : {}),
            ...(this.profile.inferenceCapabilities.thinkingMode === 'anthropic-adaptive' ? { thinking: { type: 'adaptive' } } : {}),
            ...(this.options.reasoningEffort ? { output_config: { effort: this.options.reasoningEffort as NonNullable<MessageCreateParamsNonStreaming['output_config']>['effort'] } } : {}),
        }

        if (
            options.tool_choice
            && options.tools?.length
        ) {
            const choice = typeof options.tool_choice === 'string'
                ? ['auto', 'any', 'none'].includes(options.tool_choice)
                    ? { type: options.tool_choice }
                    : {
                        type: 'tool',
                        name: options.tool_choice,
                    }
                : options.tool_choice

            if (
                this.profile.inferenceCapabilities.requiresAutoToolChoiceWithThinking
                && choice.type !== 'auto'
                && choice.type !== 'none'
            )
                throw new Error('AGENT_MODEL_FORCED_TOOL_CHOICE_UNSUPPORTED')

            request.tool_choice = choice as MessageCreateParamsNonStreaming['tool_choice']
        }

        const estimatedUnits = estimateInputTokens(request).inputTokens + this.options.maxTokens

        if (estimatedUnits > this.profile.contextWindow)
            throw new Error('MODEL_INPUT_CONTEXT_EXCEEDED')

        const requestKey = createHash('sha256').update(
            JSON.stringify(
                canonicalize({
                    request,
                    messageIds: messages.map(message => message.id ?? null),
                }),
            ),
        ).digest('hex')

        return await this.options.calls.execute({
            requestKey,
            modelId: this.profile.modelVersion,
            estimatedUnits,
            invoke: async observe => {
                options.signal?.throwIfAborted()
                let response: Message

                if (onEvent) {
                    const stream = this.transport.stream(request, options.signal)
                    let partial: Pick<Message, 'id' | 'usage'> | undefined

                    for await (const event of stream) {
                        if (event.type === 'message_start')
                            partial = {
                                id: event.message.id,
                                usage: event.message.usage,
                            }

                        if (
                            event.type === 'message_delta'
                            && partial
                        ) {
                            partial.usage = {
                                ...partial.usage,
                                ...event.usage,
                            }

                            if (event.delta.stop_reason)
                                observe(
                                    measuredUsage(partial),
                                    partial.id,
                                )
                        }

                        options.signal?.throwIfAborted()
                        await onEvent(event)
                    }

                    response = await stream.finalMessage()
                } else
                    response = await this.transport.create(request, options.signal)

                observe(
                    measuredUsage(response),
                    response.id,
                )

                return response
            },
        })
    }
}

export const convertAgentMessages = (
    messages: BaseMessage[],
    profile: AgentBedrockModelProfile,
): {
    system: string
    messages: MessageParam[]
} => {
    const system: string[] = []
    const converted: MessageParam[] = []
    const pendingTools = new Set<string>()
    const append = (
        role: 'user' | 'assistant',
        content: ContentBlockParam[],
    ): void => {
        const last = converted.at(-1)

        if (last?.role === role)
            last.content = [...(last.content as ContentBlockParam[]), ...content]
        else
            converted.push({
                role,
                content,
            })
    }

    for (const message of messages) {
        const type = message.getType()

        if (type === 'system') {
            if (!profile.inferenceCapabilities.supportsSystemPrompt)
                throw new Error('AGENT_MODEL_SYSTEM_PROMPT_UNSUPPORTED')

            if (typeof message.content !== 'string')
                throw new Error('AGENT_MODEL_SYSTEM_CONTENT_INVALID')

            system.push(message.content)

            continue
        }

        if (type === 'tool') {
            const toolMessage = message as BaseMessage & {
                tool_call_id: string
                status?: string
            }

            if (!pendingTools.delete(toolMessage.tool_call_id))
                throw new Error('AGENT_MODEL_TOOL_RESULT_UNPAIRED')

            append(
                'user',
                [{
                    type: 'tool_result',
                    tool_use_id: toolMessage.tool_call_id,
                    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
                    is_error: toolMessage.status === 'error',
                }],
            )

            continue
        }

        if (pendingTools.size)
            throw new Error('AGENT_MODEL_TOOL_RESULT_MISSING')

        if (type === 'ai') {
            const native = (message.additional_kwargs.anthropic as { content?: ContentBlockParam[] } | undefined)?.content
            const ai = message as BaseMessage & {
                tool_calls?: Array<{
                    id?: string
                    name: string
                    args: Record<string, unknown>
                }>
            }
            const blocks: ContentBlockParam[] = native ? structuredClone(native) : textAndMediaBlocks(message.content, profile)

            if (!native) {
                for (const call of ai.tool_calls ?? []) {
                    if (!call.id)
                        throw new Error('AGENT_MODEL_TOOL_CALL_ID_REQUIRED')

                    blocks.push({
                        type: 'tool_use',
                        id: call.id,
                        name: call.name,
                        input: call.args,
                    })
                }
            }

            for (const block of blocks) {
                if (block.type === 'tool_use') {
                    if (pendingTools.has(block.id))
                        throw new Error('AGENT_MODEL_TOOL_CALL_ID_DUPLICATE')

                    pendingTools.add(block.id)
                }
            }

            append('assistant', blocks)

            continue
        }

        if (type !== 'human')
            throw new Error('AGENT_MODEL_MESSAGE_ROLE_UNSUPPORTED')

        append(
            'user',
            textAndMediaBlocks(message.content, profile),
        )
    }

    if (pendingTools.size)
        throw new Error('AGENT_MODEL_TOOL_RESULT_MISSING')

    return {
        system: system.join('\n\n'),
        messages: converted,
    }
}

const textAndMediaBlocks = (
    content: BaseMessage['content'],
    profile: AgentBedrockModelProfile,
): ContentBlockParam[] => {
    if (typeof content === 'string')
        return [{
            type: 'text',
            text: content,
        }]

    return content.map(block => {
        if (
            block.type === 'text'
            && typeof block.text === 'string'
        )
            return {
                type: 'text',
                text: block.text,
            }

        let source = block.source as Record<string, unknown> | undefined

        if (block.type === 'image_url') {
            const url = typeof block.image_url === 'string' ? block.image_url : (block.image_url as { url?: string })?.url
            const match = url?.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-zA-Z0-9+/=]+)$/u)

            if (!match)
                throw new Error('AGENT_MODEL_IMAGE_MUST_BE_RESOLVED')

            source = {
                type: 'base64',
                media_type: match[1],
                data: match[2],
            }
        }

        if (
            (block.type === 'image' || block.type === 'image_url')
            && source?.type === 'base64'
            && typeof source.data === 'string'
            && /^image\/(?:png|jpeg|gif|webp)$/u.test(
                String(source.media_type),
            )
        ) {
            if (!profile.inferenceCapabilities.supportedInputKinds.includes('image'))
                throw new Error('AGENT_MODEL_IMAGE_UNSUPPORTED')

            return {
                type: 'image',
                source,
            } as ContentBlockParam
        }

        if (
            block.type === 'document'
            && source?.type === 'text'
            && typeof source.data === 'string'
            && source.media_type === 'text/plain'
        ) {
            if (!profile.inferenceCapabilities.supportedInputKinds.includes('document-text'))
                throw new Error('AGENT_MODEL_DOCUMENT_UNSUPPORTED')

            return {
                type: 'document',
                source,
            } as ContentBlockParam
        }

        throw new Error(`AGENT_MODEL_CONTENT_BLOCK_UNSUPPORTED:${block.type}`)
    })
}

const visibleText = (native: Message): string => native.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
const measuredUsage = (native: Pick<Message, 'usage'>): MeasuredUsage => ({
    promptTokens: native.usage.input_tokens + (native.usage.cache_read_input_tokens ?? 0) + (native.usage.cache_creation_input_tokens ?? 0),
    completionTokens: native.usage.output_tokens,
    ...(native.usage.cache_read_input_tokens ? { cachedTokens: native.usage.cache_read_input_tokens } : {}),
})
const langchainUsage = (native: Message) => {
    const usage = measuredUsage(native)

    return {
        input_tokens: usage.promptTokens!,
        output_tokens: usage.completionTokens!,
        total_tokens: usage.promptTokens! + usage.completionTokens!,
    }
}
const toAgentMessage = (native: Message): AIMessageChunk =>
    new AIMessageChunk({
        id: native.id,
        content: visibleText(native),
        additional_kwargs: { anthropic: { content: native.content } },
        tool_calls: native.content.flatMap(
            block =>
                block.type === 'tool_use' ? [{
                    id: block.id,
                    name: block.name,
                    args: block.input as Record<string, unknown>,
                    type: 'tool_call' as const,
                }] : [],
        ),
        response_metadata: {
            stop_reason: native.stop_reason,
            model: native.model,
        },
        usage_metadata: langchainUsage(native),
    })
const chunkFromEvent = (event: RawMessageStreamEvent): ChatGenerationChunk | undefined => {
    if (
        event.type === 'content_block_delta'
        && event.delta.type === 'text_delta'
    )
        return new ChatGenerationChunk({
            text: event.delta.text,
            message: new AIMessageChunk({ content: event.delta.text }),
        })

    if (
        event.type === 'content_block_start'
        && event.content_block.type === 'tool_use'
    )
        return new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
                content: '',
                tool_call_chunks: [{
                    index: event.index,
                    id: event.content_block.id,
                    name: event.content_block.name,
                    args: '',
                    type: 'tool_call_chunk',
                }],
            }),
        })

    if (
        event.type === 'content_block_delta'
        && event.delta.type === 'input_json_delta'
    )
        return new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
                content: '',
                tool_call_chunks: [{
                    index: event.index,
                    args: event.delta.partial_json,
                    type: 'tool_call_chunk',
                }],
            }),
        })

    return undefined
}
const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value))
        return value.map(canonicalize)

    if (
        value
        && typeof value === 'object'
    )
        return Object.fromEntries(
            Object.keys(value)
                .sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])]),
        )

    return value
}

const assertClosedSchema = (value: unknown): void => {
    if (
        !value
        || typeof value !== 'object'
    )
        return

    if (Array.isArray(value)) {
        for (const child of value)
            assertClosedSchema(child)

        return
    }

    const schema = value as Record<string, unknown>

    if (
        schema.type === 'object'
        && schema.additionalProperties !== false
    )
        throw new Error('AGENT_MODEL_CLOSED_TOOL_SCHEMA_REQUIRED')

    for (const child of Object.values(schema))
        assertClosedSchema(child)
}

class AgentChunkQueue implements AsyncIterable<ChatGenerationChunk> {
    private readonly values: ChatGenerationChunk[] = []
    private wake?: () => void
    private done = false
    private error?: unknown

    push(value: ChatGenerationChunk): void {
        this.values.push(value)
        this.wake?.()
    }

    finish(error?: unknown): void {
        this.done = true
        this.error = error
        this.wake?.()
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<ChatGenerationChunk> {
        while (
            !this.done
            || this.values.length
        ) {
            if (this.values.length)
                yield this.values.shift()!
            else
                await new Promise<void>(resolve => void (this.wake = resolve))
        }

        if (this.error)
            throw this.error
    }
}
