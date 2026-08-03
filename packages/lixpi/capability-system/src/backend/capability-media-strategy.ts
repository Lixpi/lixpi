'use strict'

import type {
    CapabilityJsonValue,
    AiModelInferenceCapabilities,
    ImageReferenceCapabilities,
    MediaGenerationRunMeta,
    ProviderName,
} from '@lixpi/constants'

import type { CapabilityMediaExecutionPlan } from '../shared/capability-media-execution-plan.ts'

export type CapabilityMediaStrategyOptions = {
    signal?: AbortSignal
    captureOnly?: boolean
}

export type CapabilityMediaModelMeta = {
    provider: string
    model: string
    modelVersion: string
    maxCompletionSize?: number
    imageReferenceCapabilities?: ImageReferenceCapabilities
    imageSizeMode?: string
    imageSizes?: Array<{ value?: string }>
    [key: string]: unknown
}

export type CapabilityMediaExecutionContext = {
    organizationId: string
    userId: string
    workspaceId: string
    conversationAssetId: string
    generationRequestId: string
    mediaRunId: string
    reasoningModel: {
        provider: ProviderName
        modelVersion: string
        maxCompletionSize?: number
        inferenceCapabilities: AiModelInferenceCapabilities
    }
    imageModel: {
        provider: ProviderName
        modelVersion: string
        meta: CapabilityMediaModelMeta
        requestedSize?: string
    }
    eventMeta: Record<string, unknown>
    generationRun?: MediaGenerationRunMeta
    workflowId?: string
    metricsOperationId?: string
    metricsAdmissionApproved?: boolean
}

export type CapabilityMediaExecutionResult = {
    generatedImages?: string[]
    imageUsage?: {
        generatedCount: number
        size: string
        quality: string
    }
    capabilityMediaTrace?: CapabilityJsonValue
    error?: string
    errorCode?: string
    errorType?: string
}

export type CapabilityMediaStrategy = {
    readonly kind: string
    execute: (
        context: CapabilityMediaExecutionContext,
        plan: CapabilityMediaExecutionPlan,
        options: CapabilityMediaStrategyOptions,
    ) => Promise<CapabilityMediaExecutionResult>
}
