import {
    HumanMessage,
    SystemMessage,
} from '@langchain/core/messages'
import {
    type MediaPipelinePromptModelPort,
} from '@lixpi/capability-system/backend'
import {
    pricingForCalledInferenceProvider,
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import AiModel from '../models/ai-model.ts'
import { bedrockInference } from '../llm/providers/bedrock-inference.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import {
    AgentBedrockModel,
    resolveAgentReasoningOptions,
} from '../llm/agent/agent-bedrock-model.ts'
import { AgentModelCalls } from '../llm/agent/agent-model-calls.ts'
import { AgentModelSnapshot } from '../llm/agent/agent-model-snapshot.ts'
import { AgentPayloadStore } from '../llm/agent/agent-payload-store.ts'
import { AgentContext } from '../llm/agent/agent-context.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'

export class MediaPipelinePromptAdapter {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly metrics: ProviderUsageClient,
    ) {}

    ports(): MediaPipelinePromptModelPort {
        return {
            validateModels: async (
                _context,
                modelIds,
                preparation,
            ) => {
                const scope = await AgentExecutionScope.authorize('plan')
                const key = `PIPELINE_PROMPTS#${scope.turn.turnId}#${preparation.id}`
                const saved = await this.repository.read<{ inputHash: string }>(scope.owner.partition, key)

                if (
                    saved
                    && saved.inputHash !== preparation.inputHash
                )
                    throw new Error('PIPELINE_PROMPT_PREPARATION_CONFLICT')

                for (const modelId of modelIds)
                    await this.profile(modelId)

                if (!saved)
                    await this.repository.commit([...await scope.owner.fences(scope.continuationEpoch), this.repository.put(
                        scope.owner.partition,
                        key,
                        { inputHash: preparation.inputHash },
                    )])
            },
            prepare: async (context, request) => {
                const scope = await AgentExecutionScope.authorize('plan')
                await AgentExecutionScope.assertReadTargets(
                    request.sources.map(source => source.assetId),
                )

                if (
                    context.runId !== (await scope.owner.read()).run?.runId
                    || context.turnId !== scope.turn.turnId
                )
                    throw new Error('PIPELINE_PROMPT_SCOPE_MISMATCH')

                const payloads = new AgentPayloadStore(context.organizationId, context.conversationAssetId)
                const snapshot = await new AgentModelSnapshot(
                    this.repository,
                    payloads,
                    version => bedrockInference.resolveModelId('anthropic', version),
                ).load(
                    scope.owner,
                    request.modelId,
                    await this.profile(request.modelId, false),
                    JSON.stringify(['pipeline-prompt', request.preparationId, request.modelId]),
                )
                const { profile } = snapshot
                const sources = new AgentContext(
                    this.repository,
                    scope.owner,
                    {
                        ...scope.turn,
                        references: request.sources.map(
                            source =>
                                ({
                                    assetId: source.assetId,
                                    role: ['image', 'video', 'audio'].includes(source.kind)
                                        ? 'media'
                                        : source.kind === 'text'
                                            ? 'content'
                                            : 'artifact',
                                    revision: source.revision,
                                    ...(source.blobHash ? { blobHash: source.blobHash } : {}),
                                    ...(source.documentVersion ? { documentVersion: source.documentVersion } : {}),
                                    ...(source.renditionId ? { renditionId: source.renditionId } : {}),
                                    acquiredBy: 'explicit',
                                    relationshipPath: [source.assetId],
                                }),
                        ),
                    },
                    payloads,
                )
                await sources.assertSources()
                const model = new AgentBedrockModel({
                    profile,
                    ...resolveAgentReasoningOptions(
                        profile,
                        request.modelId,
                        scope.turn.settings.models.reasoningOptions?.configGroups,
                    ),
                    maxTokens: Math.min(profile.maxCompletionSize, 4096),
                    resolveModelId: async () => snapshot.resolvedModelId,
                    calls: new AgentModelCalls(
                        scope.owner,
                        this.repository,
                        payloads,
                        this.metrics,
                        scope.continuationEpoch,
                    ),
                })
                const result = await model.bindTools(
                    [{
                        name: 'prepared_image_prompt',
                        description: 'Return the complete image-generation prompt.',
                        input_schema: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['prompt'],
                            properties: { prompt: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 10000,
                            } },
                        },
                    }],
                    { tool_choice: 'auto' },
                ).invoke(
                    await sources.modelMessages(
                        [new SystemMessage(request.systemPrompt), new HumanMessage({
                            id: request.preparationId,
                            content: `${request.userPrompt}\n\n${await sources.pinned()}`,
                        })],
                        profile.inferenceCapabilities,
                    ),
                    {
                        signal: scope.owner.abort.signal,
                        emitText: false,
                    },
                )
                const prompt = result.tool_calls?.length === 1
                    && result.tool_calls[0].name === 'prepared_image_prompt'
                    ? result.tool_calls[0].args.prompt
                    : undefined

                if (
                    typeof prompt !== 'string'
                    || !prompt.trim()
                    || prompt.length > 10000
                )
                    throw new Error('PIPELINE_PREPARED_PROMPT_INVALID')

                return prompt
            },
        }
    }

    private async profile(
        modelId: string,
        validateRoute = true,
    ) {
        const scope = AgentExecutionScope.current()
        const available = await AiModel.getAvailableAiModels()
        const selected = scope.turn.settings.models.reasoningModelIds.length ? scope.turn.settings.models.reasoningModelIds : [available.defaultModels.reasoning]

        if (!selected.includes(modelId))
            throw new Error('PIPELINE_REASONING_MODEL_NOT_SELECTED')

        const meta = available.models.find(model => `${model.provider}:${model.model}` === modelId)

        if (
            !meta
            || meta.provider.toLowerCase() !== 'anthropic'
            || !bedrockInference.isEnabledFor('anthropic')
        )
            throw new Error('PIPELINE_REASONING_MODEL_UNAVAILABLE')

        const profile = await AiModel.getAiModel({
            provider: meta.provider,
            model: meta.model,
            omitPricing: false,
        })

        if (
            !profile
            || profile.inferenceProviderCalledByThePlatform !== 'aws-bedrock'
            || !pricingForCalledInferenceProvider(profile)
        )
            throw new Error('PIPELINE_REASONING_ROUTE_UNAVAILABLE')

        if (validateRoute)
            await bedrockInference.resolveModelId('anthropic', profile.modelVersion)

        return {
            ...profile,
            inferenceProviderCalledByThePlatform: 'aws-bedrock' as const,
        }
    }
}
