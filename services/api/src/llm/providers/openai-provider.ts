'use strict'

import * as process from 'process'

import OpenAI, { toFile } from 'openai'
import { info, warn, err } from '@lixpi/debug-tools'
import type { ImageReferenceCapabilities, ProviderName } from '@lixpi/constants'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderState } from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import {
    assertMessageInputKindsSupported,
    convertAttachmentsForProvider,
    resolveImageUrls,
} from '../utils/attachments.ts'
import type { ResolvedImageGenerationReference } from '../image-generation-references.ts'
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
    buildOpenAIRequiredCapabilityToolChoice,
    CapabilityModelToolExecutor,
    shouldExposeCapabilityModelTools,
} from '../../capability-system/capability-model-tool-executor.ts'
import {
    asOpenAITool,
    parseCapabilityToolArguments,
} from '@lixpi/capability-system/backend'
import { assessProviderInputBudget } from './provider-input-budget.ts'
import {
    STAINLESS_TRANSPORT_FAULT_NAMES,
    TRANSPORT_RETRY_BUDGET_MS,
} from '../utils/transport-retry.ts'
import { prependImageReferencePromptLegend } from './image-reference-adapters.ts'

type ImageRefFile = Pick<ResolvedImageGenerationReference,
    'role' |
    'byteLength' |
    'mediaType' |
    'sha256'
> & {
    file: File | Awaited<ReturnType<typeof toFile>>
    name: string
}

export const buildOpenAIImageReferenceFiles = async (
    references: readonly ResolvedImageGenerationReference[],
): Promise<ImageRefFile[]> => Promise.all(references.map(async reference => ({
    file: await toFile(reference.bytes, reference.fileName, { type: reference.mediaType }),
    name: reference.fileName,
    role: reference.role,
    byteLength: reference.byteLength,
    mediaType: reference.mediaType,
    sha256: reference.sha256,
})))

export const appendOpenAIImageGenerationReferences = (
    inputMessages: Array<{ role: string; content: any }>,
    references: readonly ResolvedImageGenerationReference[],
): void => {
    let lastUserMessage: { role: string; content: any } | undefined
    for (let index = inputMessages.length - 1; index >= 0; index--) {
        if (inputMessages[index]?.role === 'user') {
            lastUserMessage = inputMessages[index]
            break
        }
    }
    if (!lastUserMessage) throw new Error('No user prompt found for image generation')
    const existingContent = Array.isArray(lastUserMessage.content)
        ? lastUserMessage.content
        : [{ type: 'input_text', text: String(lastUserMessage.content ?? '') }]
    const prompt = existingContent.flatMap(block => (
        block?.type === 'input_text' || block?.type === 'text'
            ? [String(block.text ?? '')]
            : []
    )).join('\n')
    const nonTextContent = existingContent.filter(block => (
        block?.type !== 'input_text' && block?.type !== 'text'
    ))
    lastUserMessage.content = [
        {
            type: 'input_text',
            text: prependImageReferencePromptLegend(prompt, references),
        },
        ...nonTextContent,
        ...references.map(reference => ({
            type: 'input_image',
            image_url: reference.dataUrl,
            detail: 'high',
        })),
    ]
}

export class OpenAIProvider extends BaseProvider {
    readonly providerName: ProviderName = 'OpenAI'
    private readonly client: OpenAI

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
        this.client = new OpenAI({ apiKey })
    }

    // The OpenAI SDK wraps every socket failure in APIConnectionError.
    protected override get transportFaultNames(): readonly string[] {
        return STAINLESS_TRANSPORT_FAULT_NAMES
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        assertMessageInputKindsSupported(
            'OpenAI',
            state.modelVersion,
            state.aiModelMetaInfo.inferenceCapabilities,
            state.messages,
        )
        const messages = state.messages
        const modelVersion = state.modelVersion
        const temperature = state.temperature ?? 0.7
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const supportsSystemPrompt = state.aiModelMetaInfo.inferenceCapabilities.supportsSystemPrompt
        const enableImageGeneration = state.enableImageGeneration ?? false
        const imageSize = state.imageSize ?? 'auto'
        const hasImageModel = !!state.imageModelVersion
        const injectTool = hasImageModel && !enableImageGeneration
        const enableVideoGeneration = state.enableVideoGeneration ?? false
        const hasVideoModel = !!state.videoModelVersion
        const injectVideoTool = hasVideoModel && !enableImageGeneration && !enableVideoGeneration
        const maxTokens = state.maxCompletionSize

        const inputMessages: Array<{ role: string; content: any }> = []
        for (const msg of messages) {
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            content = convertAttachmentsForProvider(content, 'OPENAI')
            inputMessages.push({ role: msg.role, content })
        }

        const resolvedImageGenerationReferences = state.resolvedImageGenerationReferences ?? []
        if (enableImageGeneration && !modelVersion.startsWith('gpt-image-') && resolvedImageGenerationReferences.length > 0) {
            appendOpenAIImageGenerationReferences(inputMessages, resolvedImageGenerationReferences)
        }

        let instructions: string | undefined
        if (supportsSystemPrompt) {
            instructions = getSystemPrompt(hasImageModel, hasVideoModel)
            if (hasImageModel) {
                instructions = applyImagePromptLimitToSystemPrompt(
                    instructions,
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                ) ?? instructions
            }
        }

        const tools = this.buildImageGenerationTools(
            enableImageGeneration,
            imageSize,
            state.aiModelMetaInfo.imageReferenceCapabilities,
        ) ?? []
        if (injectTool) {
            tools.push(getToolForProvider('OpenAI', state.imageModelMetaInfo, state.imageProviderName))
        }
        if (injectVideoTool) {
            tools.push(getVideoToolForProvider('OpenAI'))
        }
        const capabilityToolExecutor = shouldExposeCapabilityModelTools(state)
            ? new CapabilityModelToolExecutor(state, this.capabilityDispatcher, {
                onGenerationTrace: trace => this.publisher.capabilityGenerationTrace(trace),
            })
            : undefined

        try {
            // Skip START_STREAM when called as image model (via ImageRouter) or
            // when called as video model (via VideoRouter) — the parent text
            // stream already manages the lifecycle.
            if (!enableImageGeneration && !enableVideoGeneration) this.publisher.start()

            // gpt-image-* models must use the dedicated Image API path.
            if (enableImageGeneration && modelVersion.startsWith('gpt-image-')) {
                const imageUpdate = await this.generateViaImageApi({
                    state,
                    inputMessages,
                    modelVersion,
                    imageSize,
                    workspaceId,
                    aiChatThreadId,
                })
                if (!enableImageGeneration && !enableVideoGeneration) this.publisher.end()
                return imageUpdate
            }

            const update = await this.generateViaResponsesApi({
                state,
                inputMessages,
                modelVersion,
                instructions,
                temperature,
                maxTokens,
                tools: tools.length > 0 ? tools : undefined,
                hasImageModel,
                hasVideoModel,
                enableImageGeneration,
                enableVideoGeneration,
                workspaceId,
                aiChatThreadId,
                capabilityToolExecutor,
            })

            if (!enableImageGeneration
                && !enableVideoGeneration
                && !state.pendingCapabilityOutputFinalizations?.length) this.publisher.end()
            return update
        } catch (e: any) {
            err(`OpenAI streaming failed: ${e?.message ?? e}`)
            const message = e?.message ?? String(e)
            if (!enableImageGeneration && !enableVideoGeneration) {
                this.publisher.error(message)
                this.publisher.end()
            }
            return { error: message }
        }
    }

    private buildImageGenerationTools(
        enableImageGeneration: boolean,
        imageSize: string,
        imageReferenceCapabilities: ImageReferenceCapabilities | undefined,
    ): Array<Record<string, any>> | undefined {
        if (!enableImageGeneration) return undefined
        return [{
            type: 'image_generation',
            quality: 'high',
            ...this.deps.mediaProviderDefinition.moderation.settings('', 'text'),
            ...(imageReferenceCapabilities?.inputFidelity === 'high'
                ? { input_fidelity: 'high' }
                : {}),
            partial_images: 3,
            size: imageSize || 'auto',
        }]
    }

    private async generateViaResponsesApi(args: {
        state: ProviderState
        inputMessages: Array<Record<string, any>>
        modelVersion: string
        instructions: string | undefined
        temperature: number
        maxTokens: number | undefined
        tools: Array<Record<string, any>> | undefined
        hasImageModel: boolean
        hasVideoModel: boolean
        enableImageGeneration: boolean
        enableVideoGeneration: boolean
        workspaceId: string
        aiChatThreadId: string
        capabilityToolExecutor?: CapabilityModelToolExecutor
        capabilityRound?: number
    }): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = {}
        const caps = args.state.aiModelMetaInfo.inferenceCapabilities
        const requestKwargs: Record<string, any> = {
            model: args.modelVersion,
            input: args.inputMessages,
            instructions: args.capabilityToolExecutor?.withCompletionInstruction(args.instructions)
                ?? args.instructions,
            stream: true,
            store: false,
        }
        if (caps.supportsTemperature) requestKwargs.temperature = args.temperature
        if (args.maxTokens && args.maxTokens > 0) {
            requestKwargs.max_output_tokens = args.maxTokens
        }
        const requestTools = [
            ...(args.tools ?? []),
            ...(args.capabilityToolExecutor?.definitions().map(asOpenAITool) ?? []),
        ]
        if (requestTools.length > 0) requestKwargs.tools = requestTools
        const pendingRequiredToolName = args.capabilityToolExecutor?.pendingRequiredToolName()
        if (pendingRequiredToolName) {
            requestKwargs.tool_choice = buildOpenAIRequiredCapabilityToolChoice(pendingRequiredToolName)
        } else if (!args.capabilityToolExecutor
            && !args.state.capabilityMediaExecutionPlan
            && !args.enableImageGeneration
            && !args.enableVideoGeneration
            && args.hasImageModel !== args.hasVideoModel) {
            requestKwargs.tool_choice = buildOpenAIRequiredCapabilityToolChoice(
                args.hasVideoModel ? VIDEO_TOOL_NAME : TOOL_NAME,
            )
        }
        assessProviderInputBudget({ state: args.state, request: requestKwargs })

        if (args.enableImageGeneration) {
            info(`[OpenAI:${this.instanceKey}] Responses-API image-gen call ${JSON.stringify({
                model: args.modelVersion,
                imageSize: args.state.imageSize,
                quality: 'high',
                inputFidelity: args.state.aiModelMetaInfo.imageReferenceCapabilities?.inputFidelity ?? 'provider-default',
                moderation: 'low',
                partialImages: 3,
                inputMessageCount: args.inputMessages.length,
                inputImageCount: args.inputMessages.reduce((count, m) => count + (Array.isArray(m.content)
                    ? m.content.filter((b: any) => b?.type === 'input_image' || b?.type === 'image_url').length
                    : 0), 0),
                promptLen: (args.inputMessages[args.inputMessages.length - 1]?.content as any)?.length ?? 0,
            }, null, 0)}`)
        }

        // Submit only. Once the stream starts emitting, tokens are published as
        // they arrive, so a restart would replay text the user already saw.
        const stream = await this.retryTransport(
                'responses',
            async () => await this.client.responses.create(requestKwargs as any, {
                signal: this.signal,
                maxRetries: 0,
            }),
        )

        let imagesGenerated = 0
        const generatedImages: string[] = []
        for await (const event of stream as any) {
            if (this.shouldStop) {
                info('Stream stopped by user request')
                break
            }
            switch (event.type) {
                case 'response.output_text.delta': {
                    const delta: string = event.delta ?? ''
                    if (delta) this.publisher.chunk(delta)
                    break
                }
                case 'response.output_item.added': {
                    const item = event.item
                    if (item?.type === 'image_generation_call') {
                        await this.imagePub.partial('', 0)
                    }
                    break
                }
                case 'response.image_generation_call.partial_image': {
                    const partialImage = event.partial_image_b64
                    const partialIndex = event.partial_image_index ?? 0
                    if (partialImage) {
                        await this.imagePub.partial(partialImage, partialIndex)
                    }
                    break
                }
                case 'response.completed': {
                    const response = event.response
                    update.responseId = response.id
                    update.aiVendorRequestId = response.id
                    if (response.usage) {
                        const usage = response.usage
                        update.usage = {
                            promptTokens: usage.input_tokens ?? 0,
                            promptAudioTokens: usage.input_tokens_audio ?? 0,
                            promptCachedTokens: usage.input_tokens_cached ?? 0,
                            completionTokens: usage.output_tokens ?? 0,
                            completionAudioTokens: usage.output_tokens_audio ?? 0,
                            completionReasoningTokens: usage.output_tokens_reasoning ?? 0,
                            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
                        }
                    }

                    const capabilityCalls = (response.output ?? []).flatMap((item: any) => {
                        if (item?.type !== 'function_call'
                            || !args.capabilityToolExecutor?.recognizes(item.name)) return []
                        return [{
                            callId: item.call_id ?? item.id ?? '',
                            name: item.name,
                            arguments: parseCapabilityToolArguments(item.arguments),
                        }]
                    })
                    if (capabilityCalls.length > 0) {
                        const round = args.capabilityRound ?? 0
                        if (round >= 4) throw new Error('Capability model-tool round limit exceeded')
                        const executions = []
                        for (const call of capabilityCalls) {
                            executions.push(await args.capabilityToolExecutor!.execute(call, this.signal))
                        }
                        const continuationInput = [
                            ...args.inputMessages,
                            ...(response.output ?? []),
                            ...executions.map(execution => ({
                                type: 'function_call_output',
                                call_id: execution.call.callId,
                                output: JSON.stringify(execution.result),
                            })),
                        ]
                        const continuation = await this.generateViaResponsesApi({
                            ...args,
                            inputMessages: continuationInput,
                            capabilityRound: round + 1,
                        })
                        return mergeProviderUpdates(update, continuation)
                    }

                    if (args.hasImageModel || args.hasVideoModel) {
                        const characterCreatorActive = args.state.capabilityUsageMode === 'character-creator'
                        const videoCall = args.hasVideoModel && !characterCreatorActive
                            ? extractVideoToolCall('OpenAI', response)
                            : undefined
                        const imageCall = args.hasImageModel && !videoCall ? extractToolCall('OpenAI', response) : undefined
                        if (videoCall) {
                            update.generatedVideoPrompt = videoCall.prompt
                            update.generatedVideoNegativePrompt = videoCall.negativePrompt
                            info(`[OpenAI:${this.instanceKey}] generate_video tool call ${JSON.stringify({
                                chatModel: args.modelVersion,
                                targetVideoProvider: args.state.videoProviderName,
                                targetVideoModel: args.state.videoModelVersion,
                                promptLen: videoCall.prompt.length,
                                negativePromptLen: videoCall.negativePrompt?.length ?? 0,
                            }, null, 0)}`)
                        } else if (imageCall) {
                            const refs = extractReferenceImages(args.state.messages)
                            update.generatedImagePrompt = imageCall.prompt
                            update.referenceImages = refs
                            info(`[OpenAI:${this.instanceKey}] generate_image tool call ${JSON.stringify({
                                chatModel: args.modelVersion,
                                targetImageProvider: args.state.imageProviderName,
                                targetImageModel: args.state.imageModelVersion,
                                promptLen: imageCall.prompt.length,
                                referenceImagesExtracted: refs.length,
                            }, null, 0)}`)
                        } else if (args.hasImageModel && args.state.capabilityMediaExecutionPlan) {
                            info(`[OpenAI:${this.instanceKey}] using required Capability media plan without a generate_image tool call (model=${args.modelVersion})`)
                        } else if (args.hasImageModel && args.hasVideoModel) {
                            warn(`[OpenAI:${this.instanceKey}] did not emit generate_image or generate_video (model=${args.modelVersion})`)
                        } else if (args.hasImageModel) {
                            warn(`[OpenAI:${this.instanceKey}] did not emit generate_image (model=${args.modelVersion}); image gen will not run`)
                        } else {
                            warn(`[OpenAI:${this.instanceKey}] did not emit generate_video (model=${args.modelVersion}); video gen will not run`)
                        }
                    }

                    // Native (Responses-API) image generation path.
                    if (response.output) {
                        for (const output of response.output) {
                            if (output.type === 'image_generation_call') {
                                const result = output.result
                                const revisedPrompt = output.revised_prompt ?? ''
                                if (result) {
                                    imagesGenerated += 1
                                    info(
                                        `Image generation completed, revised prompt: ` +
                                        `${(revisedPrompt as string).slice(0, 100)}`,
                                    )
                                    await this.imagePub.complete({
                                        imageBase64: result,
                                        responseId: response.id,
                                        revisedPrompt: revisedPrompt as string,
                                        imageModelId: args.state.modelVersion,
                                    })
                                    generatedImages.push(result)
                                }
                            }
                        }
                    }

                    if (response.usage) {
                        const u = response.usage
                        update.usage = {
                            promptTokens: u.input_tokens ?? 0,
                            promptAudioTokens: u.input_tokens_audio ?? 0,
                            promptCachedTokens: u.input_tokens_cached ?? 0,
                            completionTokens: u.output_tokens ?? 0,
                            completionAudioTokens: u.output_tokens_audio ?? 0,
                            completionReasoningTokens: u.output_tokens_reasoning ?? 0,
                            totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
                        }
                    }
                    break
                }
                case 'response.failed': {
                    const response = event.response
                    const errorObj = response.error
                    if (errorObj) {
                        const message = errorObj.message ?? 'Unknown error'
                        const code = errorObj.code
                        const type = errorObj.type
                        update.error = message
                        update.errorCode = code
                        update.errorType = type
                        update.responseId = response.id
                        err(`Response failed: ${message} (code: ${code}, type: ${type})`)
                        throw new Error(`OpenAI Responses API error: ${message}`)
                    }
                    break
                }
            }
        }

        if (imagesGenerated > 0) {
            update.imageUsage = {
                generatedCount: imagesGenerated,
                size: args.state.imageSize ?? 'auto',
                quality: 'high',
            }
            update.generatedImages = generatedImages
        }

        return update
    }

    private async generateViaImageApi(args: {
        state: ProviderState
        inputMessages: Array<{ role: string; content: any }>
        modelVersion: string
        imageSize: string
        workspaceId: string
        aiChatThreadId: string
    }): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = {}
        let prompt = ''
        const resolvedReferences = args.state.resolvedImageGenerationReferences ?? []
        const referenceFiles = await buildOpenAIImageReferenceFiles(resolvedReferences)

        // Extract the prompt from the last user message. Reference images are
        // already resolved once by BaseProvider's provider-neutral contract.
        for (let i = args.inputMessages.length - 1; i >= 0; i--) {
            const msg = args.inputMessages[i]!
            if (msg.role !== 'user') continue
            const content = msg.content
            if (typeof content === 'string') {
                prompt = content
            } else if (Array.isArray(content)) {
                const textParts: string[] = []
                for (const block of content) {
                    if (typeof block !== 'object' || block === null) continue
                    const blockType = (block as any).type
                    if (blockType === 'text' || blockType === 'input_text') {
                        textParts.push((block as any).text ?? '')
                    }
                }
                prompt = textParts.join(' ')
            }
            break
        }

        if (!prompt) throw new Error('No user prompt found for image generation')

        const hasReferences = referenceFiles.length > 0
        prompt = prependImageReferencePromptLegend(prompt, resolvedReferences)
        const imageReferenceCapabilities = args.state.aiModelMetaInfo.imageReferenceCapabilities
        const inputFidelityRequestValue = imageReferenceCapabilities?.inputFidelity === 'high' ? 'high' : undefined
        // The SDK's own retry loop is disabled so every reattempt goes through
        // the bounded, logged transport retry below instead of happening
        // invisibly with an unbounded-in-practice total duration.
        const imageRequestOptions = {
            signal: this.signal,
            maxRetries: 0,
        }
        info(`[OpenAI:${this.instanceKey}] image SDK call ${JSON.stringify({
            api: hasReferences ? 'images.edit' : 'images.generate',
            model: args.modelVersion,
            size: args.imageSize,
            quality: 'high',
            inputFidelity: imageReferenceCapabilities?.inputFidelity ?? 'provider-default',
            automaticRetries: imageRequestOptions.maxRetries,
            transportRetryBudgetMs: TRANSPORT_RETRY_BUDGET_MS,
            partialImages: 3,
            referenceFiles: referenceFiles.length,
            referenceFileNames: referenceFiles.map(r => r.name),
            referenceFileMetadata: referenceFiles.map(reference => ({
                name: reference.name,
                role: reference.role,
                byteLength: reference.byteLength,
                mediaType: reference.mediaType,
                sha256: reference.sha256,
            })),
            promptLen: prompt.length,
            promptPreview: prompt.slice(0, 200),
        }, null, 0)}`)

        // Send placeholder for animated border.
        await this.imagePub.partial('', 0)

        const resolvedSize = args.imageSize || 'auto'

        // Submitting and draining the stream are retried as one unit: a socket
        // that drops mid-stream leaves no usable image, so resuming is not
        // possible and only a fresh request can still produce this shot.
        const finalImage = await this.retryTransport(
                'image',
            async () => {
                const stream = hasReferences
                    ? await this.client.images.edit({
                        model: args.modelVersion,
                        image: referenceFiles.length > 1
                            ? referenceFiles.map(r => r.file)
                            : referenceFiles[0]!.file,
                        prompt,
                        ...this.deps.mediaProviderDefinition.moderation.settings(args.modelVersion, 'image-conditioned'),
                        quality: 'high',
                        ...(inputFidelityRequestValue ? { input_fidelity: inputFidelityRequestValue } : {}),
                        size: resolvedSize,
                        stream: true,
                        partial_images: 3,
                    } as any, imageRequestOptions)
                    : await this.client.images.generate({
                        model: args.modelVersion,
                        prompt,
                        ...this.deps.mediaProviderDefinition.moderation.settings(args.modelVersion, 'text'),
                        quality: 'high',
                        size: resolvedSize,
                        stream: true,
                        partial_images: 3,
                    } as any, imageRequestOptions)

                let completed: any = null
                for await (const event of stream as any) {
                    if (this.shouldStop) {
                        info('Image generation stopped by user request')
                        break
                    }
                    if (event.type && String(event.type).includes('partial_image')) {
                        const partialB64 = event.b64_json
                        const partialIdx = event.partial_image_index ?? 0
                        if (partialB64) {
                            await this.imagePub.partial(partialB64, partialIdx)
                        }
                    } else if (event.type && String(event.type).includes('completed')) {
                        completed = event
                    }
                }
                return completed
            },
        )

        if (finalImage) {
            const imageB64 = finalImage.b64_json
            const revisedPrompt = finalImage.revised_prompt ?? ''
            if (imageB64) {
                await this.imagePub.complete({
                    imageBase64: imageB64,
                    responseId: '',
                    revisedPrompt,
                    imageModelId: args.modelVersion,
                })
                update.generatedImages = [imageB64]
                update.imageUsage = {
                    generatedCount: 1,
                    size: args.imageSize || 'auto',
                    quality: 'high',
                }
            }
            const usage = finalImage.usage
            if (usage) {
                update.usage = {
                    promptTokens: usage.input_tokens ?? 0,
                    promptAudioTokens: 0,
                    promptCachedTokens: 0,
                    completionTokens: usage.output_tokens ?? 0,
                    completionAudioTokens: 0,
                    completionReasoningTokens: 0,
                    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
                }
                update.aiVendorRequestId = `openai-image-${args.workspaceId}`
            }
        }

        return update
    }

    private extractResponseText(response: any): string {
        if (typeof response.output_text === 'string' && response.output_text.trim()) {
            return response.output_text.trim()
        }
        const parts: string[] = []
        for (const item of response.output ?? []) {
            if (item?.type !== 'message') continue
            for (const c of item.content ?? []) {
                if (c?.type !== 'output_text' && c?.type !== 'text') continue
                if (typeof c.text === 'string' && c.text.trim()) parts.push(c.text.trim())
            }
        }
        return parts.join('\n').trim()
    }

}

function mergeProviderUpdates(
    first: Partial<ProviderState>,
    second: Partial<ProviderState>,
): Partial<ProviderState> {
    const firstUsage = first.usage
    const secondUsage = second.usage
    return {
        ...first,
        ...second,
        ...(firstUsage || secondUsage ? {
            usage: {
                promptTokens: (firstUsage?.promptTokens ?? 0) + (secondUsage?.promptTokens ?? 0),
                promptAudioTokens: (firstUsage?.promptAudioTokens ?? 0) + (secondUsage?.promptAudioTokens ?? 0),
                promptCachedTokens: (firstUsage?.promptCachedTokens ?? 0) + (secondUsage?.promptCachedTokens ?? 0),
                completionTokens: (firstUsage?.completionTokens ?? 0) + (secondUsage?.completionTokens ?? 0),
                completionAudioTokens: (firstUsage?.completionAudioTokens ?? 0) + (secondUsage?.completionAudioTokens ?? 0),
                completionReasoningTokens: (firstUsage?.completionReasoningTokens ?? 0) + (secondUsage?.completionReasoningTokens ?? 0),
                totalTokens: (firstUsage?.totalTokens ?? 0) + (secondUsage?.totalTokens ?? 0),
            },
        } : {}),
    }
}
