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
//     internally — no streamable thinking deltas. They also don't take temperature.
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
    // o-series reasoning models reject `temperature`.
    supportsTemperature: boolean
    // True for chat-completion / responses-API models that accept a `system`
    // role or top-level instruction.
    supportsSystemPrompt: boolean
    // OpenAI GPT-5 family and o-series reasoning models reject the legacy
    // `max_tokens` param on chat/completions and require `max_completion_tokens`.
    // Only consumed on the OpenAI chat/completions path; false elsewhere.
    usesMaxCompletionTokens: boolean
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

// OpenAI reasoning model families (no temperature, internal reasoning).
const OPENAI_REASONING = [
    /^o[134]\b/i,
    /^o4-mini\b/i,
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

    if (provider === 'Anthropic') {
        const supportsTemperature = !matchAny(mv, ANTHROPIC_NO_TEMPERATURE)
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, usesMaxCompletionTokens: false }
        }
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_OR_MANUAL)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, usesMaxCompletionTokens: false }
        }
        if (matchAny(mv, ANTHROPIC_MANUAL_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'manual', requiresAutoToolChoiceWithThinking: true, supportsTemperature, supportsSystemPrompt: true, usesMaxCompletionTokens: false }
        }
        return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature, supportsSystemPrompt: true, usesMaxCompletionTokens: false }
    }

    if (provider === 'OpenAI') {
        const isGpt5OrOSeries = matchAny(mv, OPENAI_GPT5_OR_OSERIES)
        // o-series reasoning models and the GPT-5 family only accept the default temperature.
        const isReasoning = matchAny(mv, OPENAI_REASONING)
        return {
            provider, modelVersion: mv,
            thinkingMode: 'none',
            requiresAutoToolChoiceWithThinking: false,
            supportsTemperature: !isReasoning && !isGpt5OrOSeries,
            supportsSystemPrompt: true,
            usesMaxCompletionTokens: isGpt5OrOSeries,
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
            usesMaxCompletionTokens: false,
        }
    }

    return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature: true, supportsSystemPrompt: true, usesMaxCompletionTokens: false }
}
