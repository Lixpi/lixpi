import * as process from 'process'

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import {
    info,
    warn,
    err,
} from '@lixpi/debug-tools'

import {
    BaseProvider,
    type BaseProviderDeps,
} from './base-provider.ts'
import { bedrockInference } from './bedrock-inference.ts'
import {
    type ProviderName,
} from '@lixpi/constants'
import {
    type ProviderState,
} from '../graph/state.ts'
import {
    getSystemPrompt,
    formatUserMessageWithHack,
} from '../prompts/load-prompts.ts'
import {
    assertMessageInputKindsSupported,
    convertAttachmentsForProvider,
    resolveImageUrls,
} from '../utils/attachments.ts'
import {
    TOOL_NAME,
    applyImagePromptLimitToSystemPrompt,
    extractToolCall,
    extractReferenceImages,
    getToolForProvider,
} from '../tools/image-generation.ts'
import {
    VIDEO_TOOL_NAME,
    extractVideoToolCall,
    getVideoToolForProvider,
} from '../tools/video-generation.ts'
import {
    buildAnthropicRequiredCapabilityToolChoice,
    CapabilityModelToolExecutor,
    shouldExposeCapabilityModelTools,
} from '../../capability-system/capability-model-tool-executor.ts'
import { asAnthropicTool } from '@lixpi/capability-system/backend'
import { assessProviderInputBudget } from './provider-input-budget.ts'
import {
    SMITHY_TRANSPORT_FAULT_NAMES,
    STAINLESS_TRANSPORT_FAULT_NAMES,
} from '../utils/transport-retry.ts'

export class AnthropicProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'
    private readonly client: Anthropic | AnthropicBedrock
    private readonly useBedrock: boolean

    constructor(
        instanceKey: string,
        deps: BaseProviderDeps,
    ) {
        super(instanceKey, deps)
        this.useBedrock = bedrockInference.isEnabledFor('anthropic')

        if (this.useBedrock) {
            bedrockInference.logRouting('anthropic', `Anthropic:${instanceKey}`)
            // No api key is involved on this path. AnthropicBedrock exposes no credential-provider
            // option, so it signs with the default AWS provider chain — which resolves AWS_PROFILE
            // against the SSO cache mounted into the container locally and the task role on AWS,
            // and refreshes expiring credentials on its own.
            this.client = new AnthropicBedrock({ awsRegion: bedrockInference.region })

            return
        }

        const apiKey = process.env.ANTHROPIC_API_KEY

        if (!apiKey)
            throw new Error('ANTHROPIC_API_KEY environment variable is required')

        this.client = new Anthropic({ apiKey })
    }

    // Both clients here are Stainless-generated and raise APIConnectionError.
    // On the Bedrock path the AWS signing layer underneath can surface its own
    // Smithy transient names before the SDK ever wraps them.
    protected override get transportFaultNames(): readonly string[] {
        return [
            ...STAINLESS_TRANSPORT_FAULT_NAMES,
            ...(this.useBedrock ? SMITHY_TRANSPORT_FAULT_NAMES : []),
        ]
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        assertMessageInputKindsSupported(
            'Anthropic',
            state.modelVersion,
            state.aiModelMetaInfo.inferenceCapabilities,
            state.messages,
        )
        const update: Partial<ProviderState> = {}

        const messages = state.messages
        const modelVersion = state.modelVersion
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const hasImageModel = !!state.imageModelVersion
        const hasVideoModel = !!state.videoModelVersion
        const maxTokens = state.maxCompletionSize ?? 4096
        const capabilities = state.aiModelMetaInfo.inferenceCapabilities

        // Convert messages to Anthropic format (resolve nats-obj://, then convert content blocks).
        const formatted: Array<{
            role: string
            content: any
        }> = []

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]!
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            content = convertAttachmentsForProvider(content, 'ANTHROPIC')

            // Apply Anthropic-specific code-block hack to last user string message.
            if (
                i === messages.length - 1
                && msg.role === 'user'
                && typeof content === 'string'
            )
                content = formatUserMessageWithHack(content, 'Anthropic')

            formatted.push({
                role: msg.role,
                content,
            })
        }

        const tools: Array<Record<string, any>> = []

        if (hasImageModel)
            tools.push(
                getToolForProvider(
                    'Anthropic',
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                ),
            )

        if (hasVideoModel)
            tools.push(
                getVideoToolForProvider('Anthropic'),
            )

        const capabilityToolExecutor = shouldExposeCapabilityModelTools(state)
            ? new CapabilityModelToolExecutor(
                state,
                this.capabilityDispatcher,
                {
                    onGenerationTrace: trace => this.publisher.capabilityGenerationTrace(trace),
                },
            )
            : undefined

        let systemPrompt = getSystemPrompt(hasImageModel, hasVideoModel)

        if (hasImageModel) {
            const adjusted = applyImagePromptLimitToSystemPrompt(
                systemPrompt,
                state.imageModelMetaInfo,
                state.imageProviderName,
            )

            if (adjusted)
                systemPrompt = adjusted
        }

        try {
            this.publisher.start()

            // Bedrock exposes the same models under its own ids (and cross-region inference
            // profiles), so the catalog id is translated here while logs keep the catalog id.
            const requestModel = this.useBedrock
                ? await bedrockInference.resolveModelId('anthropic', modelVersion)
                : modelVersion

            let roundMessages = formatted
            let finalMessage: any
            let promptTokens = 0
            let completionTokens = 0

            for (let round = 0; round <= 4; round++) {
                const streamArgs: Record<string, any> = {
                    model: requestModel,
                    messages: roundMessages,
                    max_tokens: maxTokens,
                    system: capabilityToolExecutor?.withCompletionInstruction(systemPrompt) ?? systemPrompt,
                }
                const reasoningEffort = state.reasoningGenerationConfig?.reasoningEffort

                if (reasoningEffort)
                    streamArgs.output_config = { effort: reasoningEffort }

                if (/claude-(?:opus-4-[678]|sonnet-4-6)(?:-|$)/u.test(modelVersion))
                    streamArgs.thinking = { type: 'adaptive' }

                const roundTools = [
                    ...tools,
                    ...(capabilityToolExecutor?.definitions().map(asAnthropicTool) ?? []),
                ]

                if (roundTools.length > 0)
                    streamArgs.tools = roundTools

                const pendingRequiredToolName = capabilityToolExecutor?.pendingRequiredToolName()

                if (
                    pendingRequiredToolName
                    && !capabilities.requiresAutoToolChoiceWithThinking
                )
                    streamArgs.tool_choice = buildAnthropicRequiredCapabilityToolChoice(pendingRequiredToolName)
                else if (
                    !capabilityToolExecutor
                    && !state.capabilityMediaExecutionPlan
                    && !capabilities.requiresAutoToolChoiceWithThinking
                    && hasImageModel !== hasVideoModel
                )
                    streamArgs.tool_choice = buildAnthropicRequiredCapabilityToolChoice(hasVideoModel ? VIDEO_TOOL_NAME : TOOL_NAME)

                assessProviderInputBudget({
                    state,
                    request: streamArgs,
                })
                // messages.stream() connects lazily, so a connection failure
                // only surfaces while draining. The drain is therefore retried
                // too, but only up to the first published token — past that a
                // restart would replay text the user already saw.
                finalMessage = await this.retryTransport('messages', async ({ markPublished }) => {
                    const stream = this.client.messages.stream(streamArgs as any, { signal: this.signal })

                    for await (const event of stream) {
                        if (this.shouldStop) {
                            info('Stream stopped by user request')

                            break
                        }

                        if (
                            event.type === 'content_block_delta'
                            && event.delta?.type === 'text_delta'
                        ) {
                            const text = (event.delta as any).text ?? ''

                            if (text) {
                                markPublished()
                                this.publisher.chunk(text)
                            }
                        }
                    }

                    return await stream.finalMessage()
                })
                promptTokens += finalMessage.usage?.input_tokens ?? 0
                completionTokens += finalMessage.usage?.output_tokens ?? 0
                const capabilityCalls = (finalMessage.content ?? []).flatMap((block: any) => {
                    if (
                        block?.type !== 'tool_use'
                        || !capabilityToolExecutor?.recognizes(block.name)
                    )
                        return []

                    return [{
                        callId: block.id ?? '',
                        name: block.name,
                        arguments: block.input ?? {},
                    }]
                })

                if (capabilityCalls.length === 0)
                    break

                if (round === 4)
                    throw new Error('Capability model-tool round limit exceeded')

                const executions = []

                for (const call of capabilityCalls) {
                    executions.push(await capabilityToolExecutor!.execute(call, this.signal))
                }

                roundMessages = [
                    ...roundMessages,
                    {
                        role: 'assistant',
                        content: finalMessage.content,
                    },
                    {
                        role: 'user',
                        content: executions.map(
                            execution => ({
                                type: 'tool_result',
                                tool_use_id: execution.call.callId,
                                content: JSON.stringify(execution.result),
                            }),
                        ),
                    },
                ]
            }

            if (!finalMessage)
                throw new Error('Anthropic returned no final message')

            if (
                hasImageModel
                || hasVideoModel
            ) {
                const characterCreatorActive = state.capabilityUsageMode === 'character-creator'
                const videoCall = hasVideoModel
                    && !characterCreatorActive
                    ? extractVideoToolCall('Anthropic', finalMessage)
                    : undefined
                const imageCall = hasImageModel
                    && !videoCall
                    ? extractToolCall('Anthropic', finalMessage)
                    : undefined

                if (videoCall) {
                    update.generatedVideoPrompt = videoCall.prompt
                    update.generatedVideoNegativePrompt = videoCall.negativePrompt
                    info(
                        `[Anthropic:${this.instanceKey}] generate_video tool call ${
                            JSON.stringify(
                                {
                                    chatModel: modelVersion,
                                    targetVideoProvider: state.videoProviderName,
                                    targetVideoModel: state.videoModelVersion,
                                    promptLen: videoCall.prompt.length,
                                    negativePromptLen: videoCall.negativePrompt?.length ?? 0,
                                },
                                null,
                                0,
                            )
                        }`,
                    )
                } else if (imageCall) {
                    const refs = extractReferenceImages(messages)
                    update.generatedImagePrompt = imageCall.prompt
                    update.referenceImages = refs
                    info(
                        `[Anthropic:${this.instanceKey}] generate_image tool call ${
                            JSON.stringify(
                                {
                                    chatModel: modelVersion,
                                    targetImageProvider: state.imageProviderName,
                                    targetImageModel: state.imageModelVersion,
                                    promptLen: imageCall.prompt.length,
                                    referenceImagesExtracted: refs.length,
                                },
                                null,
                                0,
                            )
                        }`,
                    )
                } else if (
                    hasImageModel
                    && state.capabilityMediaExecutionPlan
                )
                    info(
                        `[Anthropic:${this.instanceKey}] using required Capability media plan without a generate_image tool call (model=${modelVersion})`,
                    )
                else if (
                    hasImageModel
                    && hasVideoModel
                )
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_image or generate_video (model=${modelVersion})`)
                else if (hasImageModel)
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_image (model=${modelVersion}); image gen will not run`)
                else
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_video (model=${modelVersion}); video gen will not run`)
            }

            if (finalMessage.usage) {
                // Anthropic reports prompt caching as separate cache_read_input_tokens /
                // cache_creation_input_tokens (input_tokens EXCLUDES them). We don't capture
                // those yet, so promptCachedTokens stays 0. If added later, fold cache reads
                // into promptTokens AND promptCachedTokens to preserve the cached ⊆ prompt
                // invariant in the reported usage.
                update.usage = {
                    promptTokens,
                    promptAudioTokens: 0,
                    promptCachedTokens: 0,
                    completionTokens,
                    completionAudioTokens: 0,
                    completionReasoningTokens: 0,
                    totalTokens: promptTokens + completionTokens,
                }
                update.aiVendorRequestId = finalMessage.id
            }

            if (!state.pendingCapabilityOutputFinalizations?.length)
                this.publisher.end()
        } catch (e: any) {
            err(`Anthropic streaming failed: ${e?.message ?? e}`)
            update.error = e?.message ?? String(e)
            this.publisher.error(update.error)
            this.publisher.end()
        }

        return update
    }
}
