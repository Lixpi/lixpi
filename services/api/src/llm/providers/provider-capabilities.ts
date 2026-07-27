'use strict'

import type { ProviderName } from '@lixpi/constants'

// Capability detection for VLM calls. Each provider/model has its own quirks:
//
// **Anthropic**:
//   - Opus 4.7: only `thinking: {type: "adaptive"}`; manual `enabled` returns 400.
//   - Opus 4.6, Sonnet 4.6: adaptive preferred; manual deprecated but works.
//   - Older Claude 4 (sonnet-4-5, opus-4-5, sonnet-3-7…): manual thinking only.
//   - With ANY thinking enabled, `tool_choice` MUST be 'auto' or 'none'. Forced
//     tool_choice ('any' or 'tool') returns "Thinking may not be enabled when
//     tool_choice forces tool use" 400 errors.
//   - Streaming events: `text_delta`, `thinking_delta`, `signature_delta`.
//
// **OpenAI**:
//   - Structured outputs (response_format json_schema + strict, or function tool
//     with strict): gpt-4o-2024-08-06 and later.
//   - o-series reasoning models (o1, o3, o4-mini, etc.) handle reasoning
//     internally — no streamable thinking deltas.
//   - GPT-5-family and o-series models reject `temperature`.
//   - Forced tool_choice works with reasoning models (no thinking-vs-tool conflict).
//
// **Google**:
//   - Structured output (responseSchema): Gemini 2.0+, 2.5 series, 3.x series.
//   - Thinking: 2.5 series uses `thinkingConfig.thinkingBudget`; 3.x uses
//     `thinkingConfig.thinkingLevel`. Both also support `includeThoughts`.
//   - Streaming + responseSchema yields incremental partial-JSON text deltas.
//   - Thought summaries arrive with a `thought: true` flag on parts.

export type ThinkingMode = 'none' | 'manual' | 'adaptive'

export type ModelCapabilities = {
    provider: ProviderName
    modelVersion: string
    // What kind of streamable thinking the model supports.
    thinkingMode: ThinkingMode
    // Anthropic forbids forced tool_choice ('any' | 'tool') with thinking on.
    // OpenAI and Google do not have this restriction.
    requiresAutoToolChoiceWithThinking: boolean
    // Some OpenAI/Anthropic models reject `temperature`.
    supportsTemperature: boolean
    // True for chat-completion / responses-API models that accept a `system`
    // role or top-level instruction.
    supportsSystemPrompt: boolean
    // Some structured-output APIs require every object in the response schema
    // to be closed with additionalProperties=false. Open schemas need an
    // adapter at the provider boundary, not stage-specific prompt changes.
    requiresClosedJsonSchema: boolean
    supportedInputKinds: ReadonlySet<'image' | 'video-frame' | 'audio' | 'document-text'>
}

const TEXT_AND_IMAGE_INPUTS = new Set(['image', 'video-frame', 'document-text'] as const)
const TEXT_IMAGE_AUDIO_INPUTS = new Set(['image', 'video-frame', 'audio', 'document-text'] as const)
const TEXT_INPUTS = new Set(['document-text'] as const)

const modelInputKinds = (provider: ProviderName, modelVersion: string): ModelCapabilities['supportedInputKinds'] => {
    if (provider === 'Google' && /^gemini-(?:2|3)[.-]/i.test(modelVersion)) return TEXT_IMAGE_AUDIO_INPUTS
    if (provider === 'OpenAI' && /(?:audio|realtime)/i.test(modelVersion)) return TEXT_IMAGE_AUDIO_INPUTS
    if (provider === 'OpenAI' || provider === 'Anthropic') return TEXT_AND_IMAGE_INPUTS
    return TEXT_INPUTS
}

const matchAny = (modelVersion: string, patterns: RegExp[]): boolean =>
    patterns.some((p) => p.test(modelVersion))

// Anthropic model families.
const ANTHROPIC_ADAPTIVE_ONLY = [
    /^claude-opus-4-7\b/i,
    /^claude-mythos/i,
]
const ANTHROPIC_NO_TEMPERATURE = [
    /^claude-opus-4-7\b/i,
]
const ANTHROPIC_ADAPTIVE_OR_MANUAL = [
    /^claude-opus-4-6\b/i,
    /^claude-sonnet-4-6\b/i,
]
const ANTHROPIC_MANUAL_ONLY = [
    /^claude-(opus|sonnet)-4-[0-5]\b/i,
    /^claude-3-7-sonnet/i,
]

// OpenAI model families that reject temperature.
const OPENAI_NO_TEMPERATURE = [
    /^o[134]\b/i,
    /^o4-mini\b/i,
    /^gpt-5(?:\b|[-.])/i,
    /^gpt-5-?(o[134]|reasoning)/i,
]

// The modern OpenAI family — the whole GPT-5 lineup and all o-series. These
// models have two chat/completions quirks vs GPT-4.x: they reject the legacy
// `max_tokens` (require `max_completion_tokens`), and they reject a custom
// `temperature` (only the default value 1 is allowed).
const OPENAI_GPT5_OR_OSERIES = [
    /^gpt-5/i,
    /^o[0-9]/i,
]

// Google thinking-capable families.
const GOOGLE_THINKING = [
    /^gemini-3\./i,
    /^gemini-2\.5/i,
]

export const detectCapabilities = (provider: ProviderName, modelVersion: string): ModelCapabilities => {
    const mv = modelVersion ?? ''
    const supportedInputKinds = modelInputKinds(provider, mv)

    if (provider === 'Anthropic') {
        const supportsTemperature = !matchAny(mv, ANTHROPIC_NO_TEMPERATURE)
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, requiresClosedJsonSchema: false, supportedInputKinds }
        }
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_OR_MANUAL)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, requiresClosedJsonSchema: false, supportedInputKinds }
        }
        if (matchAny(mv, ANTHROPIC_MANUAL_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'manual', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, requiresClosedJsonSchema: false, supportedInputKinds }
        }
        return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature, supportsSystemPrompt: true, requiresClosedJsonSchema: false, supportedInputKinds }
    }

    if (provider === 'OpenAI') {
        const supportsTemperature = !matchAny(mv, OPENAI_NO_TEMPERATURE)
        return {
            provider, modelVersion: mv,
            thinkingMode: 'none',
            requiresAutoToolChoiceWithThinking: false,
            supportsTemperature,
            supportsSystemPrompt: true,
            requiresClosedJsonSchema: true,
            supportedInputKinds,
        }
    }

    if (provider === 'Google') {
        const supportsThinking = matchAny(mv, GOOGLE_THINKING)
        return {
            provider, modelVersion: mv,
            thinkingMode: supportsThinking ? 'manual' : 'none',
            requiresAutoToolChoiceWithThinking: false,
            supportsTemperature: true,
            supportsSystemPrompt: true,
            requiresClosedJsonSchema: false,
            supportedInputKinds,
        }
    }

    return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature: true, supportsSystemPrompt: true, requiresClosedJsonSchema: false, supportedInputKinds }
}

export function assertProviderMessageInputKinds(
    provider: ProviderName,
    modelVersion: string,
    messages: Array<{ content?: unknown }>,
): void {
    const supported = detectCapabilities(provider, modelVersion).supportedInputKinds
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue
        for (const block of message.content) {
            if (!block || typeof block !== 'object' || Array.isArray(block)) continue
            const type = (block as Record<string, unknown>).type
            const inputKind = type === 'input_audio' ? 'audio' : type === 'input_image' ? 'image' : undefined
            if (inputKind && !supported.has(inputKind)) {
                throw new Error(`MODEL_INPUT_KIND_UNSUPPORTED:${provider}:${modelVersion}:${inputKind}`)
            }
        }
    }
}
