import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import  { type Message, type MessageCreateParamsNonStreaming, type RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { type ConversationAcknowledgement, type ConversationSubmitRequest, type ConversationTurn, type ConversationMessage } from '@lixpi/constants'
import  { mediaPipelineSaveInputSchema, type CapabilityAgentTool, type CapabilityModuleCatalog } from '@lixpi/capability-system/backend'
import  { type ProviderUsageClient } from '@lixpi/usage-reporter'
import { ConversationRepository, conversationPartition, type ConversationDispatch, type ConversationMeta } from './conversation-repository.ts'
import { ConversationService } from './conversation-service.ts'
import { ConversationRuntime } from './conversation-runtime.ts'
import { ConversationOwner } from './conversation-owner.ts'
import { AtomicConversationTestDatabase } from './conversation-test-support.ts'
import { ConversationProjector } from './conversation-projector.ts'
import { AgentConfiguration } from './agent-configuration.ts'
import { AgentSkills } from './agent-skills.ts'
import { AgentContext } from './agent-context.ts'
import { AgentContextBoundary } from './agent-context-boundary.ts'
import { AgentExecutionScope } from './agent-execution-scope.ts'
import  { type ConversationMediaOperations } from './agent-pending-tools.ts'

const fixture = vi.hoisted(() => ({
    respond: vi.fn(),
    profile: {
        provider: 'anthropic',
        model: 'test-model',
        modelVersion: 'test-version',
        contextWindow: 100_000,
        maxCompletionSize: 4096,
        inferenceProviderCalledByThePlatform: 'aws-bedrock',
        inferenceProviders: { 'aws-bedrock': {
            isCalledByThePlatform: true,
            pricing: {},
        } },
        inferenceCapabilities: {
            thinkingMode: 'none',
            supportsSystemPrompt: true,
            supportedInputKinds: ['document-text'],
            supportsTemperature: false,
            requiresClosedJsonSchema: false,
        },
    },
    authorize: async (workspaceId: string, userId: string) => ({
        organizationId: 'org',
        workspaceId,
        userId,
        fences: [],
    }),
}))

vi.mock('../../models/ai-model.ts', () => ({ default: {
    getAvailableAiModels: async () => ({
        defaultModels: { reasoning: 'anthropic:test-model' },
        models: [fixture.profile],
    }),
    getAiModel: async () => fixture.profile,
} }))
vi.mock('../providers/bedrock-inference.ts', () => ({ bedrockInference: {
    isEnabledFor: () => true,
    resolveModelId: async () => 'test-version',
} }))
vi.mock('./conversation-adapters.ts', () => ({ ConversationAdapters: class {
    authorize = fixture.authorize
    publish = async () => {}
    resolveReferences = async () => []
} }))
vi.mock('./agent-bedrock-model.ts', async importOriginal => {
    const actual = await importOriginal<typeof import('./agent-bedrock-model.ts')>()

    return {
        ...actual,
        AgentBedrockModel: class extends actual.AgentBedrockModel {
        constructor(options: ConstructorParameters<typeof actual.AgentBedrockModel>[0]) {
            super({
                ...options,
                resolveModelId: async () => 'test-version',
                transport: {
                    create: async request => await fixture.respond(request),
                    stream: request => {
                    let reply: Message

                    return {
                        async *[Symbol.asyncIterator]() {
                            reply = await fixture.respond(request)
                            yield {
                                type: 'message_start',
                                message: {
                                    ...reply,
                                    content: [],
                                },
                            } as RawMessageStreamEvent

                            for (const [index, block] of reply.content.entries()) {
                                if (block.type === 'text')
                                    yield {
                                        type: 'content_block_delta',
                                        index,
                                        delta: {
                                            type: 'text_delta',
                                            text: block.text,
                                        },
                                    } as RawMessageStreamEvent
                                else
                                    yield {
                                        type: 'content_block_start',
                                        index,
                                        content_block: block,
                                    } as RawMessageStreamEvent
                            }

                            yield {
                                type: 'message_delta',
                                delta: {
                                    stop_reason: reply.stop_reason,
                                    stop_sequence: null,
                                },
                                usage: reply.usage,
                            } as RawMessageStreamEvent
                            yield { type: 'message_stop' } as RawMessageStreamEvent
                        },
                        finalMessage: async () => reply,
                    }
                },
                },
            })
        }
    },
    }
})

const response = (content: Message['content']): Message => ({
    id: `reply-${fixture.respond.mock.calls.length}`,
    type: 'message',
    role: 'assistant',
    model: 'test-version',
    content,
    stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
        input_tokens: 10,
        output_tokens: 20,
    },
} as Message)
const intent = (kind: 'chat' | 'plan' | 'execute' = 'chat', question?: string): Message => response([{
    type: 'tool_use',
    id: 'intent',
    name: 'classify_intent',
    input: {
        intent: kind,
        operationFamilies: kind === 'execute'
            || kind === 'plan'
            ? ['sequence-edit']
            : [],
        targetAssetIds: [],
        confidence: 1,
        needsClarification: Boolean(question),
        ...(question ? { question } : {}),
    },
}])
const answer = (text = 'Hello.'): Message => response([{
    type: 'text',
    text,
}])
const isClassifier = (request: MessageCreateParamsNonStreaming): boolean => request.tools?.some(tool => tool.name === 'classify_intent') ?? false

const runtimeFixture = async (tools: CapabilityAgentTool[] = [], operations?: ConversationMediaOperations, limits: Record<string, string> = {}, families: ReturnType<CapabilityModuleCatalog['listOperationFamilies']> = []) => {
    const database = new AtomicConversationTestDatabase()
    database.pageSize = 100
    const repository = new ConversationRepository(database as unknown as ConstructorParameters<typeof ConversationRepository>[0], 'Conversations')
    let id = 0
    const service = new ConversationService(repository, {
        authorize: fixture.authorize,
        resolveReferences: async () => [],
        activate: async (_meta, writes) => await repository.commit(writes),
        publish: async () => {},
        now: Date.now,
        createId: () => `turn-${++id}`,
    })
    const initial = await service.create({
        protocolVersion: 1,
        workspaceId: 'workspace',
        clientConversationId: 'draft',
    }, 'user')
    const partition = conversationPartition('org', initial.conversationAssetId)
    const metrics = {
        enabled: true,
        authorizeRequest: vi.fn(async () => ({
            authorized: true,
            authorizationId: `authorization-${id}`,
        })),
        recordUsage: vi.fn(async () => {}),
        completeRequest: vi.fn(async () => {}),
    }
    const catalog = {
        listAgentTools: () => tools,
        listOperationFamilies: () => families,
        listModuleIds: () => [],
    } as unknown as CapabilityModuleCatalog
    const runtime = new ConversationRuntime(repository, new AgentConfiguration({
        ...limits,
    }), catalog, metrics as unknown as ProviderUsageClient, operations)
    const request = (clientMessageId: string, text = 'hi', patch: Partial<ConversationSubmitRequest> = {}): ConversationSubmitRequest => ({
        protocolVersion: 1,
        workspaceId: 'workspace',
        conversationAssetId: initial.conversationAssetId,
        clientMessageId,
        fragment: {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text,
                }],
            }],
        },
        references: [],
        settingsRevision: 1,
        ...patch,
    })
    const dispatch = async (receipt: ConversationAcknowledgement): Promise<ConversationDispatch> => {
        if (receipt.status === 'rejected')
            throw new Error(receipt.error.code)

        return (await repository.read<ConversationDispatch>(partition, `DISPATCH#${receipt.turnId}`))!
    }

    return {
        database,
        repository,
        service,
        runtime,
        partition,
        metrics,
        request,
        dispatch,
        meta: async () => (await repository.read<ConversationMeta>(partition, 'META'))!,
    }
}

beforeEach(() => {
    fixture.respond.mockReset()
    vi.spyOn(ConversationProjector.prototype, 'project').mockResolvedValue()
    vi.spyOn(AgentSkills.prototype, 'load').mockResolvedValue(new Map())
    vi.spyOn(AgentSkills.prototype, 'assertCurrent').mockResolvedValue()
})

afterEach(() => vi.restoreAllMocks())

describe('conversation runtime with durable ownership and checkpoints', () => {
    it('supplies admitted saved-plan requirements before classifying a natural run request', async () => {
        const target = {
            assetId: 'blue-pipeline',
            title: 'Blue hold',
            artifactTypeId: 'media-pipeline',
            revision: 5,
            operationKeys: ['sequence.create', 'sequence.export'],
        }
        vi.spyOn(AgentContext.prototype, 'executionTargets').mockResolvedValue([target])
        vi.spyOn(AgentContext.prototype, 'targetAssetIds').mockReturnValue(['blue-pipeline', 'blue-image'])
        vi.spyOn(AgentContext.prototype, 'assertReadTarget').mockResolvedValue()
        const submit = vi.fn(async () => {
            const scope = await AgentExecutionScope.authorize('execute', ['sequence-edit', 'sequence-export'], ['blue-pipeline'])
            expect(scope.intent.operationFamilies).toEqual(['sequence-edit', 'sequence-export'])

            return {
                status: 'completed',
                sources: [],
            }
        })
        const test = await runtimeFixture([{
            name: 'submit_pipeline',
            description: 'Run an authorized saved pipeline.',
            intent: 'execute',
            operationFamilies: [],
            schema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            execute: submit,
        }], undefined, {}, [
            {
                family: 'sequence-edit',
                description: 'Create or edit a local sequence using existing media.',
                operationKeys: ['sequence.create', 'sequence.revise'],
            },
            {
                family: 'sequence-export',
                description: 'Render a local sequence to MP4.',
                operationKeys: ['sequence.export'],
            },
        ])
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request)) {
                const content = request.messages[0].content as Array<{ text: string }>
                const facts = JSON.parse(content[0].text)
                expect(facts.instruction).toBe('Run the saved Blue hold pipeline now and export its MP4. Local assembly and export only; no AI image, audio or video generation.')
                expect(facts.executionTargets).toEqual([{
                    ...target,
                    requiredOperationFamilies: ['sequence-edit', 'sequence-export'],
                    unavailableOperationKeys: [],
                }])
                expect(facts.familyDescriptions).toEqual(expect.arrayContaining([{
                    family: 'sequence-edit',
                    description: 'Create or edit a local sequence using existing media.',
                }]))

                return response([{
                    type: 'tool_use',
                    id: 'classify',
                    name: 'classify_intent',
                    input: {
                        intent: 'execute',
                        operationFamilies: ['sequence-edit', 'sequence-export'],
                        targetAssetIds: ['blue-pipeline'],
                        confidence: 0.95,
                        needsClarification: false,
                    },
                }])
            }

            if (fixture.respond.mock.calls.length === 2)
                return response([{
                    type: 'tool_use',
                    id: 'submit',
                    name: 'submit_pipeline',
                    input: {},
                }])

            return answer('The saved plan was run.')
        })
        const accepted = await test.service.submit(test.request('run-blue', 'Run the saved Blue hold pipeline now and export its MP4. Local assembly and export only; no AI image, audio or video generation.'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('done')
        expect((await test.meta()).run?.state).toBe('completed')
        expect(submit).toHaveBeenCalledOnce()
        expect(await test.repository.read(test.partition, `INTENT#${(await test.meta()).run!.turnId}`)).toMatchObject({
            intent: 'execute',
            operationFamilies: ['sequence-edit', 'sequence-export'],
            targetAssetIds: ['blue-pipeline'],
        })
    })

    it('returns malformed draft arguments as a paired tool error and executes only the corrected call', async () => {
        const save = vi.fn(async () => ({
            status: 'completed',
            data: { pipelineId: 'saved-draft' },
            sources: [],
        }))
        const test = await runtimeFixture([{
            name: 'save_pipeline',
            description: 'Save a requested pipeline draft.',
            intent: 'plan',
            operationFamilies: ['sequence-edit'],
            schema: mediaPipelineSaveInputSchema,
            execute: save,
        }])
        const valid = {
            baseRevision: 0,
            clientMutationId: 'draft-call',
            patch: { name: 'Blue hold' },
        }
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('plan')

            if (fixture.respond.mock.calls.length === 2)
                return response([{
                    type: 'tool_use',
                    id: 'invalid-draft',
                    name: 'save_pipeline',
                    input: {
                        ...valid,
                        patch: {},
                    },
                }])

            if (fixture.respond.mock.calls.length === 3) {
                const results = request.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'tool_result')
                expect(results).toHaveLength(1)
                expect(results[0]).toMatchObject({ tool_use_id: 'invalid-draft' })
                expect(String(results[0].content)).toContain('Error invoking tool')
                expect(save).not.toHaveBeenCalled()

                return response([{
                    type: 'tool_use',
                    id: 'corrected-draft',
                    name: 'save_pipeline',
                    input: valid,
                }])
            }

            return answer('The draft is saved.')
        })
        const accepted = await test.service.submit(test.request('draft', 'Save a draft local pipeline named Blue hold. Do not execute yet.'), 'user')
        const disposition = await test.runtime.execute(await test.dispatch(accepted))
        expect(disposition, JSON.stringify((await test.meta()).run)).toBe('done')
        expect((await test.meta()).run?.state).toBe('completed')
        expect(save).toHaveBeenCalledOnce()
        expect(save.mock.calls[0][0]).toEqual(valid)
        expect(fixture.respond).toHaveBeenCalledTimes(4)
    })

    it('coalesces more than eighty settings changes, resumes the queue, and projects without invoking a model', async () => {
        const test = await runtimeFixture()
        await test.service.submit(test.request('waiting', 'Discuss this later.'), 'user')

        for (let index = 0; index < 82; index++)
            await test.service.settings({
                protocolVersion: 1,
                workspaceId: 'workspace',
                conversationAssetId: (await test.meta()).conversationAssetId,
                expectedRevision: index + 1,
                patch: { contextMode: index % 2 === 0 ? 'discovery' : 'explicit' },
            }, 'user')

        expect((await test.repository.query(test.partition, 'DISPATCH#')).items).toHaveLength(2)
        const snapshot = await test.service.queue({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: (await test.meta()).conversationAssetId,
            clientCommandId: 'resume-after-settings',
            action: 'resume',
            expectedRevision: 2,
            turnIds: [],
        }, 'user')
        expect(snapshot.queuePaused).toBe(false)
        const job = (await test.repository.read<ConversationDispatch>(test.partition, 'DISPATCH#configuration'))!
        expect(job.projectionRevision).toBe(83)
        expect(await test.runtime.execute(job)).toBe('done')
        expect(fixture.respond).not.toHaveBeenCalled()
        expect(test.metrics.authorizeRequest).not.toHaveBeenCalled()
        expect((await test.meta()).run).toBeUndefined()
        expect((await test.repository.query<ConversationTurn>(test.partition, 'TURN#')).items.map(turn => turn.state)).toEqual(['queued'])
        expect((await test.repository.query<ConversationMessage>(test.partition, 'MESSAGE#')).items.filter(message => message.role === 'configuration')).toHaveLength(82)
        expect(ConversationProjector.prototype.project).toHaveBeenCalledOnce()
    })

    it('admits one necessary answer beyond a full queue and prevents cancelling that durable answer', async () => {
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => isClassifier(request)
            ? fixture.respond.mock.calls.length === 1 ? intent('chat', 'Which source?') : intent()
            : answer('Understood.'))
        const test = await runtimeFixture()
        const accepted = await test.service.submit(test.request('question', 'Use that.'), 'user')
        await test.runtime.execute(await test.dispatch(accepted))
        const waiting = await test.meta()

        for (let index = 0; index < 32; index++)
            expect(await test.service.submit(test.request(`queued-${index}`, 'Discuss this later.', { midRunPolicy: 'queue' }), 'user')).toMatchObject({ status: 'accepted' })

        expect(await test.service.submit(test.request('full-queue', 'Another item.', { midRunPolicy: 'queue' }), 'user')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_QUEUE_FULL' },
        })
        const request = test.request('answer-full-queue', 'I meant discussion.', { interruptId: waiting.run!.interruptId })
        const answered = await test.service.submit(request, 'user')
        expect(answered.status).toBe('accepted')
        expect(await test.service.submit(request, 'user')).toMatchObject({ status: 'duplicate' })
        const snapshot = await test.service.get({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: waiting.conversationAssetId,
        }, 'user')
        expect(snapshot.queuedTurns).toHaveLength(33)
        const queuedAnswer = snapshot.queuedTurns.find(turn => turn.clientMessageId === request.clientMessageId)!
        expect(queuedAnswer.interruptId).toBe(waiting.run!.interruptId)
        await expect(test.service.queue({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: waiting.conversationAssetId,
            clientCommandId: 'remove-answer',
            expectedRevision: snapshot.queueRevision,
            action: 'cancel-message',
            turnIds: [queuedAnswer.turnId],
        }, 'user')).rejects.toThrow('CONVERSATION_INTERRUPT_ANSWER_ALREADY_ACCEPTED')
        expect(await test.runtime.execute(await test.dispatch(answered))).toBe('done')
        expect((await test.meta()).run?.state).toBe('completed')
        expect(fixture.respond).toHaveBeenCalledTimes(3)
    })

    it.each(['normal', 'lost-ack', 'crash'])('narrows active context at the model boundary without repeating completed actions: %s', async mode => {
        let test: Awaited<ReturnType<typeof runtimeFixture>>
        const create = vi.fn(async () => {
            const meta = await test.meta()
            await test.service.settings({
                protocolVersion: 1,
                workspaceId: 'workspace',
                conversationAssetId: meta.conversationAssetId,
                expectedRevision: meta.settingsRevision,
                patch: { contextMode: 'explicit' },
            }, 'user')

            return {
                status: 'completed',
                data: {
                    sequenceId: 'already-created',
                    privateDescription: 'discovered-private-text',
                },
            }
        })
        test = await runtimeFixture([{
            name: 'create_before_narrowing',
            description: 'Create a sequence.',
            intent: 'execute',
            operationFamilies: ['sequence-edit'],
            schema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            execute: create,
        }])
        const initial = await test.meta()
        await test.service.settings({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: initial.conversationAssetId,
            expectedRevision: 1,
            patch: { contextMode: 'discovery' },
        }, 'user')
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            if (fixture.respond.mock.calls.length === 2) {
                expect(request.tools?.some(tool => tool.name === 'discover_workspace')).toBe(true)

                return response([{
                    type: 'tool_use',
                    id: 'create-before-change',
                    name: 'create_before_narrowing',
                    input: {},
                }])
            }

            expect(request.tools?.some(tool => tool.name === 'discover_workspace')).toBe(false)
            expect(JSON.stringify(request.messages)).toContain('already-created')
            expect(JSON.stringify(request.messages)).not.toContain('discovered-private-text')
            expect(String(request.system)).toContain('"contextMode":"explicit"')

            return answer('The previously created sequence is retained.')
        })
        const accepted = await test.service.submit(test.request('narrow', 'Create a sequence.', { settingsRevision: 2 }), 'user')
        const job = await test.dispatch(accepted)

        if (mode === 'lost-ack')
            test.database.beforeCommit = operations => {
                if (operations.some(operation => operation.type === 'put' && String(operation.item.sk).startsWith('CONTEXT_SCOPE#'))) {
                    test.database.beforeCommit = undefined
                    test.database.failAfterCommit = true
                }
            }

        if (mode === 'crash') {
            const synchronize = AgentContextBoundary.prototype.synchronize
            const interrupted = vi.spyOn(AgentContextBoundary.prototype, 'synchronize').mockImplementation(async function (...args) {
                const changed = await synchronize.apply(this, args)

                if (changed)
                    test.runtime.stop()

                return changed
            })
            await expect(test.runtime.execute(job)).rejects.toThrow('AGENT_RUNTIME_STOPPING')
            interrupted.mockRestore()
            expect(fixture.respond).toHaveBeenCalledTimes(2)
        }

        await test.runtime.execute(job)

        expect(create).toHaveBeenCalledOnce()
        expect(fixture.respond).toHaveBeenCalledTimes(3)
        expect((await test.meta()).run).toMatchObject({
            state: 'completed',
            runId: `run-${job.turnId}`,
            continuationEpoch: 0,
            budget: {
                modelCalls: 3,
                toolCalls: 1,
            },
        })
        expect((await test.repository.read(test.partition, `CONTEXT_SCOPE#${job.turnId}`))).toMatchObject({
            contextMode: 'explicit',
            revision: 3,
        })
    })

    it('gives each exhausted allocation a fresh interrupt and retains earlier native answers across repeated Continue', async () => {
        const create = vi.fn(async () => ({
            status: 'completed',
            data: { sequenceId: 'created-once' },
            sources: [],
        }))
        const inspect = vi.fn(async () => ({
            status: 'completed',
            data: { verified: true },
            sources: [],
        }))
        const tool = (name: string, execute: CapabilityAgentTool['execute']): CapabilityAgentTool => ({
            name,
            execute,
            description: 'Perform the requested sequence step.',
            intent: 'execute',
            operationFamilies: ['sequence-edit'],
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
        })
        const test = await runtimeFixture([tool('create_once', create), tool('inspect_once', inspect)], undefined, { AGENT_MAX_MODEL_CALLS: '2' })
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            const call = fixture.respond.mock.calls.length

            if (call === 2)
                return response([{
                    type: 'tool_use',
                    id: 'ask',
                    name: 'request_user_input',
                    input: { question: 'Which title?' },
                }])

            expect(JSON.stringify(request.messages)).toContain('Selected title')

            if (
                call === 3
                || call === 4
            )
                return response([{
                    type: 'tool_use',
                    id: `step-${call}`,
                    name: call === 3 ? 'create_once' : 'inspect_once',
                    input: {},
                }])

            expect(JSON.stringify(request.messages)).toContain('created-once')
            expect(JSON.stringify(request.messages)).toContain('verified')

            return answer('The saved steps are complete.')
        })
        const accepted = await test.service.submit(test.request('start-repeated', 'Create the sequence and verify it.'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        const native = (await test.meta()).run!
        const supplied = await test.service.submit(test.request('native-answer', 'Selected title', { interruptId: native.interruptId }), 'user')
        expect(await test.runtime.execute(await test.dispatch(supplied))).toBe('defer')
        const first = (await test.meta()).run!
        const continued = await test.service.submit(test.request('continue-first', 'Continue.', { interruptId: first.interruptId }), 'user')
        expect(await test.runtime.execute(await test.dispatch(continued))).toBe('defer')
        const second = (await test.meta()).run!
        expect(second.interruptId).not.toBe(first.interruptId)
        expect(second.continuedFromBudgetAllocationId).toBe(first.budgetAllocationId)
        const finished = await test.service.submit(test.request('continue-second', 'Continue.', { interruptId: second.interruptId }), 'user')
        expect(await test.runtime.execute(await test.dispatch(finished))).toBe('done')
        expect(create).toHaveBeenCalledOnce()
        expect(inspect).toHaveBeenCalledOnce()
        expect(fixture.respond).toHaveBeenCalledTimes(5)
        expect((await test.repository.query(test.partition, 'BUDGET_ANSWER#')).items).toHaveLength(2)
        const messages = (await test.repository.query<ConversationMessage>(test.partition, 'MESSAGE#')).items.map(message => message.text)
        expect(messages).toEqual([
            'Create the sequence and verify it.', 'Which title?', 'Selected title', expect.stringContaining('execution limit'),
            'Continue.', expect.stringContaining('execution limit'), 'Continue.', 'The saved steps are complete.',
        ])
    })

    it.each(['normal', 'lost-ack', 'crash'])('continues the saved native tool state with one linked budget allocation: %s', async mode => {
        const create = vi.fn(async () => ({
            status: 'completed',
            data: { sequenceId: 'saved-before-budget' },
            sources: [],
        }))
        const tool: CapabilityAgentTool = {
            name: 'create_budget_sequence',
            description: 'Create the requested sequence.',
            intent: 'execute',
            operationFamilies: ['sequence-edit'],
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute: create,
        }
        const test = await runtimeFixture([tool], undefined, { AGENT_MAX_MODEL_CALLS: '2' })
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            if (fixture.respond.mock.calls.length === 2)
                return response([{
                    type: 'tool_use',
                    id: 'create-once',
                    name: tool.name,
                    input: {},
                }])

            expect(JSON.stringify(request.messages)).toContain('saved-before-budget')
            expect(JSON.stringify(request.messages)).toContain('create-once')

            return answer('Continued from the saved sequence.')
        })
        const accepted = await test.service.submit(test.request('budget-start', 'Create a sequence.'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        const waiting = (await test.meta()).run!
        expect(waiting.state).toBe('waiting-input')
        expect(waiting.budget.modelCalls).toBe(2)
        const request = test.request('budget-answer', 'Continue.', { interruptId: waiting.interruptId })
        const answered = await test.service.submit(request, 'user')

        if (mode === 'lost-ack')
            test.database.beforeCommit = operations => {
                if (operations.some(operation => operation.type === 'put' && String(operation.item.sk).startsWith('BUDGET_ANSWER#'))) {
                    test.database.beforeCommit = undefined
                    test.database.failAfterCommit = true
                }
            }

        if (mode === 'crash') {
            const renew = ConversationOwner.prototype.renewBudget
            const interrupted = vi.spyOn(ConversationOwner.prototype, 'renewBudget').mockImplementationOnce(async function (...args) {
                const run = await renew.apply(this, args)
                test.runtime.stop()

                return run
            })
            await expect(test.runtime.execute(await test.dispatch(answered))).rejects.toThrow('AGENT_RUNTIME_STOPPING')
            interrupted.mockRestore()
            expect(fixture.respond).toHaveBeenCalledTimes(2)
        }

        expect(await test.runtime.execute(await test.dispatch(answered))).toBe('done')
        const finished = (await test.meta()).run!
        expect(finished).toMatchObject({
            state: 'completed',
            runId: waiting.runId,
            turnId: waiting.turnId,
            continuationEpoch: waiting.continuationEpoch,
            continuedFromBudgetAllocationId: waiting.budgetAllocationId,
            budget: {
                modelCalls: 1,
                toolCalls: 0,
            },
        })
        expect(finished.budgetAllocationId).not.toBe(waiting.budgetAllocationId)
        expect(fixture.respond.mock.calls.filter(([request]) => isClassifier(request))).toHaveLength(1)
        expect(create).toHaveBeenCalledOnce()
        expect((await test.repository.query(test.partition, 'BUDGET_ALLOCATION#')).items).toHaveLength(2)
        expect((await test.repository.query(test.partition, 'BUDGET_ANSWER#')).items).toHaveLength(1)
        expect(await test.service.submit(request, 'user')).toMatchObject({ status: 'duplicate' })
        expect((await test.meta()).run!.budget).toEqual(finished.budget)
        const transcript = (await test.repository.query<ConversationMessage>(test.partition, 'MESSAGE#')).items.map(message => message.text)
        expect(transcript).toEqual(['Create a sequence.', expect.stringContaining('execution limit'), 'Continue.', 'Continued from the saved sequence.'])
    })

    it('restores mutation access to every output of the resumed run across created-output pages', async () => {
        vi.spyOn(AgentContext.prototype, 'refreshOutputs').mockResolvedValue()
        const execute = vi.fn(async () => {
            await AgentExecutionScope.authorize('execute', ['sequence-edit'], ['asset-100'])
            await expect(AgentExecutionScope.authorize('execute', ['sequence-edit'], ['foreign-run'])).rejects.toThrow('AGENT_MUTATION_TARGET_NOT_AUTHORIZED')

            return {
                status: 'completed',
                data: { edited: 'asset-100' },
                sources: [],
            }
        })
        const test = await runtimeFixture([{
            name: 'revise_test_sequence',
            description: 'Revise a sequence created during this run.',
            intent: 'execute',
            operationFamilies: ['sequence-edit'],
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute,
        }])
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            return execute.mock.calls.length ? answer('Revised.') : response([{
                type: 'tool_use',
                id: 'revise',
                name: 'revise_test_sequence',
                input: {},
            }])
        })
        const accepted = await test.service.submit(test.request('resume-many-outputs', 'Revise the sequence created during this run.'), 'user')

        if (accepted.status === 'rejected')
            throw new Error(accepted.error.code)

        for (let index = 0; index <= 101; index++) {
            const assetId = index === 101 ? 'foreign-run' : `asset-${String(index).padStart(3, '0')}`
            const sk = `CREATED#${assetId}`
            test.database.rows.set(`${test.partition}|${sk}`, {
                pk: test.partition,
                sk,
                assetId,
                runId: index === 101 ? 'other-run' : `run-${accepted.turnId}`,
            })
        }

        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('done')
        expect(execute).toHaveBeenCalledOnce()
        await expect(execute.mock.results[0].value).resolves.toMatchObject({ data: { edited: 'asset-100' } })
        expect((await test.meta()).run?.state).toBe('completed')
    })

    it('persists an actionable failure message for reload when model authorization is denied', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const test = await runtimeFixture()
        test.metrics.authorizeRequest.mockResolvedValue({
            authorized: false,
            authorizationId: '',
        })
        const accepted = await test.service.submit(test.request('denied'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('done')
        const query = test.request('denied')
        const snapshot = await test.service.get({
            protocolVersion: 1,
            workspaceId: query.workspaceId,
            conversationAssetId: query.conversationAssetId,
        }, 'user')
        expect(snapshot.run).toMatchObject({
            state: 'failed',
            error: { code: 'AGENT_MODEL_CALL_NOT_AUTHORIZED' },
        })
        expect(snapshot.messages).toContainEqual(expect.objectContaining({
            role: 'assistant',
            text: 'The configured model request was not authorized. Review account access before retrying.',
            complete: true,
        }))
        expect(fixture.respond).not.toHaveBeenCalled()
    })

    it.each([false, true])('continues necessary-input work without repetition or scope expansion, crash after answer commit: %s', async crashAfterAnswer => {
        const create = vi.fn(async () => ({
            status: 'completed',
            data: { sequenceId: 'saved-sequence' },
            sources: [],
        }))
        const forbidden = vi.fn()
        const tool = (name: string, family: string, execute: CapabilityAgentTool['execute']): CapabilityAgentTool => ({
            name,
            description: 'Test operation.',
            intent: 'execute',
            operationFamilies: [family],
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute,
        })
        const test = await runtimeFixture([tool('create_test_sequence', 'sequence-edit', create), tool('export_test_sequence', 'sequence-export', forbidden)])
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            const call = fixture.respond.mock.calls.length

            if (call === 2)
                return response([{
                    type: 'tool_use',
                    id: 'created-once',
                    name: 'create_test_sequence',
                    input: {},
                }])

            if (call === 3)
                return response([{
                    type: 'tool_use',
                    id: 'question-once',
                    name: 'request_user_input',
                    input: { question: 'What should the sequence title be?' },
                }])

            if (call === 4) {
                expect(JSON.stringify(request.messages)).toContain('Use Selected title, and export it too.')

                return response([{
                    type: 'tool_use',
                    id: 'scope-attempt',
                    name: 'export_test_sequence',
                    input: {},
                }])
            }

            expect(JSON.stringify(request.messages)).toContain('AGENT_TOOL_SCOPE_DENIED')

            return answer('The saved sequence is ready. Export needs a separate request.')
        })
        const accepted = await test.service.submit(test.request('create', 'Create the sequence.'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        const waiting = (await test.meta()).run!
        expect(waiting).toMatchObject({
            state: 'waiting-input',
            budget: {
                modelCalls: 3,
                toolCalls: 2,
            },
        })
        expect(create).toHaveBeenCalledOnce()
        const answered = await test.service.submit(test.request('necessary-answer', 'Use Selected title, and export it too.', { interruptId: waiting.interruptId }), 'user')

        if (crashAfterAnswer) {
            const complete = ConversationOwner.prototype.completeInputAnswer
            const interruption = vi.spyOn(ConversationOwner.prototype, 'completeInputAnswer').mockImplementationOnce(async function (answer, operations) {
                await complete.call(this, answer, operations)
                test.runtime.stop()
            })
            await expect(test.runtime.execute(await test.dispatch(answered))).rejects.toThrow('AGENT_RUNTIME_STOPPING')
            interruption.mockRestore()
            expect(fixture.respond).toHaveBeenCalledTimes(3)
            expect((await test.repository.query(test.partition, 'INPUT_RESULT#')).items).toHaveLength(1)
        }

        expect(await test.runtime.execute(await test.dispatch(answered))).toBe('done')
        expect(create).toHaveBeenCalledOnce()
        expect(forbidden).not.toHaveBeenCalled()
        expect((await test.meta()).run).toMatchObject({
            runId: waiting.runId,
            turnId: waiting.turnId,
            continuationEpoch: waiting.continuationEpoch,
            state: 'completed',
            budget: {
                modelCalls: 5,
                toolCalls: 2,
            },
        })
        expect(fixture.respond.mock.calls.filter(([request]) => isClassifier(request))).toHaveLength(1)
        expect((await test.repository.query<ConversationTurn>(test.partition, 'TURN#')).items.every(turn => turn.state === 'completed')).toBe(true)
        expect((await test.repository.query<ConversationMessage>(test.partition, 'MESSAGE#')).items.map(message => message.text)).toEqual([
            'Create the sequence.', 'What should the sequence title be?', 'Use Selected title, and export it too.', 'The saved sequence is ready. Export needs a separate request.',
        ])
    })

    it('binds duplicate acknowledgements to their original user', async () => {
        const test = await runtimeFixture()
        const request = test.request('client-id')
        expect(await test.service.submit(request, 'user')).toMatchObject({ status: 'accepted' })
        expect(await test.service.submit(request, 'other')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_IDEMPOTENCY_CONFLICT' },
        })
        const query = {
            protocolVersion: 1 as const,
            workspaceId: request.workspaceId,
            conversationAssetId: request.conversationAssetId,
            clientMessageId: request.clientMessageId,
        }
        expect((await test.service.get(query, 'other')).acknowledgement).toBeUndefined()
        expect((await test.service.get(query, 'user')).acknowledgement).toMatchObject({ status: 'accepted' })
        expect(await test.service.submit(request, 'user')).toMatchObject({ status: 'duplicate' })
        expect((await test.repository.query(test.partition, 'TURN#')).items).toHaveLength(1)
    })

    it('answers a greeting through classification and one model turn without executing a media operation', async () => {
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => isClassifier(request) ? intent() : answer())
        const test = await runtimeFixture()
        const accepted = await test.service.submit(test.request('hello'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('done')
        expect(fixture.respond).toHaveBeenCalledTimes(2)
        const visibleRequest = fixture.respond.mock.calls.map(([request]) => request as MessageCreateParamsNonStreaming).find(request => !isClassifier(request))!
        expect(String(visibleRequest.system)).toContain('Describe action results and meaningful progress in product terms.')
        expect(String(visibleRequest.system)).toContain('Keep routine IDs, hashes, tool names, schemas and pagination out of visible replies')
        expect(String(visibleRequest.system)).toContain('Preserve exact source IDs and revisions inside tool calls and private context.')
        expect(String(visibleRequest.system)).toContain('do not speculate about authorization settings or configuration')
        expect((await test.meta()).run).toMatchObject({
            state: 'completed',
            budget: {
                modelCalls: 2,
                toolCalls: 0,
            },
        })
        const messages = await test.repository.query<{
            role: string
            text: string
        }>(test.partition, 'MESSAGE#')
        expect(messages.items.map(message => message.text)).toEqual(['hi', 'Hello.'])
        expect([...test.database.rows.values()].some(row => String(row.sk).startsWith('CHECKPOINT#'))).toBe(true)
        expect([...test.database.rows.values()].filter(row => String(row.sk).startsWith('OPERATION#'))).toEqual([])
        expect(test.metrics.authorizeRequest).toHaveBeenCalledTimes(2)
        expect(test.metrics.recordUsage).toHaveBeenCalledTimes(2)
    })

    it.each([false, true])('persists a pending tool, resumes its paired result once, and keeps the original execution author, narrow context: %s', async narrow => {
        let created = false
        let completed = false
        const execute = vi.fn(async () => { created = true

        return {
            status: 'pending',
            operationId: 'operation',
        } })
        const operations: ConversationMediaOperations = {
            advance: async () => ({
                pending: created && !completed,
                completed: created
                    && completed
                    ? [{
                        operationId: 'operation',
                        result: {
                            status: 'completed',
                            data: { result: 'saved' },
                        },
                    }]
                    : [],
            }),
            acknowledge: vi.fn(async () => {}),
            cancel: vi.fn(async () => {}),
        }
        const tool: CapabilityAgentTool = {
            name: 'create_test_sequence',
            description: 'Create the requested test sequence.',
            intent: 'execute',
            operationFamilies: ['sequence-edit'],
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
            },
            execute,
        }
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (isClassifier(request))
                return intent('execute')

            return !created ? response([{
                type: 'tool_use',
                id: 'create-call',
                name: tool.name,
                input: {},
            }]) : answer('The sequence is saved.')
        })
        const test = await runtimeFixture([tool], operations)

        if (narrow)
            await test.service.settings({
                protocolVersion: 1,
                workspaceId: 'workspace',
                conversationAssetId: (await test.meta()).conversationAssetId,
                expectedRevision: 1,
                patch: { contextMode: 'discovery' },
            }, 'user')

        const submitted = test.request('create', 'Create a sequence.', { settingsRevision: narrow ? 2 : 1 })
        const accepted = await test.service.submit(submitted, 'user')
        const job = await test.dispatch(accepted)
        expect(await test.runtime.execute(job)).toBe('defer')
        expect((await test.meta()).run?.state).toBe('waiting-tools')
        expect(execute).toHaveBeenCalledOnce()
        expect(await test.service.submit(submitted, 'other')).toMatchObject({ status: 'rejected' })
        expect(await test.service.submit(test.request('other-steer', 'Change it.', { settingsRevision: narrow ? 2 : 1 }), 'other')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_ACTIVE_AUTHOR_CONFLICT' },
        })

        if (narrow) {
            await test.service.settings({
                protocolVersion: 1,
                workspaceId: 'workspace',
                conversationAssetId: (await test.meta()).conversationAssetId,
                expectedRevision: 2,
                patch: { contextMode: 'explicit' },
            }, 'user')
            expect(await test.runtime.execute(job)).toBe('defer')
            expect(execute).toHaveBeenCalledOnce()
            expect(fixture.respond).toHaveBeenCalledTimes(2)
            expect(await test.repository.read(test.partition, `CONTEXT_SCOPE#${job.turnId}`)).toMatchObject({
                contextMode: 'explicit',
                revision: 3,
            })
        }

        completed = true
        expect(await test.runtime.execute(job)).toBe('done')
        expect(execute).toHaveBeenCalledOnce()
        expect((await test.meta()).run?.state).toBe('completed')
        expect(fixture.respond).toHaveBeenCalledTimes(3)
        expect(JSON.stringify(fixture.respond.mock.calls.at(-1)?.[0].messages)).toContain('saved')
        expect(fixture.respond.mock.calls.at(-1)?.[0].tools.some(tool => tool.name === 'discover_workspace')).toBe(false)
        expect(operations.acknowledge).toHaveBeenCalled()
        expect(test.metrics.authorizeRequest.mock.calls.every(([request]) => request.userId === 'user')).toBe(true)
    })

    it('resumes a native clarification interrupt only for the accepted author', async () => {
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => isClassifier(request) ? fixture.respond.mock.calls.length === 1 ? intent('chat', 'Which source should I use?') : intent() : answer('Understood.'))
        const test = await runtimeFixture()
        const accepted = await test.service.submit(test.request('ambiguous', 'Use that.'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        const waiting = await test.meta()
        expect(waiting.run?.state).toBe('waiting-input')
        expect(waiting.run?.interruptId).toBeTruthy()
        expect(fixture.respond).toHaveBeenCalledOnce()
        expect(await test.service.submit(test.request('foreign-answer', 'The first one.', { interruptId: waiting.run!.interruptId }), 'other')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_ACTIVE_AUTHOR_CONFLICT' },
        })
        const answered = await test.service.submit(test.request('answer', 'I only meant to discuss it.', {
            interruptId: waiting.run!.interruptId,
            midRunPolicy: 'queue',
        }), 'user')
        expect(await test.service.submit(test.request('second-answer', 'Another answer.', {
            interruptId: waiting.run!.interruptId,
        }), 'user')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_INTERRUPT_ALREADY_ANSWERED' },
        })
        expect(await test.runtime.execute(await test.dispatch(answered))).toBe('done')
        expect((await test.meta()).run).toMatchObject({
            state: 'completed',
            continuationEpoch: 1,
        })
        expect(fixture.respond).toHaveBeenCalledTimes(3)
    })

    it('applies same-author steering at the next model boundary without restarting the completed classification', async () => {
        const test = await runtimeFixture()
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (fixture.respond.mock.calls.length === 1) {
                expect(await test.service.submit(test.request('foreign-steer', 'Run a different operation.'), 'other')).toMatchObject({
                    status: 'rejected',
                    error: { code: 'CONVERSATION_ACTIVE_AUTHOR_CONFLICT' },
                })
                await test.service.submit(test.request('steer', 'Discuss the plan first.'), 'user')
            }

            return isClassifier(request) ? intent() : answer('Let us discuss it.')
        })
        const accepted = await test.service.submit(test.request('first'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('done')
        expect((await test.meta()).run).toMatchObject({
            state: 'completed',
            continuationEpoch: 1,
            budget: { modelCalls: 3 },
        })
        expect(fixture.respond).toHaveBeenCalledTimes(3)
        const turns = await test.repository.query<ConversationTurn>(test.partition, 'TURN#')
        expect(turns.items.map(turn => turn.state)).toEqual(['completed', 'completed'])
    })

    it('stops new work and leaves another author queued until explicit resume', async () => {
        const operations: ConversationMediaOperations = {
            advance: async () => ({
                pending: false,
                completed: [],
            }),
            acknowledge: async () => {},
            cancel: vi.fn(async () => {}),
        }
        const test = await runtimeFixture([], operations)
        let queued!: ConversationAcknowledgement
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (fixture.respond.mock.calls.length === 1) {
                queued = await test.service.submit(test.request('queued', 'Discuss the next step.', { midRunPolicy: 'queue' }), 'other')
                const meta = await test.meta()
                await test.service.stop({
                    protocolVersion: 1,
                    workspaceId: 'workspace',
                    conversationAssetId: meta.conversationAssetId,
                    runId: meta.run!.runId,
                    clientCommandId: 'stop',
                }, 'user')
            }

            return isClassifier(request) ? intent() : answer('The queued turn ran.')
        })
        const accepted = await test.service.submit(test.request('first'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        const stopped = await test.meta()
        expect(stopped).toMatchObject({
            queuePaused: true,
            run: { state: 'stopped' },
        })
        expect(operations.cancel).toHaveBeenCalledOnce()
        expect(fixture.respond).toHaveBeenCalledOnce()
        expect(await test.runtime.execute(await test.dispatch(queued))).toBe('defer')
        await test.service.queue({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: stopped.conversationAssetId,
            expectedRevision: stopped.queueRevision,
            clientCommandId: 'resume',
            action: 'resume',
            turnIds: [],
        }, 'other')
        expect(await test.runtime.execute(await test.dispatch(queued))).toBe('done')
        expect((await test.meta()).run?.state).toBe('completed')
        expect(test.metrics.authorizeRequest.mock.calls.at(-1)?.[0]).toMatchObject({ userId: 'other' })
    })

    it('allows another author to stop first and executes their message under their own account scope', async () => {
        const operations: ConversationMediaOperations = {
            advance: async () => ({
                pending: false,
                completed: [],
            }),
            acknowledge: async () => {},
            cancel: vi.fn(async () => {}),
        }
        const test = await runtimeFixture([], operations)
        let replacement!: ConversationAcknowledgement
        fixture.respond.mockImplementation(async (request: MessageCreateParamsNonStreaming) => {
            if (fixture.respond.mock.calls.length === 1)
                replacement = await test.service.submit(test.request('replacement', 'Start over with discussion.', { midRunPolicy: 'stop-first' }), 'other')

            return isClassifier(request) ? intent() : answer('Starting over.')
        })
        const accepted = await test.service.submit(test.request('first'), 'user')
        expect(await test.runtime.execute(await test.dispatch(accepted))).toBe('defer')
        expect((await test.meta()).run?.state).toBe('stopped')
        expect(operations.cancel).toHaveBeenCalledOnce()
        expect(await test.runtime.execute(await test.dispatch(replacement))).toBe('done')
        expect((await test.meta()).run?.state).toBe('completed')
        expect(test.metrics.authorizeRequest.mock.calls.at(-1)?.[0]).toMatchObject({ userId: 'other' })
    })
})
