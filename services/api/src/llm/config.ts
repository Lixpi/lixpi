'use strict'

import * as process from 'process'

const env = process.env

export const LLM_TIMEOUT_MS = Number(env.LLM_TIMEOUT_SECONDS ?? 1200) * 1000

export const PROVIDER_NAMES = ['OpenAI', 'Anthropic', 'Google', 'Stability'] as const
export type ProviderName = typeof PROVIDER_NAMES[number]

export const STREAM_STATUS = {
    START_STREAM: 'START_STREAM',
    STREAMING: 'STREAMING',
    END_STREAM: 'END_STREAM',
    ERROR: 'ERROR',
    IMAGE_PARTIAL: 'IMAGE_PARTIAL',
    IMAGE_COMPLETE: 'IMAGE_COMPLETE',
    COLLAPSIBLE_START: 'COLLAPSIBLE_START',
    COLLAPSIBLE_END: 'COLLAPSIBLE_END',
} as const

export type StreamStatus = typeof STREAM_STATUS[keyof typeof STREAM_STATUS]
