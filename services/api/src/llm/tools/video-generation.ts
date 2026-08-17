'use strict'

import { warn } from '@lixpi/debug-tools'

import type { ProviderName } from '@lixpi/constants'

// Mirrors tools/image-generation.ts but for the `generate_video` tool. The text
// model emits this tool call when the user asks for a video/animation/clip; the
// LangGraph conditional then routes to the VideoRouter (transient VEO provider).
// VEO prompts have no strict character limit (unlike Stability image prompts),
// so this tool is a fixed definition without the per-model maxChars machinery.

export const VIDEO_TOOL_NAME = 'generate_video'

const TOOL_DESCRIPTION =
    'Generate moving visual media from the user request and authorized references. ' +
    'Call this tool only when the user explicitly requests a video, clip, animation, filming, animating, ' +
    'or continuation of a source video. Action or event verbs that can be depicted in one still image do not ' +
    'establish video intent. Preserve the request scope, ' +
    'temporal intent, and reference roles; do not add unrequested semantic or aesthetic content. ' +
    'The prompt must be safe and moderation-compliant.'

const BASE_PARAMETERS = {
    type: 'object',
    properties: {
        prompt: {
            type: 'string',
            description:
                'The exact moving-media prompt derived from the user request and authorized reference roles. ' +
                'It must preserve requested temporal behavior, avoid invented content, and be moderation-compliant.',
        },
    },
    required: ['prompt'],
}

export type VideoToolCall = {
    prompt: string
    toolCallId?: string
}

export const getVideoToolForProvider = (provider: ProviderName): Record<string, any> => {
    if (provider === 'OpenAI') {
        return { type: 'function', name: VIDEO_TOOL_NAME, description: TOOL_DESCRIPTION, parameters: BASE_PARAMETERS }
    }
    if (provider === 'Anthropic') {
        return { name: VIDEO_TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: BASE_PARAMETERS }
    }
    if (provider === 'Google') {
        return { name: VIDEO_TOOL_NAME, description: TOOL_DESCRIPTION, parameters: BASE_PARAMETERS }
    }
    throw new Error(`Unsupported provider: ${provider}`)
}

// OpenAI Responses API: `response.output[*]` may contain a function_call item.
export const extractVideoToolCallOpenAI = (response: any): VideoToolCall | undefined => {
    if (!response?.output) return undefined
    for (const item of response.output) {
        if (item?.type === 'function_call' && item?.name === VIDEO_TOOL_NAME) {
            try {
                const args = typeof item.arguments === 'string'
                    ? JSON.parse(item.arguments)
                    : item.arguments
                return { prompt: args?.prompt ?? '', toolCallId: item.call_id }
            } catch (e) {
                warn(`Failed to parse OpenAI video tool call: ${e}`)
            }
        }
    }
    return undefined
}

// Anthropic Messages API: final_message.content[*] may contain tool_use blocks.
export const extractVideoToolCallAnthropic = (finalMessage: any): VideoToolCall | undefined => {
    if (!finalMessage?.content) return undefined
    for (const block of finalMessage.content) {
        if (block?.type === 'tool_use' && block?.name === VIDEO_TOOL_NAME) {
            const args = block.input ?? {}
            return { prompt: args.prompt ?? '', toolCallId: block.id }
        }
    }
    return undefined
}

// Google Gen AI: response.candidates[*].content.parts[*].functionCall
export const extractVideoToolCallGoogle = (response: any): VideoToolCall | undefined => {
    if (!response?.candidates) return undefined
    for (const candidate of response.candidates) {
        const parts = candidate?.content?.parts
        if (!parts) continue
        for (const part of parts) {
            const fnCall = part.functionCall ?? part.function_call
            if (fnCall && fnCall.name === VIDEO_TOOL_NAME) {
                const args = fnCall.args ? { ...fnCall.args } : {}
                return { prompt: args.prompt ?? '' }
            }
        }
    }
    return undefined
}

export const extractVideoToolCall = (
    provider: ProviderName,
    response: any,
): VideoToolCall | undefined => {
    if (provider === 'OpenAI') return extractVideoToolCallOpenAI(response)
    if (provider === 'Anthropic') return extractVideoToolCallAnthropic(response)
    if (provider === 'Google') return extractVideoToolCallGoogle(response)
    return undefined
}
