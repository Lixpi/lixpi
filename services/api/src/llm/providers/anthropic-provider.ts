'use strict'

import * as process from 'process'

import Anthropic from '@anthropic-ai/sdk'
import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '@lixpi/constants'
import type { ProviderState } from '../graph/state.ts'
import { getSystemPrompt, formatUserMessageWithHack } from '../prompts/load-prompts.ts'
import {
    convertAttachmentsForProvider,
    resolveImageUrls,
} from '../utils/attachments.ts'
import {
    applyImagePromptLimitToSystemPrompt,
    buildImagePromptRewriteInstruction,
    extractToolCall,
    extractReferenceImages,
    getToolForProvider,
} from '../tools/image-generation.ts'
import {
    extractVideoToolCall,
    getVideoToolForProvider,
} from '../tools/video-generation.ts'
import { detectCapabilities } from '../extraction/capabilities.ts'

export class AnthropicProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'
    private readonly client: Anthropic

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required')
        this.client = new Anthropic({ apiKey })
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const update: Partial<ProviderState> = {}

        const messages = state.messages
        const modelVersion = state.modelVersion
        const workspaceId = state.workspaceId
        const aiChatThreadId = state.aiChatThreadId
        const hasImageModel = !!state.imageModelVersion
        const hasVideoModel = !!state.videoModelVersion
        const maxTokens = state.maxCompletionSize ?? 4096

        // Convert messages to Anthropic format (resolve nats-obj://, then convert content blocks).
        const formatted: Array<{ role: string; content: any }> = []
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]!
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            content = convertAttachmentsForProvider(content, 'ANTHROPIC')
            // Apply Anthropic-specific code-block hack to last user string message.
            if (i === messages.length - 1 && msg.role === 'user' && typeof content === 'string') {
                content = formatUserMessageWithHack(content, 'Anthropic')
            }
            formatted.push({ role: msg.role, content })
        }

        const tools: Array<Record<string, any>> = []
        if (hasImageModel) {
            tools.push(getToolForProvider('Anthropic', state.imageModelMetaInfo, state.imageProviderName))
        }
        if (hasVideoModel) {
            tools.push(getVideoToolForProvider('Anthropic'))
        }

        let systemPrompt = getSystemPrompt(hasImageModel, hasVideoModel)
        if (hasImageModel) {
            const adjusted = applyImagePromptLimitToSystemPrompt(
                systemPrompt,
                state.imageModelMetaInfo,
                state.imageProviderName,
            )
            if (adjusted) systemPrompt = adjusted
        }

        try {
            this.publisher.start()

            const streamArgs: Record<string, any> = {
                model: modelVersion,
                messages: formatted,
                max_tokens: maxTokens,
                system: systemPrompt,
            }
            if (tools.length > 0) streamArgs.tools = tools

            const stream = this.client.messages.stream(streamArgs as any, {
                signal: this.signal,
            })

            for await (const event of stream) {
                if (this.shouldStop) {
                    info('Stream stopped by user request')
                    break
                }
                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                    const text = (event.delta as any).text ?? ''
                    if (text) this.publisher.chunk(text)
                }
            }

            const finalMessage = await stream.finalMessage()

            if (hasImageModel || hasVideoModel) {
                const videoCall = hasVideoModel ? extractVideoToolCall('Anthropic', finalMessage) : undefined
                const imageCall = hasImageModel && !videoCall ? extractToolCall('Anthropic', finalMessage) : undefined
                if (videoCall) {
                    update.generatedVideoPrompt = videoCall.prompt
                    info(`[Anthropic:${this.instanceKey}] generate_video tool call ${JSON.stringify({
                        chatModel: modelVersion,
                        targetVideoProvider: state.videoProviderName,
                        targetVideoModel: state.videoModelVersion,
                        promptLen: videoCall.prompt.length,
                    }, null, 0)}`)
                } else if (imageCall) {
                    const refs = extractReferenceImages(messages)
                    update.generatedImagePrompt = imageCall.prompt
                    update.referenceImages = refs
                    info(`[Anthropic:${this.instanceKey}] generate_image tool call ${JSON.stringify({
                        chatModel: modelVersion,
                        targetImageProvider: state.imageProviderName,
                        targetImageModel: state.imageModelVersion,
                        promptLen: imageCall.prompt.length,
                        referenceImagesExtracted: refs.length,
                    }, null, 0)}`)
                } else if (hasImageModel && hasVideoModel) {
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_image or generate_video (model=${modelVersion})`)
                } else if (hasImageModel) {
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_image (model=${modelVersion}); image gen will not run`)
                } else {
                    warn(`[Anthropic:${this.instanceKey}] did not emit generate_video (model=${modelVersion}); video gen will not run`)
                }
            }

            if (finalMessage.usage) {
                const u = finalMessage.usage
                update.usage = {
                    promptTokens: u.input_tokens ?? 0,
                    promptAudioTokens: 0,
                    promptCachedTokens: 0,
                    completionTokens: u.output_tokens ?? 0,
                    completionAudioTokens: 0,
                    completionReasoningTokens: 0,
                    totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
                }
                update.aiVendorRequestId = finalMessage.id
            }

            this.publisher.end()
        } catch (e: any) {
            err(`Anthropic streaming failed: ${e?.message ?? e}`)
            update.error = e?.message ?? String(e)
        }

        return update
    }

    protected override async rewriteImagePromptToFitLimit(
        state: ProviderState,
        prompt: string,
        maxChars: number,
    ): Promise<string | undefined> {
        const request: Record<string, any> = {
            model: state.modelVersion,
            messages: [{ role: 'user', content: `Original image prompt:\n${prompt}` }],
            max_tokens: Math.max(256, Math.ceil((maxChars + 3) / 4) + 128),
            system: buildImagePromptRewriteInstruction(maxChars),
        }
        if (detectCapabilities('Anthropic', state.modelVersion).supportsTemperature) {
            request.temperature = 0.2
        }

        const response = await this.client.messages.create(request as any)

        const texts: string[] = []
        for (const block of response.content ?? []) {
            if ((block as any).type !== 'text') continue
            const text = (block as any).text
            if (typeof text === 'string' && text.trim()) texts.push(text.trim())
        }
        const out = texts.join('\n').trim()
        return out || undefined
    }
}
