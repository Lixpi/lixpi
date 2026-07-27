'use strict'

import { CapabilityError } from '@lixpi/capability-system/backend'

import type { ProviderState } from '../graph/state.ts'

export type ProviderInputBudgetAssessment = {
    inputTokens: number
    mediaTokens: number
    reservedCompletionTokens: number
    contextWindow: number
}

export function assessProviderInputBudget({
    state,
    request,
}: {
    state: ProviderState
    request: Readonly<Record<string, unknown>>
}): ProviderInputBudgetAssessment | undefined {
    const contextWindow = state.aiModelMetaInfo?.contextWindow
    if (contextWindow === undefined) return undefined
    const reservedCompletionTokens = state.maxCompletionSize
        ?? state.aiModelMetaInfo?.maxCompletionSize
    if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0
        || !Number.isSafeInteger(reservedCompletionTokens) || reservedCompletionTokens < 0) {
        throw contextError(state, 0, reservedCompletionTokens ?? 0, contextWindow)
    }

    let mediaTokens = 0
    const serialized = JSON.stringify(request, (_key, value: unknown) => {
        if (typeof value === 'string' && value.startsWith('data:')) {
            const assessment = assessDataUrl(value)
            if (!assessment) return value
            mediaTokens += assessment.tokens
            return `<${assessment.mimeType} input:${assessment.byteLength} bytes>`
        }
        if (value instanceof Uint8Array) {
            mediaTokens += Math.ceil(value.byteLength / 24)
            return `<binary input:${value.byteLength} bytes>`
        }
        const record = asRecord(value)
        const mediaType = typeof record?.mimeType === 'string'
            ? record.mimeType
            : typeof record?.media_type === 'string'
                ? record.media_type
                : undefined
        if (mediaType && typeof record?.data === 'string' && isBase64(record.data)) {
            const byteLength = base64ByteLength(record.data)
            mediaTokens += mediaType.startsWith('audio/')
                ? Math.ceil(byteLength / 24)
                : 1_600
            return { ...record, data: `<${mediaType} input:${byteLength} bytes>` }
        }
        return value
    })
    const textTokens = Math.ceil(serialized.length / 3)
    const inputTokens = textTokens + mediaTokens
    if (inputTokens + reservedCompletionTokens > contextWindow) {
        throw contextError(state, inputTokens, reservedCompletionTokens, contextWindow)
    }
    return { inputTokens, mediaTokens, reservedCompletionTokens, contextWindow }
}

function assessDataUrl(value: string): {
    mimeType: string
    byteLength: number
    tokens: number
} | undefined {
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/su.exec(value)
    if (!match) return undefined
    const mimeType = match[1]!
    const byteLength = base64ByteLength(match[2]!)
    return {
        mimeType,
        byteLength,
        tokens: mimeType.startsWith('audio/') ? Math.ceil(byteLength / 24) : 1_600,
    }
}

function contextError(
    state: ProviderState,
    inputTokens: number,
    reservedCompletionTokens: number,
    contextWindow: number | undefined,
): CapabilityError {
    const modelId = state.aiModelMetaInfo?.model ?? state.modelVersion
    return new CapabilityError(
        'MODEL_INPUT_CONTEXT_EXCEEDED',
        `MODEL_INPUT_CONTEXT_EXCEEDED: ${modelId} cannot fit the complete translated request in its context window`,
        { modelId, inputTokens, reservedCompletionTokens, contextWindow: contextWindow ?? 0 },
    )
}

function base64ByteLength(value: string): number {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor(value.length * 3 / 4) - padding)
}

function isBase64(value: string): boolean {
    return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}
