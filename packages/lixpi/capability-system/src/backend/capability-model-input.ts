import {
    type CapabilityJsonValue,
    type CapabilityReasoningModelVariant,
} from '@lixpi/constants'

export type CapabilityResolvedModelInput =
    | {
        kind: 'image'
        marker: string
        assetId: string
        title: string
        bytes: Uint8Array
        mimeType: string
    }
    | {
        kind: 'video-frame'
        marker: string
        assetId: string
        title: string
        bytes: Uint8Array
        mimeType: string
    }
    | {
        kind: 'audio'
        marker: string
        assetId: string
        title: string
        bytes: Uint8Array
        mimeType: string
    }
    | {
        kind: 'document-text'
        marker: string
        assetId: string
        title: string
        text: string
    }

export type CapabilityStructuredModelResult<T> = {
    parsed: T
    rawText?: string
    usage?: Record<string, CapabilityJsonValue>
}

export type CapabilityStructuredModelPort = {
    assertSupportedInputs: (
        variant: CapabilityReasoningModelVariant,
        inputs: readonly CapabilityResolvedModelInput[],
    ) => void
    assessInputBudget: (request: CapabilityStructuredModelBudgetRequest) => Promise<{
        inputTokens: number
        reservedCompletionTokens: number
        contextWindow: number
    }>
    call: <T>(request: CapabilityStructuredModelCallRequest) => Promise<CapabilityStructuredModelResult<T>>
}

export type CapabilityStructuredModelBudgetRequest = {
    variant: CapabilityReasoningModelVariant
    systemPrompt: string
    userPrompt: string
    inputs: readonly CapabilityResolvedModelInput[]
    schema: Record<string, CapabilityJsonValue>
    maxTokens: number
}

export type CapabilityStructuredModelCallRequest = CapabilityStructuredModelBudgetRequest & {
    abortSignal: AbortSignal
}
