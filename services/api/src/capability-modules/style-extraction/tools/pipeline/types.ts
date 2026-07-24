'use strict'

import type {
    ProviderName,
} from '@lixpi/constants'

import type { AiModelMetaInfo, ChatMessage, ProviderState } from '../../../../llm/graph/state.ts'

export type ReferenceImage = {
    imageRef: string
    url: string
    assetId?: string
    width?: number
    height?: number
}

export type StyleSampleKind = 'source-crop' | 'texture-specimen' | 'applied-medium-probe' | 'palette-board'

export type StyleSampleCropRegion = {
    imageRef: string
    x: number
    y: number
    width: number
    height: number
    label: string
    purpose: 'texture-evidence' | 'applied-medium-evidence' | 'subject-detail-evidence' | 'composition-evidence'
}

export type StyleSampleRef = {
    idx: number
    subject: string
    rationale?: string
    aspectRatio?: string
    ext: string
    blobHash: string
    imageUrl?: string
    kind?: StyleSampleKind
    cropRegion?: StyleSampleCropRegion
}

export type SceneSubject = {
    label: string
    bbox: [number, number, number, number]
    salience: number
    description: string
}

export type SceneRegion = {
    label: string
    bbox: [number, number, number, number]
    description: string
}

export type SceneAssessment = {
    references: Array<{
        imageRef: string
        subjects: SceneSubject[]
        regions: SceneRegion[]
    }>
    medium: string
    axisDominance: Record<string, number>
    intentResolution: {
        forcedCategory?: string | null
        forcedAxes?: string[] | null
        proposedCategory: string
    }
    notes: string
}

export type AxisExtraction = {
    axis: string
    dominance: number
    fields: Record<string, any>
    rationale: string
}

export type StyleRecommendedSampleSubject = {
    kind: StyleSampleKind
    prompt: string
    aspectRatio: string
    rationale: string
}

export type StyleDraft = {
    category: string
    name: string
    summary: string
    tags: string[]
    instructions: string
    parameters: Record<string, any>
    recommendedSampleSubjects: StyleRecommendedSampleSubject[]
}

export type StageTraceEvent = {
    styleExtractionRunId: string
    stage: string
    modelName?: string
    promptHash?: string
    promptPreview?: string
    startedAt: number
    finishedAt: number
    durationMs: number
    status: 'running' | 'ok' | 'error' | 'skipped'
    errorMessage?: string
    inputSummary?: string
    outputSummary?: string
    outputBytes?: number
    metricTags?: Record<string, string | number>
}

export type StyleExtractionInput = {
    styleExtractionRunId: string
    workspaceId: string
    userId: string
    organizationId?: string
    intent?: string
    messages: ChatMessage[]
    sourceAssetIds?: string[]
    analysisProvider: ProviderName
    analysisModel: AiModelMetaInfo
    imageProvider?: ProviderName
    imageModel?: AiModelMetaInfo
}

export type StyleExtractionState = {
    input: StyleExtractionInput
    references: ReferenceImage[]
    sceneAssessment?: SceneAssessment
    axisExtractions: Record<string, AxisExtraction>
    failedAxes: Array<{ axis: string; error: string }>
    sourceCrops: StyleSampleRef[]
    samples: StyleSampleRef[]
    draft?: StyleDraft
    capabilityId?: string
    capability?: {
        capabilityId: string
        name: string
        category: string
        summary: string
        tags: string[]
        sampleCount: number
    }
    error?: string
}

export type StageLogger = {
    styleExtractionRunId: string
    emit: (event: StageTraceEvent) => void
    // Forward a token chunk to an optional workflow progress sink. Use only
    // from sequential stages (router, synthesis); parallel stages interleave.
    chunk: (text: string) => void
    span: <T>(stage: string, modelName: string | undefined, body: () => Promise<T>, opts?: {
        inputSummary?: string
        outputSummarizer?: (result: T) => string | undefined
        promptPreview?: string
    }) => Promise<T>
}

export type StyleExtractionDependencies = {
    runImageRouter: (state: ProviderState) => Promise<Partial<ProviderState>>
    getAllowedActions?: () => ReadonlySet<string>
}

export type StyleExtractor = {
    readonly axis: string
    readonly displayName: string
    readonly description: string
    readonly minDominance: number
    applicableTo: (scene: SceneAssessment, intent?: string) => boolean
    extract: (args: {
        scene: SceneAssessment
        state: StyleExtractionState
        logger: StageLogger
        deps: StyleExtractionDependencies
    }) => Promise<AxisExtraction>
}
