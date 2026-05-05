'use strict'

import * as process from 'process'

import { GoogleGenAI } from '@google/genai'
import { info, warn, err } from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '../config.ts'
import type { ProviderState, ChatMessage } from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import {
    convertAttachmentsForProvider,
    resolveImageUrls,
} from '../utils/attachments.ts'
import {
    TOOL_NAME,
    applyImagePromptLimitToSystemPrompt,
    buildImagePromptRewriteInstruction,
    extractReferenceImages,
    getToolForProvider,
} from '../tools/image-generation.ts'

export class GoogleProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Google'
    private readonly client: GoogleGenAI

    constructor(instanceKey: string, deps: BaseProviderDeps) {
        super(instanceKey, deps)
        const apiKey = process.env.GOOGLE_API_KEY
        if (!apiKey) throw new Error('GOOGLE_API_KEY environment variable is required')
        this.client = new GoogleGenAI({ apiKey })
    }

    protected override async streamImpl(state: ProviderState): Promise<Partial<ProviderState>> {
        const messages = state.messages
        const modelVersion = state.modelVersion
        const maxTokens = state.maxCompletionSize
        const temperature = state.temperature ?? 0.7
        const supportsSystemPrompt = state.aiModelMetaInfo?.supportsSystemPrompt ?? true
        const enableImageGeneration = state.enableImageGeneration ?? false
        const imageSize = state.imageSize ?? 'auto'

        const modalities = (state.aiModelMetaInfo as any)?.modalities ?? []
        const modelSupportsImageOutput = Array.isArray(modalities) && modalities.some((m: any) =>
            (typeof m === 'object' ? m?.modality : m) === 'image',
        )
        const effectiveImageGen = modelSupportsImageOutput && enableImageGeneration

        const hasImageModel = !!state.imageModelVersion
        const injectTool = hasImageModel && !enableImageGeneration

        // Resolve message content (so reference-image extraction sees data URLs)
        // and convert each message to a Google `Content` object.
        const resolvedMessages: ChatMessage[] = []
        const contents: Array<Record<string, any>> = []
        for (const msg of messages) {
            let content: any = msg.content ?? ''
            content = await resolveImageUrls(content, this.nats)
            resolvedMessages.push({ role: msg.role, content })

            content = convertAttachmentsForProvider(content, 'GOOGLE')
            const role = msg.role === 'assistant' ? 'model' : msg.role
            contents.push({ role, parts: this.buildParts(content) })
        }

        const config: Record<string, any> = { temperature }
        if (maxTokens) config.maxOutputTokens = maxTokens

        if (effectiveImageGen) {
            config.responseModalities = ['TEXT', 'IMAGE']
            if (imageSize && imageSize !== 'auto') {
                config.imageConfig = { aspectRatio: imageSize }
            }
        }

        if (injectTool) {
            const toolDef = getToolForProvider('Google', state.imageModelMetaInfo, state.imageProviderName)
            config.tools = [{
                functionDeclarations: [{
                    name: TOOL_NAME,
                    description: toolDef.description,
                    parameters: toolDef.parameters,
                }],
            }]
        }

        let systemInstruction: string | undefined
        if (supportsSystemPrompt) {
            systemInstruction = getSystemPrompt(injectTool)
            if (injectTool && systemInstruction) {
                systemInstruction = applyImagePromptLimitToSystemPrompt(
                    systemInstruction,
                    state.imageModelMetaInfo,
                    state.imageProviderName,
                ) ?? systemInstruction
            }
        }
        if (systemInstruction) config.systemInstruction = systemInstruction

        if (effectiveImageGen && !modelVersion.startsWith('gemini-2.5')) {
            config.thinkingConfig = { includeThoughts: true }
        }

        const update: Partial<ProviderState> = {}

        try {
            if (!effectiveImageGen) this.publisher.start()

            let usageMetadata: any = null

            if (effectiveImageGen) {
                // Native image-generation path (called via ImageRouter).
                await this.imagePub.partial('', 0)
                const response = await this.client.models.generateContent({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                usageMetadata = response.usageMetadata

                // Collect image parts in order. Gemini 3 image models may emit
                // images marked thought=true; treat all parts equally and use
                // the LAST image part as the final.
                const imageParts: string[] = []
                const textChunks: string[] = []

                for (const candidate of response.candidates ?? []) {
                    if (!candidate.content?.parts) continue
                    for (const part of candidate.content.parts) {
                        if (this.shouldStop) break
                        const inline = (part as any).inlineData ?? (part as any).inline_data
                        const text = (part as any).text
                        if (inline?.data) {
                            imageParts.push(inline.data)  // already base64 in JS SDK
                        } else if (text) {
                            textChunks.push(text)
                        }
                    }
                }

                if (textChunks.length > 0) {
                    this.publisher.chunk(textChunks.join(''))
                }

                if (imageParts.length === 0) {
                    const errMsg = `Google image model ${modelVersion} returned no inline image data.`
                    err(`[Google:${this.instanceKey}] ${errMsg}`)
                    update.error = errMsg
                    await this.imagePub.complete({
                        imageBase64: '',
                        responseId: '',
                        revisedPrompt: '',
                        imageModelId: modelVersion,
                    })
                } else {
                    for (let i = 0; i < imageParts.length - 1; i++) {
                        await this.imagePub.partial(imageParts[i]!, i + 1)
                    }
                    const final = imageParts[imageParts.length - 1]!
                    await this.imagePub.complete({
                        imageBase64: final,
                        responseId: '',
                        revisedPrompt: '',
                        imageModelId: modelVersion,
                    })
                }
            } else if (injectTool) {
                const stream = await this.client.models.generateContentStream({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                let detected: string | undefined
                for await (const chunk of stream) {
                    if (this.shouldStop) break
                    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
                    for (const candidate of chunk.candidates ?? []) {
                        if (!candidate.content?.parts) continue
                        for (const part of candidate.content.parts) {
                            const fnCall = (part as any).functionCall ?? (part as any).function_call
                            if (fnCall && fnCall.name === TOOL_NAME) {
                                const args = fnCall.args ?? {}
                                detected = args.prompt ?? ''
                            } else if ((part as any).text) {
                                this.publisher.chunk((part as any).text)
                            }
                        }
                    }
                }
                if (detected) {
                    update.generatedImagePrompt = detected
                    update.referenceImages = extractReferenceImages(resolvedMessages)
                    info(
                        `[Google:${this.instanceKey}] Tool call detected: generate_image ` +
                        `promptLen=${detected.length}`,
                    )
                } else {
                    warn(`Google did not emit generate_image tool call for ${this.instanceKey}`)
                }
            } else {
                // Pure text streaming
                const stream = await this.client.models.generateContentStream({
                    model: modelVersion,
                    contents: contents as any,
                    config: config as any,
                })
                for await (const chunk of stream) {
                    if (this.shouldStop) break
                    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata
                    for (const candidate of chunk.candidates ?? []) {
                        if (!candidate.content?.parts) continue
                        for (const part of candidate.content.parts) {
                            if ((part as any).text) {
                                this.publisher.chunk((part as any).text)
                            }
                        }
                    }
                }
            }

            if (usageMetadata) {
                const promptTokens = usageMetadata.promptTokenCount ?? 0
                const completionTokens = usageMetadata.candidatesTokenCount ?? 0
                update.usage = {
                    promptTokens,
                    promptAudioTokens: 0,
                    promptCachedTokens: usageMetadata.cachedContentTokenCount ?? 0,
                    completionTokens,
                    completionAudioTokens: 0,
                    completionReasoningTokens: usageMetadata.thoughtsTokenCount ?? 0,
                    totalTokens: usageMetadata.totalTokenCount ?? (promptTokens + completionTokens),
                }
                update.aiVendorRequestId = `google-${state.workspaceId}-${state.aiChatThreadId}`
            }

            if (effectiveImageGen) {
                update.imageUsage = {
                    generatedCount: 1,
                    size: imageSize,
                    quality: 'high',
                }
            }

            if (!effectiveImageGen) this.publisher.end()
        } catch (e: any) {
            err(`Google streaming failed: ${e?.message ?? e}`)
            update.error = e?.message ?? String(e)
        }

        return update
    }

    private buildParts(content: any): Array<Record<string, any>> {
        if (typeof content === 'string') return [{ text: content }]
        if (!Array.isArray(content)) return [{ text: String(content) }]
        const parts: Array<Record<string, any>> = []
        for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            if ('text' in block) {
                parts.push({ text: block.text })
            } else if ('inline_data' in block) {
                const inline = block.inline_data
                parts.push({ inlineData: { data: inline.data, mimeType: inline.mime_type } })
            }
        }
        return parts.length > 0 ? parts : [{ text: '' }]
    }

    protected override async rewriteImagePromptToFitLimit(
        state: ProviderState,
        prompt: string,
        maxChars: number,
    ): Promise<string | undefined> {
        const response = await this.client.models.generateContent({
            model: state.modelVersion,
            contents: [{ role: 'user', parts: [{ text: `Original image prompt:\n${prompt}` }] }] as any,
            config: {
                temperature: 0.2,
                maxOutputTokens: Math.max(256, Math.ceil((maxChars + 3) / 4) + 128),
                systemInstruction: buildImagePromptRewriteInstruction(maxChars),
            } as any,
        })

        const direct = (response as any).text
        if (typeof direct === 'string' && direct.trim()) return direct.trim()

        const parts: string[] = []
        for (const candidate of response.candidates ?? []) {
            if (!candidate.content?.parts) continue
            for (const part of candidate.content.parts) {
                if ((part as any).text) parts.push(((part as any).text as string).trim())
            }
        }
        const out = parts.filter(Boolean).join('\n').trim()
        return out || undefined
    }
}
