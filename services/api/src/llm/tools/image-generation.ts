'use strict'

import { warn } from '@lixpi/debug-tools'

import type { AiModelMetaInfo, ChatMessage } from '../graph/state.ts'
import type { ProviderName } from '../config.ts'

export const TOOL_NAME = 'generate_image'

const TOOL_DESCRIPTION =
    'Generate an image based on a text prompt. ' +
    'When the user requests an image, illustration, diagram, logo, or any visual content, ' +
    'call this tool with a detailed, descriptive prompt optimized for image generation. ' +
    'The prompt should be vivid, specific, and describe the desired style, composition, ' +
    'colors, lighting, and mood. Do NOT include any harmful, violent, or explicit content ' +
    'in the prompt. Always craft a safe, moderation-compliant prompt.'

const BASE_PARAMETERS = {
    type: 'object',
    properties: {
        prompt: {
            type: 'string',
            description:
                'A detailed, descriptive prompt for image generation. ' +
                'Be specific about style, composition, colors, lighting, and mood. ' +
                'Must be safe and moderation-compliant.',
        },
    },
    required: ['prompt'],
}

const FALLBACK_MAX_PROMPT_LENGTH: Record<string, number> = {
    Stability: 10000,
}

export const getImagePromptMaxChars = (
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): number | undefined => {
    if (imageModelMetaInfo) {
        const value = imageModelMetaInfo.imagePromptMaxChars
        if (typeof value === 'number' && value > 0) return value
        if (typeof value === 'string' && /^\d+$/.test(value)) {
            const parsed = parseInt(value, 10)
            if (parsed > 0) return parsed
        }
        if (!imageProvider && typeof imageModelMetaInfo.provider === 'string') {
            imageProvider = imageModelMetaInfo.provider
        }
    }
    if (!imageProvider) return undefined
    return FALLBACK_MAX_PROMPT_LENGTH[imageProvider]
}

export const buildImagePromptLimitInstruction = (
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): string | undefined => {
    const maxLen = getImagePromptMaxChars(imageModelMetaInfo, imageProvider)
    if (!maxLen) return undefined
    return (
        `IMPORTANT: The generate_image tool prompt MUST NOT exceed ${maxLen} characters. ` +
        'Stay under the limit during generation. Do not emit an overlong prompt that would need truncation.'
    )
}

export const applyImagePromptLimitToSystemPrompt = (
    systemPrompt: string | undefined,
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): string | undefined => {
    const limit = buildImagePromptLimitInstruction(imageModelMetaInfo, imageProvider)
    if (!limit) return systemPrompt
    return systemPrompt ? `${systemPrompt}\n\n${limit}` : limit
}

export const validateImagePrompt = (
    prompt: string,
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): string | undefined => {
    const maxChars = getImagePromptMaxChars(imageModelMetaInfo, imageProvider)
    if (!maxChars) return undefined
    const len = (prompt || '').length
    if (len <= maxChars) return undefined
    return `Image prompt exceeds the selected image model limit: ${len} characters > ${maxChars} characters.`
}

export const buildImagePromptRewriteInstruction = (maxChars: number): string =>
    'Rewrite the image generation prompt so it stays within the required character limit while preserving the ' +
    'same visual intent, composition, subject details, style, lighting, color, and constraints. ' +
    `Return only the rewritten prompt text. It must be no more than ${maxChars} characters. ` +
    'Do not add commentary, XML tags, markdown, or quotes.'

const buildToolDescription = (
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): string => {
    const maxChars = getImagePromptMaxChars(imageModelMetaInfo, imageProvider)
    if (!maxChars) return TOOL_DESCRIPTION
    return (
        `${TOOL_DESCRIPTION} ` +
        `CRITICAL CONSTRAINT: The prompt MUST NOT exceed ${maxChars} characters. ` +
        'Prioritize the most impactful visual details when approaching the limit.'
    )
}

const buildToolParameters = (
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): Record<string, any> => {
    const maxChars = getImagePromptMaxChars(imageModelMetaInfo, imageProvider)
    if (!maxChars) return BASE_PARAMETERS
    return {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                maxLength: maxChars,
                description:
                    `A detailed, descriptive prompt for image generation (max ${maxChars} characters). ` +
                    'Be specific about style, composition, colors, lighting, and mood. ' +
                    'Must be safe and moderation-compliant.',
            },
        },
        required: ['prompt'],
    }
}

export type ImageToolCall = {
    prompt: string
    toolCallId?: string
}

export const getToolForProvider = (
    provider: ProviderName,
    imageModelMetaInfo?: AiModelMetaInfo,
    imageProvider?: string,
): Record<string, any> => {
    const description = buildToolDescription(imageModelMetaInfo, imageProvider)
    const parameters = buildToolParameters(imageModelMetaInfo, imageProvider)

    if (provider === 'OpenAI') {
        return { type: 'function', name: TOOL_NAME, description, parameters }
    }
    if (provider === 'Anthropic') {
        return { name: TOOL_NAME, description, input_schema: parameters }
    }
    if (provider === 'Google') {
        return { name: TOOL_NAME, description, parameters }
    }
    throw new Error(`Unsupported provider: ${provider}`)
}

// OpenAI Responses API: `response.output[*]` may contain a function_call item.
export const extractToolCallOpenAI = (response: any): ImageToolCall | undefined => {
    if (!response?.output) return undefined
    for (const item of response.output) {
        if (item?.type === 'function_call' && item?.name === TOOL_NAME) {
            try {
                const args = typeof item.arguments === 'string'
                    ? JSON.parse(item.arguments)
                    : item.arguments
                return { prompt: args?.prompt ?? '', toolCallId: item.call_id }
            } catch (e) {
                warn(`Failed to parse OpenAI tool call: ${e}`)
            }
        }
    }
    return undefined
}

// Anthropic Messages API: final_message.content[*] may contain tool_use blocks.
export const extractToolCallAnthropic = (finalMessage: any): ImageToolCall | undefined => {
    if (!finalMessage?.content) return undefined
    for (const block of finalMessage.content) {
        if (block?.type === 'tool_use' && block?.name === TOOL_NAME) {
            const args = block.input ?? {}
            return { prompt: args.prompt ?? '', toolCallId: block.id }
        }
    }
    return undefined
}

// Google Gen AI: response.candidates[*].content.parts[*].functionCall
export const extractToolCallGoogle = (response: any): ImageToolCall | undefined => {
    if (!response?.candidates) return undefined
    for (const candidate of response.candidates) {
        const parts = candidate?.content?.parts
        if (!parts) continue
        for (const part of parts) {
            const fnCall = part.functionCall ?? part.function_call
            if (fnCall && fnCall.name === TOOL_NAME) {
                const args = fnCall.args ? { ...fnCall.args } : {}
                return { prompt: args.prompt ?? '' }
            }
        }
    }
    return undefined
}

export const extractToolCall = (
    provider: ProviderName,
    response: any,
): ImageToolCall | undefined => {
    if (provider === 'OpenAI') return extractToolCallOpenAI(response)
    if (provider === 'Anthropic') return extractToolCallAnthropic(response)
    if (provider === 'Google') return extractToolCallGoogle(response)
    return undefined
}

// Walk conversation history and return any reference images the user attached, in canonical data-URL form.
export const extractReferenceImages = (messages: ChatMessage[]): string[] => {
    const images: string[] = []

    for (const msg of messages) {
        if (msg.role !== 'user') continue
        const content = msg.content
        if (!Array.isArray(content)) continue

        for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            const blockType = (block as any).type ?? ''
            // OpenAI format: input_image with image_url
            if (blockType === 'input_image') {
                const url = (block as any).image_url
                if (typeof url === 'string' && url) images.push(url)
            }
            // Anthropic format: image with source
            else if (blockType === 'image') {
                const source = (block as any).source ?? {}
                if (source.type === 'base64' && source.data) {
                    const mediaType = source.media_type ?? 'image/png'
                    images.push(`data:${mediaType};base64,${source.data}`)
                }
            }
            // Google format: inline_data
            else if (blockType === 'inline_data') {
                const mime = (block as any).mime_type ?? 'image/png'
                const data = (block as any).data
                if (data) images.push(`data:${mime};base64,${data}`)
            }
        }
    }

    return images
}
