'use strict'

import * as process from 'process'

import Anthropic from '@anthropic-ai/sdk'
import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '../config.ts'
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

        let systemPrompt = getSystemPrompt(hasImageModel)
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

            if (hasImageModel) {
                const toolCall = extractToolCall('Anthropic', finalMessage)
                if (toolCall) {
                    update.generatedImagePrompt = toolCall.prompt
                    update.referenceImages = extractReferenceImages(messages)
                    info(
                        `[Anthropic:${this.instanceKey}] Tool call detected: generate_image ` +
                        `promptLen=${toolCall.prompt.length}`,
                    )
                } else {
                    warn(`Anthropic did not emit generate_image tool call for ${this.instanceKey}`)
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
        const response = await this.client.messages.create({
            model: state.modelVersion,
            messages: [{ role: 'user', content: `Original image prompt:\n${prompt}` }],
            max_tokens: Math.max(256, Math.ceil((maxChars + 3) / 4) + 128),
            temperature: 0.2,
            system: buildImagePromptRewriteInstruction(maxChars),
        })

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
