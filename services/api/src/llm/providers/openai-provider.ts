'use strict'

import * as process from 'process'

import OpenAI, { toFile } from 'openai'
import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '../config.ts'
import type { ProviderState } from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import {
    convertAttachmentsForProvider,
    parseDataUrl,
    resolveImageUrls,
} from '../utils/attachments.ts'
import {
    applyImagePromptLimitToSystemPrompt,
    buildImagePromptRewriteInstruction,
    extractToolCall,
    extractReferenceImages,
    getToolForProvider,
} from '../tools/image-generation.ts'

type ImageRefFile = { file: File | Awaited<ReturnType<typeof toFile>>; name: string }

export class OpenAIProvider extends BaseProvider {
    readonly providerName: ProviderName = 'OpenAI'
    private readonly client: OpenAI

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
        this.client = new OpenAI({ apiKey })
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const messages = state.messages
        const modelVersion = state.modelVersion
        const temperature = state.temperature ?? 0.7
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const supportsSystemPrompt = state.aiModelMetaInfo?.supportsSystemPrompt ?? true
        const enableImageGeneration = state.enableImageGeneration ?? false
        const imageSize = state.imageSize ?? 'auto'
        const hasImageModel = !!state.imageModelVersion
        const injectTool = hasImageModel && !enableImageGeneration
        const maxTokens = state.maxCompletionSize

        const inputMessages: Array<{ role: string; content: any }> = []
        for (const msg of messages) {
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            content = convertAttachmentsForProvider(content, 'OPENAI')
            inputMessages.push({ role: msg.role, content })
        }

        let instructions: string | undefined
        if (supportsSystemPrompt) {
            instructions = getSystemPrompt(hasImageModel)
            if (hasImageModel) {
                instructions = applyImagePromptLimitToSystemPrompt(
                    instructions,
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                ) ?? instructions
            }
        }

        const tools = this.buildImageGenerationTools(enableImageGeneration, imageSize) ?? []
        if (injectTool) {
            tools.push(getToolForProvider('OpenAI', state.imageModelMetaInfo, state.imageProviderName))
        }

        try {
            // Skip START_STREAM when called as image model (via ImageRouter) —
            // the parent text stream already manages the lifecycle.
            if (!enableImageGeneration) this.publisher.start()

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
                if (!enableImageGeneration) this.publisher.end()
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
                enableImageGeneration,
                workspaceId,
                aiChatThreadId,
            })

            if (!enableImageGeneration) this.publisher.end()
            return update
        } catch (e: any) {
            err(`OpenAI streaming failed: ${e?.message ?? e}`)
            return { error: e?.message ?? String(e) }
        }
    }

    private buildImageGenerationTools(
        enableImageGeneration: boolean,
        imageSize: string,
    ): Array<Record<string, any>> | undefined {
        if (!enableImageGeneration) return undefined
        return [{
            type: 'image_generation',
            quality: 'high',
            moderation: 'low',
            input_fidelity: 'high',
            partial_images: 3,
            size: imageSize || 'auto',
        }]
    }

    private async generateViaResponsesApi(args: {
        state: ProviderState
        inputMessages: Array<{ role: string; content: any }>
        modelVersion: string
        instructions: string | undefined
        temperature: number
        maxTokens: number | undefined
        tools: Array<Record<string, any>> | undefined
        hasImageModel: boolean
        enableImageGeneration: boolean
        workspaceId: string
        aiChatThreadId: string
    }): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = {}
        const requestKwargs: Record<string, any> = {
            model: args.modelVersion,
            input: args.inputMessages,
            instructions: args.instructions,
            temperature: args.temperature,
            stream: true,
            store: false,
        }
        if (args.maxTokens && args.maxTokens > 0) {
            requestKwargs.max_output_tokens = args.maxTokens
        }
        if (args.tools) requestKwargs.tools = args.tools

        const stream = await this.client.responses.create(requestKwargs as any, {
            signal: this.signal,
        })

        let imagesGenerated = 0
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

                    if (args.hasImageModel) {
                        const toolCall = extractToolCall('OpenAI', response)
                        if (toolCall) {
                            update.generatedImagePrompt = toolCall.prompt
                            update.referenceImages = extractReferenceImages(args.state.messages)
                            info(
                                `[OpenAI:${this.instanceKey}] Tool call detected: generate_image ` +
                                `promptLen=${toolCall.prompt.length}`,
                            )
                        } else {
                            warn(`OpenAI did not emit generate_image tool call for ${this.instanceKey}`)
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
                        this.publisher.error(message, code, type)
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
        const referenceFiles: ImageRefFile[] = []

        // Extract prompt + reference images from the last user message.
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
                    } else if (blockType === 'input_image' || blockType === 'image_url') {
                        let url = (block as any).image_url
                        if (typeof url === 'object' && url !== null) url = url.url ?? ''
                        if (typeof url === 'string' && url.startsWith('data:')) {
                            try {
                                const { mediaType, base64 } = parseDataUrl(url)
                                const buf = Buffer.from(base64, 'base64')
                                const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
                                const file = await toFile(buf, `reference.${ext}`, { type: mediaType })
                                referenceFiles.push({ file, name: `reference.${ext}` })
                            } catch (e) {
                                warn(`Failed to convert data URL to file: ${e}`)
                            }
                        }
                    }
                }
                prompt = textParts.join(' ')
            }
            break
        }

        if (!prompt) throw new Error('No user prompt found for image generation')

        const hasReferences = referenceFiles.length > 0
        info(
            `Generating image via images.${hasReferences ? 'edit' : 'generate'} with model: ` +
            `${args.modelVersion}, size: ${args.imageSize}, references: ${referenceFiles.length}`,
        )

        // Send placeholder for animated border.
        await this.imagePub.partial('', 0)

        const resolvedSize = args.imageSize || 'auto'

        const stream = hasReferences
            ? await this.client.images.edit({
                model: args.modelVersion,
                image: referenceFiles.length > 1
                    ? referenceFiles.map(r => r.file)
                    : referenceFiles[0]!.file,
                prompt,
                quality: 'high',
                size: resolvedSize,
                stream: true,
                partial_images: 3,
            } as any, { signal: this.signal })
            : await this.client.images.generate({
                model: args.modelVersion,
                prompt,
                quality: 'high',
                size: resolvedSize,
                stream: true,
                partial_images: 3,
            } as any, { signal: this.signal })

        let finalImage: any = null
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
                finalImage = event
            }
        }

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

    protected override async rewriteImagePromptToFitLimit(
        state: ProviderState,
        prompt: string,
        maxChars: number,
    ): Promise<string | undefined> {
        const response = await this.client.responses.create({
            model: state.modelVersion,
            input: [{ role: 'user', content: `Original image prompt:\n${prompt}` }],
            instructions: buildImagePromptRewriteInstruction(maxChars),
            temperature: 0.2,
            max_output_tokens: Math.max(256, Math.ceil((maxChars + 3) / 4) + 128),
            store: false,
        } as any)
        const out = this.extractResponseText(response)
        return out || undefined
    }
}
