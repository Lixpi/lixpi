'use strict'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const read = (name: string): string =>
    readFileSync(resolve(here, name), 'utf-8')

export const SYSTEM_PROMPT = read('./system.txt')
export const IMAGE_GENERATION_INSTRUCTIONS = read('./image_generation_instructions.txt')
export const ANTHROPIC_CODE_BLOCK_HACK = read('./anthropic_code_block_hack.txt')

// The v0 FEATURE_EXTRACTION_INSTRUCTIONS was a monolithic chat-LLM system prompt
// biased toward watercolor / paper-tooth / dry-brush terminology — it caused the
// "digital cat labeled as watercolor" failure. Extraction now lives in its own
// dedicated 6-stage pipeline under services/api/src/llm/extraction/ with focused
// per-stage prompts. Nothing in the chat graph needs an extraction system prompt.

export const getSystemPrompt = (includeImageGeneration: boolean = false): string => {
    if (includeImageGeneration) return `${SYSTEM_PROMPT}\n\n${IMAGE_GENERATION_INSTRUCTIONS}`
    return SYSTEM_PROMPT
}

// Anthropic-specific: coerces triple-backtick code fences instead of XML-tagged code blocks
export const formatUserMessageWithHack = (content: string, provider: string): string => {
    if (provider !== 'Anthropic') return content
    return `${content}${ANTHROPIC_CODE_BLOCK_HACK}`
}
