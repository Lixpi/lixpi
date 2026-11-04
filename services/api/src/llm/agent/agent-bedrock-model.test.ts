import { describe, expect, it, vi } from 'vitest'
import { AIMessage, type AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { DynamicStructuredTool, tool } from '@langchain/core/tools'
import { z } from 'zod'
import { type Message, type RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { MediaSequencePipelineOperations, MediaSequenceService, mediaPipelineSaveInputSchema, type MediaPipelineSaveInput } from '@lixpi/capability-system/backend'
import { defaultSequenceAudio, defaultSequenceTransform, ticksToSeconds, type MediaSequence } from '@lixpi/capability-system/shared'

import { AgentBedrockModel, convertAgentMessages, resolveAgentReasoningOptions, type AgentBedrockModelProfile, type AgentBedrockTransport } from './agent-bedrock-model.ts'
import { AgentScopedBackend, classifyIntent, createAgentHarness, type AgentScratchFile } from './agent-harness.ts'
import { AgentPendingTools } from './agent-pending-tools.ts'
import { AgentToolResults } from './agent-tool-results.ts'
import { ConversationCheckpointSaver } from './conversation-checkpoint-saver.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const profile: AgentBedrockModelProfile = {
    model: 'selected-model',
    modelVersion: 'selected-version',
    contextWindow: 100_000,
    maxCompletionSize: 4096,
    inferenceProviderCalledByThePlatform: 'aws-bedrock',
    inferenceCapabilities: {
        thinkingMode: 'anthropic-adaptive',
        requiresAutoToolChoiceWithThinking: true,
        supportsTemperature: false,
        supportsSystemPrompt: true,
        requiresClosedJsonSchema: false,
        supportedInputKinds: ['image', 'document-text'],
    },
}
const response = (content: Message['content'] = [{
    type: 'text',
    text: 'A visible answer.',
}]): Message => ({
    id: 'response-1',
    type: 'message',
    role: 'assistant',
    model: 'bedrock-model',
    content,
    stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
    },
} as Message)

const eventsFor = (native: Message): RawMessageStreamEvent[] => [
    {
        type: 'message_start',
        message: {
            ...native,
            content: [],
        },
    },
    ...native.content.flatMap((block, index) => {
        if (block.type === 'text')
            return [{
                type: 'content_block_delta',
                index,
                delta: {
                    type: 'text_delta',
                    text: block.text,
                },
            }] as RawMessageStreamEvent[]

        if (block.type === 'tool_use') {
            const json = JSON.stringify(block.input)

            return [
                {
                    type: 'content_block_start',
                    index,
                    content_block: {
                        ...block,
                        input: {},
                    },
                },
                {
                    type: 'content_block_delta',
                    index,
                    delta: {
                        type: 'input_json_delta',
                        partial_json: json.slice(0, 5),
                    },
                },
                {
                    type: 'content_block_delta',
                    index,
                    delta: {
                        type: 'input_json_delta',
                        partial_json: json.slice(5),
                    },
                },
            ] as RawMessageStreamEvent[]
        }

        return [{
            type: 'content_block_start',
            index,
            content_block: block,
        }] as RawMessageStreamEvent[]
    }),
    {
        type: 'message_delta',
        delta: {
            stop_reason: native.stop_reason,
            stop_sequence: null,
        },
        usage: { output_tokens: native.usage.output_tokens },
    },
    { type: 'message_stop' },
] as RawMessageStreamEvent[]

class ModelFixture {
    replies = [response()]
    observations: unknown[] = []
    readonly requests: unknown[] = []
    readonly transport: AgentBedrockTransport = {
        create: vi.fn(async request => {
            this.requests.push(request)

            return this.replies.shift() ?? response()
        }),
        stream: vi.fn(request => {
            this.requests.push(request)
            const native = this.replies.shift() ?? response()

            return {
                async *[Symbol.asyncIterator]() {
                    for (const event of eventsFor(native))
                        yield event
                },
                finalMessage: async () => native,
            }
        }),
    }
    readonly calls = { execute: vi.fn(async input => await input.invoke((usage, requestId) => this.observations.push({
        usage,
        requestId,
    }))) }
    readonly model = new AgentBedrockModel({
        profile,
        calls: this.calls,
        maxTokens: 1024,
        transport: this.transport,
        resolveModelId: async () => 'aws-profile-model',
    })
}

describe('AgentBedrockModel', () => {
    it('preserves explicit reasoning controls and rejects unsupported or conflicting preferences', () => {
        const configured = {
            ...profile,
            reasoningGenerationControls: [{
                key: 'reasoningEffort' as const,
                label: 'Effort',
                kind: 'segmented' as const,
                defaultValue: 'high',
                options: [{
                    value: 'low',
                    label: 'Low',
                }, {
                    value: 'high',
                    label: 'High',
                }],
            }],
        }
        const selection = {
            groupId: 'reasoning',
            modelIds: ['Anthropic:selected-model'],
            values: { reasoningEffort: 'low' },
        }
        expect(resolveAgentReasoningOptions(configured, 'Anthropic:selected-model')).toEqual({ reasoningEffort: 'high' })
        expect(resolveAgentReasoningOptions(configured, 'Anthropic:selected-model', [selection])).toEqual({ reasoningEffort: 'low' })
        expect(() => resolveAgentReasoningOptions(profile, 'Anthropic:selected-model', [selection])).toThrow('AGENT_REASONING_EFFORT_UNSUPPORTED')
        expect(() => resolveAgentReasoningOptions(configured, 'Anthropic:selected-model', [selection, {
            ...selection,
            values: { reasoningEffort: 'high' },
        }])).toThrow('AGENT_REASONING_CONTROL_CONFLICT')
        expect(() => resolveAgentReasoningOptions(configured, 'Anthropic:selected-model', [{
            ...selection,
            values: { reasoningMode: 'enabled' },
        }])).toThrow('AGENT_REASONING_CONTROL_UNSUPPORTED:reasoningMode')
    })
    it('uses one metered provider call and records final native response usage', async () => {
        const fixture = new ModelFixture()
        const result = await fixture.model.invoke([new HumanMessage('A request.')])
        expect(result.content).toBe('A visible answer.')
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
        expect(fixture.calls.execute).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'selected-version' }))
        expect(fixture.requests).toHaveLength(1)
        expect(fixture.requests[0]).toMatchObject({
            model: 'aws-profile-model',
            thinking: { type: 'adaptive' },
        })
        expect(fixture.observations.at(-1)).toEqual({
            requestId: 'response-1',
            usage: {
                promptTokens: 15,
                completionTokens: 20,
                cachedTokens: 3,
            },
        })
        expect(result.response_metadata.stop_reason).toBe('end_turn')
    })

    it('assembles streamed tool calls without exposing native thinking', async () => {
        const fixture = new ModelFixture()
        const native = response([
            {
                type: 'thinking',
                thinking: 'Private content.',
                signature: 'signed-content',
            },
            {
                type: 'text',
                text: 'Visible.',
            },
            {
                type: 'tool_use',
                id: 'tool-1',
                name: 'inspect_input',
                input: { assetId: 'asset-1' },
            },
        ])
        fixture.replies = [native]
        let aggregate: AIMessageChunk | undefined
        const stream = await fixture.model.stream([new HumanMessage('Inspect the input.')])

        for await (const chunk of stream)
            aggregate = aggregate ? aggregate.concat(chunk) : chunk

        expect(aggregate?.content).toBe('Visible.')
        expect(aggregate?.tool_calls).toEqual([{
            id: 'tool-1',
            name: 'inspect_input',
            args: { assetId: 'asset-1' },
            type: 'tool_call',
        }])
        expect(aggregate?.additional_kwargs.anthropic).toEqual({ content: native.content })
        const converted = convertAgentMessages([new HumanMessage('Inspect.'), aggregate!, new ToolMessage({
            tool_call_id: 'tool-1',
            content: 'Authorized evidence.',
        })], profile)
        expect(converted.messages[1].content).toEqual(native.content)
        expect(converted.messages[2].content).toMatchObject([{
            type: 'tool_result',
            tool_use_id: 'tool-1',
        }])
    })

    it('replays a durable response as a completed stream without another transport call', async () => {
        const fixture = new ModelFixture()
        const native = response([{
            type: 'tool_use',
            id: 'tool-1',
            name: 'inspect_input',
            input: {},
        }])
        fixture.calls.execute = vi.fn(async () => native)
        const model = new AgentBedrockModel({
            profile,
            maxTokens: 1024,
            calls: fixture.calls,
            transport: fixture.transport,
            resolveModelId: async () => 'aws-model',
        })
        const chunks: AIMessageChunk[] = []

        for await (const chunk of await model.stream('Read the source.'))
            chunks.push(chunk)

        expect(chunks.at(-1)?.tool_calls?.[0].id).toBe('tool-1')
        expect(fixture.transport.stream).not.toHaveBeenCalled()
    })

    it('rejects unsupported routes, unmatched tools, and remote media before provider calls', async () => {
        const fixture = new ModelFixture()
        expect(() => new AgentBedrockModel({
            profile: {
                ...profile,
                inferenceProviderCalledByThePlatform: 'direct',
            },
            maxTokens: 1024,
            calls: fixture.calls,
            transport: fixture.transport,
        })).toThrow('AGENT_MODEL_REQUIRES_BEDROCK_ROUTE')
        await expect(fixture.model.invoke([new ToolMessage({
            tool_call_id: 'forged',
            content: 'Unpaired.',
        })])).rejects.toThrow('AGENT_MODEL_TOOL_RESULT_UNPAIRED')
        await expect(fixture.model.invoke([new AIMessage({
            content: '',
            tool_calls: [{
                id: 'missing',
                name: 'inspect_input',
                args: {},
            }],
        })])).rejects.toThrow('AGENT_MODEL_TOOL_RESULT_MISSING')
        await expect(fixture.model.invoke([new HumanMessage({ content: [{
            type: 'image_url',
            image_url: { url: 'https://untrusted.invalid/image' },
        }] })])).rejects.toThrow('AGENT_MODEL_IMAGE_MUST_BE_RESOLVED')
        expect(fixture.calls.execute).not.toHaveBeenCalled()
    })

    it('rejects context overflow and incompatible forced tool choices before authorization', async () => {
        const fixture = new ModelFixture()
        await expect(fixture.model.invoke('x'.repeat(400_000))).rejects.toThrow('MODEL_INPUT_CONTEXT_EXCEEDED')
        await expect(fixture.model.bindTools([{
            name: 'read_input',
            input_schema: {
                type: 'object',
                properties: {},
            },
        }], { tool_choice: 'any' }).invoke('Read.')).rejects.toThrow('AGENT_MODEL_FORCED_TOOL_CHOICE_UNSUPPORTED')
        expect(fixture.calls.execute).not.toHaveBeenCalled()
    })

    it('preserves terminal measured usage when the transport disconnects after the stop event', async () => {
        const fixture = new ModelFixture()
        fixture.transport.stream = vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                for (const event of eventsFor(response()))
                    yield event

                throw new Error('Connection lost')
            },
            finalMessage: async () => response(),
        }))
        await expect((async () => {
            for await (const _chunk of await fixture.model.stream('Answer.')) {}
        })()).rejects.toThrow('Connection lost')
        expect(fixture.observations.at(-1)).toMatchObject({ usage: {
            promptTokens: 15,
            completionTokens: 20,
        } })
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
    })

    it('observes abort without retrying a partial provider response', async () => {
        const fixture = new ModelFixture()
        const abort = new AbortController()
        fixture.transport.stream = vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                yield eventsFor(response())[0]
                abort.abort()
                yield eventsFor(response())[1]
            },
            finalMessage: async () => response(),
        }))
        await expect((async () => {
            for await (const _chunk of await fixture.model.stream('Answer.', { signal: abort.signal })) {}
        })()).rejects.toThrow()
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
        expect(fixture.observations).toEqual([])
    })

    it('enforces synchronized effort options and closed tool schema requirements', () => {
        const fixture = new ModelFixture()
        expect(() => new AgentBedrockModel({
            profile,
            maxTokens: 1024,
            reasoningEffort: 'unsupported',
            calls: fixture.calls,
            transport: fixture.transport,
        })).toThrow('AGENT_MODEL_REASONING_EFFORT_UNSUPPORTED')
        const model = new AgentBedrockModel({
            profile: {
                ...profile,
                inferenceCapabilities: {
                    ...profile.inferenceCapabilities,
                    requiresClosedJsonSchema: true,
                },
            },
            maxTokens: 1024,
            calls: fixture.calls,
            transport: fixture.transport,
        })
        expect(() => model.bindTools([{
            name: 'read',
            input_schema: {
                type: 'object',
                properties: {},
            },
        }])).toThrow('AGENT_MODEL_CLOSED_TOOL_SCHEMA_REQUIRED')
    })
})

describe('structured intent boundary', () => {
    it.each(['chat', 'inspect', 'plan', 'execute'] as const)('validates a %s classification through one metered call', async intent => {
        const fixture = new ModelFixture()
        fixture.replies = [response([{
            type: 'tool_use',
            id: 'intent',
            name: 'classify_intent',
            input: {
                intent,
                operationFamilies: intent === 'chat' ? [] : ['image'],
                targetAssetIds: ['asset-1'],
                confidence: 0.99,
                needsClarification: false,
            },
        }])]
        const result = await classifyIntent(fixture.model, {
            acceptedMessageId: 'user-message',
            instruction: 'The accepted instruction.',
            operationFamilies: ['image'],
            explicitTargetAssetIds: ['asset-1'],
        })
        expect(result.intent).toBe(intent)
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
        expect((fixture.requests[0] as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)).toEqual(['classify_intent'])

        if (intent === 'chat')
            expect(result.targetAssetIds).toEqual([])
    })

    it('cannot expand the supplied family or target allowlist', async () => {
        const fixture = new ModelFixture()
        fixture.replies = [response([{
            type: 'tool_use',
            id: 'intent',
            name: 'classify_intent',
            input: {
                intent: 'execute',
                operationFamilies: ['outside-family'],
                targetAssetIds: ['other-account'],
                confidence: 1,
                needsClarification: false,
            },
        }])]
        expect(await classifyIntent(fixture.model, {
            acceptedMessageId: 'user-message',
            instruction: 'The accepted instruction.',
            operationFamilies: ['image'],
            explicitTargetAssetIds: ['asset-1'],
        })).toMatchObject({
            intent: 'chat',
            needsClarification: true,
            operationFamilies: [],
            targetAssetIds: [],
        })
    })

    it('classifies running the saved local two-step plan from its required families without granting omitted or prohibited work', async () => {
        const fixture = new ModelFixture()
        const input = {
            acceptedMessageId: 'run-blue-hold',
            instruction: 'Run the saved Blue hold pipeline now and export its MP4. Use its frozen existing image and corrected five-second 320 by 180 settings. No AI image, audio or video generation; local assembly and export only.',
            operationFamilies: ['image', 'video', 'sequence-edit', 'sequence-export'],
            explicitTargetAssetIds: ['blue-pipeline', 'blue-image'],
            familyDescriptions: [
                {
                    family: 'video',
                    description: 'AI video generation.',
                },
                {
                    family: 'sequence-edit',
                    description: 'Create or edit a local sequence using existing media.',
                },
                {
                    family: 'sequence-export',
                    description: 'Render a local sequence to MP4, WAV or MP3.',
                },
            ],
            executionTargets: [{
                assetId: 'blue-pipeline',
                title: 'Blue hold',
                artifactTypeId: 'media-pipeline',
                revision: 5,
                operationKeys: ['sequence.create', 'sequence.export'],
                requiredOperationFamilies: ['sequence-edit', 'sequence-export'],
                unavailableOperationKeys: [],
            }],
        }
        const reply = (families: string[]) => response([{
            type: 'tool_use',
            id: 'intent',
            name: 'classify_intent',
            input: {
                intent: 'execute',
                operationFamilies: families,
                targetAssetIds: ['blue-pipeline'],
                confidence: 0.95,
                needsClarification: false,
            },
        }])
        fixture.replies = [reply(['sequence-edit', 'sequence-export'])]
        expect(await classifyIntent(fixture.model, input)).toMatchObject({
            intent: 'execute',
            operationFamilies: ['sequence-edit', 'sequence-export'],
            targetAssetIds: ['blue-pipeline'],
        })
        const request = fixture.requests[0] as {
            system: string
            messages: Array<{ content: Array<{ text?: string }> }>
        }
        const facts = JSON.parse(request.messages[0].content[0].text!)
        expect(facts.executionTargets).toEqual(input.executionTargets)
        expect(facts.familyDescriptions).toEqual(input.familyDescriptions)
        expect(request.system).toContain('cannot grant permission or override a prohibition')
        fixture.replies = [reply(['sequence-export'])]
        expect((await classifyIntent(fixture.model, input)).operationFamilies).toEqual(['sequence-export'])
        fixture.replies = [reply(['outside-family'])]
        expect(await classifyIntent(fixture.model, input)).toMatchObject({
            intent: 'chat',
            operationFamilies: [],
            needsClarification: true,
        })
    })
})

const backendFixture = () => {
    const files = new Map<string, AgentScratchFile>()
    const write = vi.fn(async (path: string, content: string, revision: number) => {
        if ((files.get(path)?.revision ?? 0) !== revision)
            throw new Error('SCRATCH_REVISION_CONFLICT')

        files.set(path, {
            path,
            content,
            revision: revision + 1,
            updatedAt: '2026-10-24T00:00:00Z',
        })
    })
    const backend = new AgentScopedBackend({
        assertCurrent: async () => {},
        list: async () => [...files.values()].map(file => ({
            ...file,
            size: file.content.length,
        })),
        read: async path => files.get(path),
        write,
    })

    return {
        backend,
        files,
        write,
    }
}

describe('scoped DeepAgents harness', () => {
    it.each([
        ['chat', []],
        ['inspect', ['inspect_inputs']],
        ['plan', ['inspect_inputs', 'save_pipeline']],
        ['execute', ['inspect_inputs', 'save_pipeline', 'submit_pipeline']],
    ] as const)('sends only %s-authorized tool schemas to the model', async (_intent, permitted) => {
        const fixture = new ModelFixture()
        const allowed = new Set<string>(permitted)
        const agent = createAgentHarness({
            model: fixture.model,
            tools: ['inspect_inputs', 'save_pipeline', 'submit_pipeline'].map(name => tool(async () => 'result', {
                name,
                description: name,
                schema: z.object({}),
            })),
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Follow the accepted instruction.',
            pinnedContext: '',
            multiStep: true,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async name => allowed.has(name),
            consumeToolBudget: async () => {},
        })
        await agent.invoke({ messages: [new HumanMessage('An accepted instruction.')] }, { configurable: { thread_id: `scope-${_intent}` } })
        const names = (fixture.requests[0] as { tools?: Array<{ name: string }> }).tools?.map(tool => tool.name) ?? []
        expect(names.sort()).toEqual([...permitted].sort())
    })

    it('removes mutation schemas at the next model boundary after scope narrowing', async () => {
        const fixture = new ModelFixture()
        fixture.replies = [response([{
            type: 'tool_use',
            id: 'inspect',
            name: 'inspect_inputs',
            input: {},
        }]), response()]
        let mutationsAllowed = true
        const mutation = vi.fn(async () => 'mutated')
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [tool(async () => { mutationsAllowed = false

            return 'Inspected.' }, {
                name: 'inspect_inputs',
                description: 'Read attached inputs.',
                schema: z.object({}),
            }), tool(mutation, {
                name: 'submit_pipeline',
                description: 'Execute a pipeline.',
                schema: z.object({}),
            })],
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Follow the accepted instruction.',
            pinnedContext: '',
            multiStep: true,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async name => name === 'inspect_inputs' || (name === 'submit_pipeline' && mutationsAllowed),
            consumeToolBudget: async () => {},
        })
        await agent.invoke({ messages: [new HumanMessage('Inspect the source.')] }, { configurable: { thread_id: 'scope-narrowing' } })
        const requests = fixture.requests as Array<{ tools: Array<{ name: string }> }>
        expect(requests[0].tools.map(tool => tool.name)).toContain('submit_pipeline')
        expect(requests[1].tools.map(tool => tool.name)).toEqual(['inspect_inputs'])
        expect(mutation).not.toHaveBeenCalled()
    })

    it.each([false, true])('resumes the same checkpoint without rerunning the tool when large result is %s', async large => {
        const durable = await createConversationExecutionFixture()
        const fixture = new ModelFixture()
        fixture.replies = [response([{
            type: 'tool_use',
            id: 'native-submit',
            name: 'submit_pipeline',
            input: {},
        }])]
        let submitted = false
        let complete = false
        const submit = vi.fn(async () => {
            submitted = true

            return JSON.stringify({
                status: 'pending',
                operationId: 'pipeline-operation',
            })
        })
        const acknowledge = vi.fn(async () => {})
        const pending = new AgentPendingTools(durable.repository, durable.payloads, durable.owner, 0, {
            advance: async () => ({
                pending: submitted && !complete,
                completed: complete ? [{
                    operationId: 'pipeline-operation',
                    result: {
                        status: 'completed',
                        assetId: 'output',
                        ...(large ? { details: 'Complete pipeline operation details. '.repeat(3000) } : {}),
                    },
                }] : [],
            }),
            acknowledge,
            cancel: async () => {},
        })
        const saver = new ConversationCheckpointSaver(durable.repository, durable.payloads, {
            partition: durable.owner.partition,
            threadId: 'conversation:pending-tool',
            assertRead: async () => void (await durable.owner.read()),
            writeFences: () => durable.owner.fences(0),
        })
        const toolResults = new AgentToolResults(durable.repository, durable.payloads, durable.owner, 'context-1-turn-1', 0, async () => {})
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [tool(submit, {
                name: 'submit_pipeline',
                description: 'Submit an authorized pipeline.',
                schema: z.object({}),
            })],
            checkpointer: saver,
            backend: backendFixture().backend,
            systemPrompt: 'Use submit_pipeline for the requested work.',
            pinnedContext: 'The user requested this pipeline execution.',
            multiStep: true,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async () => true,
            consumeToolBudget: async () => {},
            beforeModel: async messages => await toolResults.messages(await pending.beforeModel(messages)),
        })
        const config = { configurable: { thread_id: 'conversation:pending-tool' } }
        await expect(agent.invoke({ messages: [new HumanMessage('Execute this pipeline.')] }, config)).rejects.toThrow('AGENT_TOOLS_PENDING')
        expect(submit).toHaveBeenCalledTimes(1)
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
        const savedState = await agent.getState(config)
        expect(savedState.next.length, JSON.stringify({
            next: savedState.next,
            tasks: savedState.tasks,
            metadata: savedState.metadata,
        })).toBeGreaterThan(0)
        complete = true
        fixture.replies.push({
            ...response(),
            id: 'completed-response',
        })
        const resumed = await agent.invoke(null, config)
        expect(fixture.calls.execute).toHaveBeenCalledTimes(2)
        expect(resumed.messages.at(-1)?.content).toBe('A visible answer.')
        expect(submit).toHaveBeenCalledTimes(1)
        expect(fixture.calls.execute).toHaveBeenCalledTimes(2)
        expect(acknowledge).toHaveBeenCalledWith(durable.owner, 'pipeline-operation')
        const native = fixture.requests.at(-1) as { messages: Array<{ content: Array<Record<string, unknown>> }> }
        const results = native.messages.flatMap(message => message.content).filter(block => block.type === 'tool_result')
        expect(results).toHaveLength(1)
        expect(results[0].tool_use_id).toBe('native-submit')
        const content = String(results[0].content)
        expect(JSON.parse(content)).toMatchObject({
            status: 'completed',
            assetId: 'output',
        })
        expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8000)
        expect(Boolean(JSON.parse(content).resultReference)).toBe(large)
    })
    it('continues native tool pairing after invalid result pointers and schema arguments without repeating the original action', async () => {
        const fixture = new ModelFixture()
        const durable = await createConversationExecutionFixture()
        const results = new AgentToolResults(durable.repository, durable.payloads, durable.owner, 'context-read-recovery', 0, async () => {})
        const original = new ToolMessage({
            name: 'save_pipeline',
            tool_call_id: 'saved-draft',
            content: JSON.stringify({ data: {
                pipelineId: 'saved-pipeline',
                details: 'large '.repeat(3000),
            } }),
        })
        const [bounded] = await results.messages([original])
        const { resultId } = JSON.parse(bounded.content as string).resultReference
        const save = vi.fn(async () => original.content as string)
        fixture.replies = [
            response([{
                type: 'tool_use',
                id: 'saved-draft',
                name: 'save_pipeline',
                input: {},
            }]),
            response([{
                type: 'tool_use',
                id: 'bad-pointer',
                name: 'read_tool_result',
                input: {
                    resultId,
                    pointer: '/pipeline',
                },
            }]),
            response([{
                type: 'tool_use',
                id: 'bad-range',
                name: 'read_tool_result',
                input: {
                    resultId,
                    offset: 'wrong',
                },
            }]),
            response([{
                type: 'tool_use',
                id: 'read-root',
                name: 'read_tool_result',
                input: {
                    resultId,
                    pointer: '',
                },
            }]),
            response([{
                type: 'tool_use',
                id: 'read-pipeline',
                name: 'read_tool_result',
                input: {
                    resultId,
                    pointer: '/data/pipelineId',
                },
            }]),
            response(),
        ].map((reply, index) => ({
            ...reply,
            id: `result-read-${index}`,
        }))
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [tool(save, {
                name: 'save_pipeline',
                description: 'Save the draft.',
                schema: z.object({}),
            }), new DynamicStructuredTool({
                name: 'read_tool_result',
                description: 'Read the bounded result.',
                schema: {
                    type: 'object',
                    properties: {
                        resultId: { type: 'string' },
                        pointer: { type: 'string' },
                        offset: { type: 'integer' },
                    },
                    required: ['resultId'],
                },
                func: async input => JSON.stringify(await results.readForModel(input)),
            })],
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Read the saved draft.',
            pinnedContext: '',
            multiStep: true,
            maxGraphSteps: 30,
            assertCurrent: async () => {},
            authorizeTool: async () => true,
            consumeToolBudget: async () => {},
            beforeModel: async messages => await results.messages(messages),
        })
        const result = await agent.invoke({ messages: [new HumanMessage('Save then read the draft.')] }, { configurable: { thread_id: 'result-read-recovery' } })
        expect(result.messages.at(-1)?.content).toBe('A visible answer.')
        expect(fixture.calls.execute).toHaveBeenCalledTimes(6)
        expect(save).toHaveBeenCalledOnce()
        const native = fixture.requests.at(-1) as { messages: Array<{ content: Array<Record<string, unknown>> }> }
        const reads = native.messages.flatMap(message => message.content).filter(block => block.type === 'tool_result')
        expect(reads.map(block => block.tool_use_id)).toEqual(['saved-draft', 'bad-pointer', 'bad-range', 'read-root', 'read-pipeline'])
        expect(JSON.parse(String(reads[1].content))).toMatchObject({
            status: 'error',
            error: {
                code: 'AGENT_TOOL_RESULT_POINTER_NOT_FOUND',
                recoverable: true,
            },
        })
        expect(String(reads[2].content)).toContain('Error invoking tool')
        expect(JSON.parse(String(reads[3].content))).toMatchObject({ entries: [{ pointer: '/data' }] })
        expect(JSON.parse(String(reads[4].content))).toMatchObject({ text: 'saved-pipeline' })
    })

    it('carries sequence timing and output guidance through a natural draft request and applies its five-second 320 by 180 contract', async () => {
        const fixture = new ModelFixture()
        const snapshots = new Map<string, MediaSequence>()
        const commits = vi.fn(async (_access, request) => {
            snapshots.set(request.sequence.sequenceId, structuredClone(request.sequence))

            return true
        })
        const sequence = new MediaSequenceService({
            authorize: async () => {},
            load: async (_access, id) => snapshots.get(id),
            readMutation: async () => undefined,
            listRevisions: async () => [],
            resolveSource: async (_access, source) => source,
            commit: commits,
            now: () => '2026-10-24T00:00:00Z',
        })
        const exportSequence = vi.fn()
        const handlers = new MediaSequencePipelineOperations(sequence, {
            resolvePipelineMediaSource: vi.fn(),
            resolvePipelineSource: async (_access, input) => ({
                sourceId: input.assetId,
                assetId: input.assetId,
                kind: 'sequence',
                revision: input.revision,
            }),
            exportHandler: {
                ensure: exportSequence,
                read: async () => undefined,
            },
        }).handlers()
        const create = handlers.find(handler => handler.definition.operationKey === 'sequence.create')!
        const render = handlers.find(handler => handler.definition.operationKey === 'sequence.export')!
        const patch = {
            name: 'Blue hold',
            requestedOutcome: 'Create a five-second 320 by 180 sequence using Solid Blue Field, then export MP4.',
            constraints: ['Do not execute yet.', 'Do not generate new media.'],
            sources: [{
                sourceId: 'blue',
                assetId: 'blue-image',
                revision: 1,
                kind: 'image',
                blobHash: 'a'.repeat(64),
            }],
            nodes: [{
                nodeId: 'create-sequence',
                operationKey: 'sequence.create',
                inputs: create.definition.inputPorts,
                outputs: create.definition.outputPorts,
                parameters: {
                    name: 'Blue hold sequence',
                    operations: [{
                        op: 'set-properties',
                        values: {
                            width: 320,
                            height: 180,
                        },
                    }, {
                        op: 'add-track',
                        track: {
                            trackId: 'video',
                            kind: 'video',
                            name: 'Video',
                            locked: false,
                            visible: true,
                            muted: false,
                            solo: false,
                        },
                    }, {
                        op: 'add-source',
                        source: {
                            sourceId: 'blue',
                            assetId: 'blue-image',
                            renditionId: 'original',
                            blobHash: 'a'.repeat(64),
                            byteSize: 630,
                            kind: 'image',
                            timeBase: {
                                numerator: 1,
                                denominator: 1000000,
                            },
                            duration: 0,
                            width: 320,
                            height: 180,
                        },
                    }, {
                        op: 'insert-clip',
                        clip: {
                            clipId: 'blue-clip',
                            trackId: 'video',
                            sourceId: 'blue',
                            sourceIn: 0,
                            sourceOut: 0,
                            start: 0,
                            duration: 1200000,
                            rate: {
                                numerator: 1,
                                denominator: 1,
                            },
                            transform: defaultSequenceTransform(),
                            audio: defaultSequenceAudio(),
                            keyframes: [],
                        },
                    }],
                },
            }, {
                nodeId: 'export-mp4',
                operationKey: 'sequence.export',
                inputs: render.definition.inputPorts,
                outputs: render.definition.outputPorts,
                parameters: { preset: {
                    presetId: 'mp4-h264-aac',
                    quality: 'standard',
                } },
            }],
            edges: [{
                from: {
                    nodeId: 'create-sequence',
                    portId: 'sequence',
                },
                to: {
                    nodeId: 'export-mp4',
                    portId: 'sequence',
                },
            }],
            outputBindings: [{
                outputId: 'mp4',
                nodeId: 'export-mp4',
                portId: 'video',
            }],
            executionPolicy: {
                maxConcurrency: 1,
                maxFanout: 1,
            },
        }
        const save = vi.fn(async (_input: MediaPipelineSaveInput) => JSON.stringify({
            status: 'completed',
            data: {
                pipelineId: 'blue-draft',
                revision: 1,
            },
        }))
        fixture.replies = [
            response([{
                type: 'tool_use',
                id: 'catalog',
                name: 'list_operations',
                input: {},
            }]),
            response([{
                type: 'tool_use',
                id: 'save-blue',
                name: 'save_pipeline',
                input: {
                    baseRevision: 0,
                    clientMutationId: 'blue-draft',
                    patch,
                },
            }]),
            response([{
                type: 'text',
                text: 'The Blue hold draft is saved without execution.',
            }]),
        ].map((reply, index) => ({
            ...reply,
            id: `blue-draft-${index}`,
        }))
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [tool(async () => JSON.stringify(handlers.map(handler => handler.definition)), {
                name: 'list_operations',
                description: 'Read the installed operation schemas and timing rules.',
                schema: z.object({}),
            }), new DynamicStructuredTool({
                name: 'save_pipeline',
                description: 'Save the requested draft without executing operations.',
                schema: mediaPipelineSaveInputSchema,
                func: save,
            })],
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Use the operation catalog to save the requested draft. Verify output dimensions and convert duration with the sequence time base. Do not execute the draft.',
            pinnedContext: 'Solid Blue Field is the authorized blue-image Asset. Its original image is 320 by 180; its source time base is 1/1000000. Source dimensions and timing do not set sequence output properties.',
            multiStep: true,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async name => ['list_operations', 'save_pipeline'].includes(name),
            consumeToolBudget: async () => {},
        })
        await agent.invoke({ messages: [new HumanMessage('Save a draft local pipeline named Blue hold that creates a five-second 320 by 180 sequence using only the existing workspace image Solid Blue Field, then exports an MP4. Do not execute it yet. Do not generate any new media.')] }, { configurable: { thread_id: 'blue-hold-contract' } })
        expect(save).toHaveBeenCalledOnce()
        expect(commits).not.toHaveBeenCalled()
        expect(exportSequence).not.toHaveBeenCalled()
        const catalogRequest = JSON.stringify(fixture.requests[1])
        expect(catalogRequest).toContain('240000 ticks per second')
        expect(catalogRequest).toContain('1920 by 1080')
        expect(catalogRequest).toContain('set-properties')
        const savedNode = save.mock.calls[0][0].patch.nodes![0]
        await create.ensure({
            operationId: 'isolated-contract-execution',
            inputHash: 'contract',
            executionId: 'execution',
            pipelineId: 'blue-draft',
            pipelineRevision: 1,
            context: {
                userId: 'user',
                organizationId: 'org',
                workspaceId: 'workspace',
                conversationAssetId: 'conversation',
                turnId: 'turn',
                responseMessageId: 'response',
                runId: 'run',
                epoch: 1,
                continuationEpoch: 0,
                authority: 'test',
            },
            inputs: {},
            node: savedNode,
        })
        const applied = [...snapshots.values()][0]
        expect(applied.width).toBe(320)
        expect(applied.height).toBe(180)
        expect(ticksToSeconds(applied.duration, applied.timeBase)).toBe(5)
        expect(ticksToSeconds(applied.clips[0].duration, applied.timeBase)).toBe(5)
        expect(applied.sources.map(source => source.assetId)).toEqual(['blue-image'])
        expect(applied.sources[0].timeBase.denominator).toBe(1000000)
        expect(applied.timeBase.denominator).toBe(240000)
    })

    it('meters bounded summaries while keeping their text out of the visible response', async () => {
        const fixture = new ModelFixture()
        const {
            backend,
            files,
        } = backendFixture()
        const visible: string[] = []
        const model = new AgentBedrockModel({
            profile,
            calls: fixture.calls,
            maxTokens: 1024,
            transport: fixture.transport,
            resolveModelId: async () => 'aws-model',
            onTextDelta: text => void visible.push(text),
        })
        const agent = createAgentHarness({
            model,
            tools: [],
            checkpointer: new MemorySaver(),
            backend,
            systemPrompt: 'Answer the user.',
            pinnedContext: 'Preserve source asset-1 and operation op-1.',
            multiStep: false,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async () => true,
            consumeToolBudget: async () => {},
        })
        const messages = Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? new HumanMessage('user '.repeat(6000)) : new AIMessage('answer '.repeat(4300)))
        await agent.invoke({ messages }, { configurable: { thread_id: 'conversation-summary' } })
        expect(fixture.calls.execute.mock.calls.length).toBeGreaterThan(1)
        expect(visible).toEqual(['A visible answer.'])
        expect([...files.keys()].some(path => path.startsWith('/scratch/context-'))).toBe(true)
        expect((fixture.requests.at(-1) as { system: string }).system).toContain('Preserve source asset-1 and operation op-1.')
    })

    it('removes general-purpose delegation and shell access from the actual model tool set', async () => {
        const fixture = new ModelFixture()
        const { backend } = backendFixture()
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [],
            checkpointer: new MemorySaver(),
            backend,
            systemPrompt: 'Answer the user.',
            pinnedContext: 'Accepted constraints are authoritative.',
            multiStep: false,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async () => true,
            consumeToolBudget: async () => {},
        })
        const result = await agent.invoke({ messages: [new HumanMessage('Hello.')] }, { configurable: { thread_id: 'conversation-1' } })
        expect(result.messages.at(-1)?.content).toBe('A visible answer.')
        const names = (fixture.requests[0] as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)
        expect(names.sort()).toEqual(['glob', 'grep', 'ls', 'read_file'])
        expect(fixture.calls.execute).toHaveBeenCalledTimes(1)
    })

    it('checks trusted authority before a visible tool executes', async () => {
        const fixture = new ModelFixture()
        fixture.replies = [response([{
            type: 'tool_use',
            id: 'mutation',
            name: 'save_plan',
            input: {},
        }])]
        const mutation = vi.fn(async () => 'saved')
        const consumeToolBudget = vi.fn(async () => {})
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [tool(mutation, {
                name: 'save_plan',
                description: 'Save the requested draft.',
                schema: z.object({}),
            })],
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Follow the accepted request.',
            pinnedContext: '',
            multiStep: false,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async () => false,
            consumeToolBudget,
        })
        const result = await agent.invoke({ messages: [new HumanMessage('A request.')] }, { configurable: { thread_id: 'conversation-2' } })
        expect(result.messages.find(message => message.getType() === 'tool')).toMatchObject({
            status: 'error',
            tool_call_id: 'mutation',
        })
        expect(mutation).not.toHaveBeenCalled()
        expect(consumeToolBudget).not.toHaveBeenCalled()
    })

    it('applies steering at model boundaries and reads the updated pinned context', async () => {
        const fixture = new ModelFixture()
        let pinned = 'Initial constraint.'
        const agent = createAgentHarness({
            model: fixture.model,
            tools: [],
            checkpointer: new MemorySaver(),
            backend: backendFixture().backend,
            systemPrompt: 'Follow the accepted instruction.',
            pinnedContext: () => pinned,
            multiStep: false,
            maxGraphSteps: 20,
            assertCurrent: async () => {},
            authorizeTool: async () => true,
            consumeToolBudget: async () => {},
            beforeModel: async messages => {
                pinned = 'Revised constraint.'

                return [...messages, new HumanMessage({
                    id: 'steer-1',
                    content: 'The revised accepted instruction.',
                })]
            },
        })
        await agent.invoke({ messages: [new HumanMessage('Initial request.')] }, { configurable: { thread_id: 'conversation-steer' } })
        expect(fixture.requests[0]).toMatchObject({ system: expect.stringContaining('Revised constraint.') })
        expect(JSON.stringify((fixture.requests[0] as { messages: unknown }).messages)).toContain('The revised accepted instruction.')
    })

    it('fences paths, keeps Skills read-only, and revision-checks scratch edits', async () => {
        const {
            backend,
            files,
            write,
        } = backendFixture()
        files.set('/skills/installed/SKILL.md', {
            path: '/skills/installed/SKILL.md',
            content: 'Read-only instructions.',
            revision: 1,
            updatedAt: '2026-10-24T00:00:00Z',
        })

        for (const path of ['/etc/passwd', '/scratch/../secret', 'https://example.invalid', '/scratch/%2e%2e/secret', '/scratch/another\\path'])
            expect(await backend.read(path)).toHaveProperty('error')

        expect(await backend.write('/skills/installed/SKILL.md', 'Changed.')).toHaveProperty('error')
        expect(await backend.write('/scratch/work.txt', 'One item.')).toMatchObject({ path: '/scratch/work.txt' })
        expect(await backend.edit('/scratch/work.txt', 'One', 'Two')).toMatchObject({ occurrences: 1 })
        expect(write).toHaveBeenLastCalledWith('/scratch/work.txt', 'Two item.', 1)
        expect(await backend.grep('Two')).toMatchObject({ matches: [{
            path: '/scratch/work.txt',
            line: 1,
            text: 'Two item.',
        }] })
        expect(await backend.read('/skills/installed/SKILL.md')).toMatchObject({ content: 'Read-only instructions.' })
    })
})
