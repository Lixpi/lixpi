import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ProviderUsageClient } from '@lixpi/usage-reporter'
import { type MediaPipelineContext } from '@lixpi/capability-system/backend'
import { MediaPipelinePromptAdapter } from './media-pipeline-prompt-adapter.ts'
import { AgentExecutionScope, type AgentExecution } from '../llm/agent/agent-execution-scope.ts'
import { createConversationExecutionFixture } from '../llm/agent/conversation-test-support.ts'

const mocks = vi.hoisted(() => ({
    model: vi.fn(),
    invoke: vi.fn(),
    payloads: vi.fn(),
    constructions: vi.fn(),
    available: vi.fn(),
    resolve: vi.fn(),
}))
vi.mock('../models/ai-model.ts', () => ({ default: {
    getAiModel: mocks.model,
    getAvailableAiModels: mocks.available,
} }))
vi.mock('../llm/providers/bedrock-inference.ts', () => ({ bedrockInference: {
    isEnabledFor: () => true,
    resolveModelId: mocks.resolve,
} }))
vi.mock('../llm/agent/agent-payload-store.ts', () => ({ AgentPayloadStore: class { constructor() { return mocks.payloads() } } }))
vi.mock('../llm/agent/agent-context.ts', () => ({ AgentContext: class { assertSources = async () => {}; pinned = async () => 'Frozen source content'; modelMessages = async messages => messages } }))
vi.mock('../llm/agent/agent-bedrock-model.ts', () => ({
    resolveAgentReasoningOptions: () => ({ reasoningEffort: 'low' }),
    AgentBedrockModel: class {
        constructor(private readonly options) { mocks.constructions(options) }
        bindTools = () => ({ invoke: async (messages, options) => await this.options.calls.execute({
            requestKey: JSON.stringify({
                messages,
                profile: this.options.profile,
                route: await this.options.resolveModelId(),
            }),
            modelId: this.options.profile.modelVersion,
            estimatedUnits: 20,
            invoke: async observe => { const result = await mocks.invoke(messages, options); observe({
                promptTokens: 10,
                completionTokens: 10,
            }, 'provider-prompt')

            return result },
        }) })
    },
}))
vi.mock('../services/account-request-context.ts', () => ({ AccountRequestContext: {
    assertActive: () => {},
    prepareCleanup: callback => callback,
} }))

const fixture = async () => {
    const durable = await createConversationExecutionFixture()
    mocks.payloads.mockReturnValue(durable.payloads)
    mocks.resolve.mockResolvedValue('bedrock-model')
    const scope: AgentExecution = {
        owner: durable.owner,
        turn: {
            ...durable.turn,
            settings: {
                ...durable.turn.settings,
                models: {
                    ...durable.turn.settings.models,
                    reasoningModelIds: ['Anthropic:reasoning'],
                },
            },
        },
        responseMessageId: 'response',
        continuationEpoch: 0,
        intent: {
            intent: 'plan',
            operationFamilies: [],
            targetAssetIds: [],
            confidence: 1,
            needsClarification: false,
        },
        createdAssetIds: new Set(),
    }
    const context: MediaPipelineContext = {
        userId: 'user',
        organizationId: 'org',
        workspaceId: 'workspace',
        conversationAssetId: 'conversation',
        turnId: 'turn',
        runId: 'run-turn',
        responseMessageId: 'response',
        epoch: durable.owner.epoch,
        continuationEpoch: 0,
        authority: 'scope',
    }
    mocks.available.mockResolvedValue({
        models: [{
            provider: 'Anthropic',
            model: 'reasoning',
        }],
        defaultModels: { reasoning: 'Anthropic:reasoning' },
    })
    mocks.model.mockResolvedValue({
        model: 'reasoning',
        modelVersion: 'reasoning',
        maxCompletionSize: 8192,
        inferenceProviderCalledByThePlatform: 'aws-bedrock',
        inferenceProviders: { 'aws-bedrock': { pricing: {
            currency: 'USD',
            tokens: {
                measuringUnit: 'tokens',
                pricePer: '1000000',
                prompt: '1',
                completion: '2',
            },
        } } },
    })
    mocks.invoke.mockResolvedValue({ tool_calls: [{
        name: 'prepared_image_prompt',
        args: { prompt: 'A complete image prompt.' },
    }] })
    const metrics = {
        enabled: true,
        authorizeRequest: vi.fn(async () => ({
            authorized: true,
            authorizationId: 'auth',
        })),
        recordUsage: vi.fn(async () => {}),
        completeRequest: vi.fn(async () => {}),
    }
    const ports = new MediaPipelinePromptAdapter(durable.repository, metrics as unknown as ProviderUsageClient).ports()

    return {
        ...durable,
        scope,
        context,
        metrics,
        ports,
    }
}
beforeEach(() => vi.resetAllMocks())

describe('metered matrix prompt preparation', () => {
    it('retains a native result for replay and keeps internal prompt text out of the visible response', async () => {
        const f = await fixture()
        const request = {
            modelId: 'Anthropic:reasoning',
            preparationId: 'preparation',
            systemPrompt: 'Prepare a prompt.',
            userPrompt: 'A sphere.',
            sources: [],
        }
        await AgentExecutionScope.run(f.scope, async () => {
            await f.ports.validateModels(f.context, [request.modelId], {
                id: 'matrix',
                inputHash: 'input',
            })
            expect(await f.ports.prepare(f.context, request)).toBe('A complete image prompt.')
            expect(await f.ports.prepare(f.context, request)).toBe('A complete image prompt.')
        })
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
        expect(mocks.invoke.mock.calls[0][1]).toMatchObject({ emitText: false })
        expect(mocks.constructions.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'low' })
        expect(f.metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ providerRequestId: 'provider-prompt' }))
    })

    it('rejects an unselected model, a changed preparation ID and unauthorized source before inference', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.ports.validateModels(f.context, ['Anthropic:other'], {
                id: 'matrix',
                inputHash: 'input',
            })).rejects.toThrow('PIPELINE_REASONING_MODEL_NOT_SELECTED')
            await f.ports.validateModels(f.context, ['Anthropic:reasoning'], {
                id: 'matrix',
                inputHash: 'input',
            })
            await expect(f.ports.validateModels(f.context, ['Anthropic:reasoning'], {
                id: 'matrix',
                inputHash: 'different',
            })).rejects.toThrow('PIPELINE_PROMPT_PREPARATION_CONFLICT')
            await expect(f.ports.prepare(f.context, {
                modelId: 'Anthropic:reasoning',
                preparationId: 'preparation',
                systemPrompt: 'Prepare.',
                userPrompt: 'A sphere.',
                sources: [{
                    assetId: 'unavailable',
                    sourceId: 'source',
                    kind: 'image',
                    revision: 1,
                    blobHash: 'hash',
                }],
            })).rejects.toThrow('AGENT_READ_TARGET_NOT_IN_CONTEXT')
        })
        expect(mocks.invoke).not.toHaveBeenCalled()
    })

    it('does not repeat an uncertain call after route and model-control refreshes', async () => {
        const f = await fixture()
        const request = {
            modelId: 'Anthropic:reasoning',
            preparationId: 'preparation',
            systemPrompt: 'Prepare a prompt.',
            userPrompt: 'A sphere.',
            sources: [],
        }
        mocks.invoke.mockRejectedValueOnce(new Error('SOCKET_CLOSED'))
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.ports.prepare(f.context, request)).rejects.toThrow('SOCKET_CLOSED')
            mocks.resolve.mockResolvedValue('updated-route')
            mocks.model.mockResolvedValue({
                ...await mocks.model(),
                maxCompletionSize: 2048,
            })
            await expect(f.ports.prepare(f.context, request)).rejects.toThrow('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
        })
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
        expect(mocks.resolve).toHaveBeenCalledTimes(1)
        expect(f.metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect(mocks.constructions.mock.calls[1][0]).toMatchObject({ maxTokens: 4096 })
        expect(await mocks.constructions.mock.calls[1][0].resolveModelId()).toBe('bedrock-model')
    })

    it('rejects a changed model version before another prompt preparation call', async () => {
        const f = await fixture()
        const request = {
            modelId: 'Anthropic:reasoning',
            preparationId: 'preparation',
            systemPrompt: 'Prepare a prompt.',
            userPrompt: 'A sphere.',
            sources: [],
        }
        await AgentExecutionScope.run(f.scope, async () => {
            await f.ports.prepare(f.context, request)
            mocks.model.mockResolvedValue({
                ...await mocks.model(),
                modelVersion: 'updated-version',
            })
            await expect(f.ports.prepare(f.context, request)).rejects.toThrow('AGENT_REASONING_MODEL_CHANGED')
        })
        expect(mocks.constructions).toHaveBeenCalledTimes(1)
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
    })
})
