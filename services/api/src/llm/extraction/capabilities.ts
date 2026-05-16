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
}

const matchAny = (modelVersion: string, patterns: RegExp[]): boolean =>
    patterns.some((p) => p.test(modelVersion))

// Anthropic model families.
const ANTHROPIC_ADAPTIVE_ONLY = [
    /^claude-opus-4-7\b/i,
    /^claude-mythos/i,
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

// Google thinking-capable families.
const GOOGLE_THINKING = [
    /^gemini-3\./i,
    /^gemini-2\.5/i,
]

export const detectCapabilities = (provider: ProviderName, modelVersion: string): ModelCapabilities => {
    const mv = modelVersion ?? ''

    if (provider === 'Anthropic') {
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature: true, supportsSystemPrompt: true }
        }
        if (matchAny(mv, ANTHROPIC_ADAPTIVE_OR_MANUAL)) {
            return { provider, modelVersion: mv, thinkingMode: 'adaptive', requiresAutoToolChoiceWithThinking: true, supportsTemperature: true, supportsSystemPrompt: true }
        }
        if (matchAny(mv, ANTHROPIC_MANUAL_ONLY)) {
            return { provider, modelVersion: mv, thinkingMode: 'manual', requiresAutoToolChoiceWithThinking: true, supportsTemperature: true, supportsSystemPrompt: true }
        }
        return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature: true, supportsSystemPrompt: true }
    }

    if (provider === 'OpenAI') {
        const isReasoning = matchAny(mv, OPENAI_REASONING)
        return {
            provider, modelVersion: mv,
            thinkingMode: 'none',
            requiresAutoToolChoiceWithThinking: false,
            supportsTemperature: !isReasoning,
            supportsSystemPrompt: true,
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
        }
    }

    return { provider, modelVersion: mv, thinkingMode: 'none', requiresAutoToolChoiceWithThinking: false, supportsTemperature: true, supportsSystemPrompt: true }
}
