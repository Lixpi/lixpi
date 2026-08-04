'use strict'

import type {
    CharacterFidelityAssessmentRequest,
    CharacterFidelityAssessmentResponse,
    CharacterFidelityObjectCoordinate,
    AiModelInferenceCapabilities,
    ProviderName,
} from '@lixpi/constants'

import type { CapabilityMediaExecutionContext } from '../../../../backend/capability-media-strategy.ts'
import type { CharacterSheetRenderPlan } from '../../shared/character-sheet-media-plan.ts'

export type CharacterImageReferenceRole =
    | 'original-source'
    | 'source-reference'
    | 'face-crop'
    | 'body-outfit-crop'
    | 'prop-crop'
    | 'canonical-anchor'
    | 'adjacent-angle'

export type CharacterImageReference = {
    url: string
    role: CharacterImageReferenceRole
    fileName?: string
}

export type CharacterImageGenerationResult = {
    image: string
    providerOperationId?: string
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

export type CharacterImageGenerationPort = {
    generate: (args: {
        context: CapabilityMediaExecutionContext
        plan: CharacterSheetRenderPlan
        operationKey: string
        usageMode: 'character-creator'
        prompt: string
        references: CharacterImageReference[]
        signal?: AbortSignal
    }) => Promise<CharacterImageGenerationResult>
}

export type CharacterReferenceRendition = {
    status?: string
    blobHash?: string
    mimeType?: string
}

export type CharacterReferenceAssetRecord = {
    assetId: string
    organizationId: string
    media?: {
        renditions: {
            canonical?: CharacterReferenceRendition
            original?: CharacterReferenceRendition
        }
    }
}

export type CharacterReferenceAssetPort = {
    getAuthorizedAsset: (args: {
        assetId: string
        organizationId: string
        workspaceId: string
        userId: string
    }) => Promise<CharacterReferenceAssetRecord>
    readBlob: (args: {
        organizationId: string
        blobHash: string
    }) => Promise<Uint8Array>
}

export type CharacterTransientMediaStorePort = {
    putWithCoordinate: (input: {
        mediaKind: 'image'
        slot: string
        bytes: Uint8Array
        mimeType: 'image/png'
        revision: number
    }) => Promise<{
        coordinate: CharacterFidelityObjectCoordinate
    }>
    clear: () => Promise<void>
}

export type CharacterTransientMediaStoreFactory = {
    create: (context: CapabilityMediaExecutionContext) => CharacterTransientMediaStorePort
}

export type CharacterVlmMessage = {
    role: string
    content: string | Array<Record<string, unknown>>
}

export type CharacterVlmJsonSchema = {
    name: string
    description: string
    schema: Record<string, unknown>
    strict?: boolean
}

export type CharacterVlmCallRequest = {
    provider: ProviderName
    modelVersion: string
    inferenceCapabilities: AiModelInferenceCapabilities
    systemPrompt: string
    userMessages: CharacterVlmMessage[]
    schema: CharacterVlmJsonSchema
    temperature?: number
    maxTokens?: number
    maxOutputTokensCeiling?: number
    abortSignal?: AbortSignal
    enableThinking?: boolean
    singleAttempt?: boolean
}

export type CharacterVlmCallResult = {
    parsed: unknown
    rawText: string
    modelName: string
    promptTokens: number
    completionTokens: number
}

export type CharacterStructuredVlmPort = {
    call: (request: CharacterVlmCallRequest) => Promise<CharacterVlmCallResult>
}

export type CharacterFidelityPort = {
    assess: (
        request: CharacterFidelityAssessmentRequest,
        signal?: AbortSignal,
    ) => Promise<CharacterFidelityAssessmentResponse>
}

export type CharacterCreatorRuntimePorts = {
    referenceAssets: CharacterReferenceAssetPort
    transientMedia: CharacterTransientMediaStoreFactory
    imageGeneration: CharacterImageGenerationPort
    structuredVlm: CharacterStructuredVlmPort
    fidelity: CharacterFidelityPort
}
