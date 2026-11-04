import {
    type CapabilityJsonValue,
    type AgentOperationState,
} from '@lixpi/constants'

import {
    type MediaPipeline,
    type MediaPipelineIssue,
    type MediaPipelineKind,
    type MediaPipelineNode,
    type MediaPipelinePort,
    type MediaPipelineSource,
} from '../shared/media-pipeline.ts'

export type MediaPipelineContext = {
    userId: string
    organizationId: string
    workspaceId: string
    conversationAssetId: string
    turnId: string
    responseMessageId: string
    runId: string
    epoch: number
    continuationEpoch: number
    authority: string
}

export type MediaPipelineOperationDefinition = {
    operationKey: string
    family: string
    execution: 'inference' | 'local'
    ready: boolean
    inputPorts: MediaPipelinePort[]
    outputPorts: MediaPipelinePort[]
    parameterSchema: Record<string, unknown>
}

export type MediaPipelineModelRoute = {
    modelId: string
    operationKeys: string[]
    inputKinds: MediaPipelineKind[]
    outputKinds: MediaPipelineKind[]
    inferenceProviderCalledByThePlatform: string
    adapterReady: boolean
    credentialsReady: boolean
    regionReady: boolean
    pricingReady: boolean
}

export type MediaPipelineCatalog = {
    operations: MediaPipelineOperationDefinition[]
    modelRoutes: MediaPipelineModelRoute[]
}

export type MediaPipelineOperationRequest = {
    operationId: string
    inputHash: string
    executionId: string
    pipelineId: string
    pipelineRevision: number
    node: MediaPipelineNode
    inputs: Record<string, MediaPipelineSource>
    sourceSnapshots?: MediaPipelineSource[]
    context: MediaPipelineContext
    inferenceProvider?: 'aws-bedrock'
}

export type MediaPipelineOperationReceipt = {
    operationId: string
    inputHash: string
    state: AgentOperationState
    outputs: Record<string, MediaPipelineSource>
    error?: MediaPipelineIssue
}

export type MediaPipelineOperationHandler = {
    definition: MediaPipelineOperationDefinition
    ensure: (request: MediaPipelineOperationRequest) => Promise<MediaPipelineOperationReceipt>
    read: (
        context: MediaPipelineContext,
        operationId: string,
    ) => Promise<MediaPipelineOperationReceipt | undefined>
    cancel?: (
        context: MediaPipelineContext,
        operationId: string,
    ) => Promise<void>
}

export type MediaPipelinePromptModelPort = {
    validateModels: (
        context: MediaPipelineContext,
        modelIds: string[],
        preparation: {
            id: string
            inputHash: string
        },
    ) => Promise<void>
    prepare: (
        context: MediaPipelineContext,
        request: {
            modelId: string
            preparationId: string
            systemPrompt: string
            userPrompt: string
            sources: MediaPipelineSource[]
        },
    ) => Promise<string>
}

export type MediaPipelineExecution = {
    executionId: string
    revision: number
    inputHash: string
    pipeline: MediaPipeline
    context: MediaPipelineContext
    state: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
    receipts: Record<string, MediaPipelineOperationReceipt>
    outputs: Record<string, MediaPipelineSource>
    issues: MediaPipelineIssue[]
}

export type MediaPipelineStoredArtifact = {
    assetId: string
    pipeline: MediaPipeline
}

export type MediaPipelinePorts = {
    promptModel?: MediaPipelinePromptModelPort
    authorize: (input: {
        context: MediaPipelineContext
        action: 'inspect' | 'plan' | 'execute'
        operationFamilies: string[]
        targetAssetIds: string[]
        pipelineId?: string
    }) => Promise<boolean>
    isContinuationCurrent: (context: MediaPipelineContext) => Promise<boolean>
    catalog: (context: MediaPipelineContext) => Promise<MediaPipelineCatalog>
    recheckSources: (
        context: MediaPipelineContext,
        sources: MediaPipelineSource[],
    ) => Promise<MediaPipelineIssue[]>
    readArtifact: (
        context: MediaPipelineContext,
        pipelineId: string,
    ) => Promise<MediaPipelineStoredArtifact | undefined>
    readArtifactMutation: (
        context: MediaPipelineContext,
        clientMutationId: string,
    ) => Promise<{
        inputHash: string
        artifact: MediaPipelineStoredArtifact
    } | undefined>
    commitArtifact: (input: {
        context: MediaPipelineContext
        pipeline: MediaPipeline
        expectedRevision: number
        clientMutationId: string
        inputHash: string
    }) => Promise<MediaPipelineStoredArtifact>
    createExecution: (execution: MediaPipelineExecution) => Promise<MediaPipelineExecution>
    readExecution: (
        executionId: string,
        allowHistorical?: boolean,
    ) => Promise<MediaPipelineExecution | undefined>
    saveExecution: (
        execution: MediaPipelineExecution,
        expectedRevision: number,
    ) => Promise<boolean>
    readOperation: (
        context: MediaPipelineContext,
        operationId: string,
    ) => Promise<MediaPipelineOperationReceipt | undefined>
    ensureOperation: (request: MediaPipelineOperationRequest) => Promise<MediaPipelineOperationReceipt>
    enqueueExecution: (executionId: string) => Promise<void>
    enqueueContinuation: (input: {
        context: MediaPipelineContext
        executionId: string
    }) => Promise<void>
}

export type MediaPipelineToolResult<Data> =
    | {
        status: 'completed'
        data: Data
        sources: MediaPipelineSource[]
    }
    | {
        status: 'pending'
        operationId: string
    }
    | {
        status: 'error'
        error: MediaPipelineIssue
        details?: CapabilityJsonValue
    }
