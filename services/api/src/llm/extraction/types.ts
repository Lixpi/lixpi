'use strict'

import type {
    AxisExtraction,
    Feature,
    FeatureDraft,
    FeatureSampleRef,
    ProviderName,
    SceneAssessment,
    StageTraceEvent,
} from '@lixpi/constants'

import type { AiModelMetaInfo, ChatMessage, ProviderState } from '../graph/state.ts'
import type { StoreWorkspaceImageFn } from '../graph/image-publisher.ts'

export type ReferenceImage = {
    imageRef: string
    url: string
    width?: number
    height?: number
}

export type ExtractionInput = {
    extractionRunId: string
    workspaceId: string
    userId: string
    organizationId?: string
    intent?: string
    messages: ChatMessage[]
    analysisProvider: ProviderName
    analysisModel: AiModelMetaInfo
    imageProvider?: ProviderName
    imageModel?: AiModelMetaInfo
}

export type ExtractionState = {
    input: ExtractionInput
    references: ReferenceImage[]
    sceneAssessment?: SceneAssessment
    axisExtractions: Record<string, AxisExtraction>
    failedAxes: Array<{ axis: string; error: string }>
    sourceCrops: FeatureSampleRef[]
    samples: FeatureSampleRef[]
    draft?: FeatureDraft
    featureId?: string
    feature?: Feature
    error?: string
}

export type StageLogger = {
    extractionRunId: string
    emit: (event: StageTraceEvent) => void
    // Forward a token chunk to the live stream subject. Visible to the
    // extraction-tab UI as streaming reasoning text. Use only from sequential
    // stages (router, synthesis); parallel stages would interleave.
    chunk: (text: string) => void
    span: <T>(stage: string, modelName: string | undefined, body: () => Promise<T>, opts?: {
        inputSummary?: string
        outputSummarizer?: (result: T) => string | undefined
        promptPreview?: string
    }) => Promise<T>
}

export type ExtractionDeps = {
    runImageRouter: (state: ProviderState) => Promise<Partial<ProviderState>>
    storeWorkspaceImage: StoreWorkspaceImageFn
}

export type FeatureExtractor = {
    readonly axis: string
    readonly displayName: string
    readonly description: string
    readonly minDominance: number
    applicableTo: (scene: SceneAssessment, intent?: string) => boolean
    extract: (args: {
        scene: SceneAssessment
        state: ExtractionState
        logger: StageLogger
        deps: ExtractionDeps
    }) => Promise<AxisExtraction>
}
