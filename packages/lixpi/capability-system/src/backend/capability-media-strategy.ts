import {
    type CapabilityJsonValue,
    type AiModelInferenceCapabilities,
    type ImageReferenceCapabilities,
    type MediaGenerationRunProgress,
    type MediaGenerationRunMeta,
    type ProviderName,
    type SubjectIdentityClassification,
} from '@lixpi/constants'

import {
    type CapabilityMediaExecutionPlan,
} from '../shared/capability-media-execution-plan.ts'

export type CapabilityMediaStrategyOptions = {
    signal?: AbortSignal
    captureOnly?: boolean
    reportProgress?: (progress: MediaGenerationRunProgress) => Promise<void>
    publishImagePartial?: (
        imageBase64: string,
        partialIndex: number,
    ) => Promise<void>
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

export type CapabilityMediaSharedState = {
    authoritativePrompt: string
    editTargetAssetId?: string
    mediaReferenceAliases: ReadonlyArray<{
        assetId: string
        alias: string
    }>
    sourceSubjectIdentityClassifications: readonly SubjectIdentityClassification[]
    capabilityInstructions: readonly string[]
    capabilityReferences: ReadonlyArray<{
        imageUrl: string
        traceUrl?: string
    }>
    capabilityOutputs: ReadonlyArray<{
        capabilityId: string
        runId: string
        output: Readonly<Record<string, CapabilityJsonValue>>
    }>
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
    sharedState: CapabilityMediaSharedState
    eventMeta: Record<string, unknown>
    generationRun?: MediaGenerationRunMeta
    workflowId?: string
    metricsOperationId?: string
    metricsAdmissionApproved?: boolean
}

export type CapabilityMediaExecutionResult = {
    generatedImages?: string[]
    mediaComposition?: {
        kind: string
        capabilityId: string
        sourceAssetIds: string[]
        components: Array<{
            componentId: string
            role: string
            title: string
            imageBase64: string
            mimeType: 'image/png'
        }>
    }
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
