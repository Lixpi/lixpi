import {
    type AiInteractionMediaGenerationRequest,
} from './types.ts'

export const AGENT_CONVERSATION_PROTOCOL_VERSION = 1
export const AGENT_DISPATCH_SHARDS = 16
export const AGENT_OWNER_LEASE_MS = 30_000
export const AGENT_OWNER_RENEWAL_MS = 10_000
export const AGENT_DISPATCH_POLL_MS = 1_000
export const CONVERSATION_RESPONSE_MAX_BYTES = 768_000

export type ConversationContextMode = 'explicit' | 'discovery' | 'mixed'
export type ConversationMidRunPolicy = 'steer' | 'stop-first' | 'queue'
export type ConversationRunState =
    | 'queued'
    | 'running'
    | 'waiting-tools'
    | 'waiting-input'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed'
    | 'needs-reauthentication'

export type AgentOperationState =
    | 'prepared'
    | 'authorized'
    | 'submitted'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'outcome-unknown'

// Preferences describe a possible future action. They are never an execution grant.
export type ConversationModelPreferences = Pick<AiInteractionMediaGenerationRequest,
    | 'reasoningModelIds'
    | 'imageModelIds'
    | 'videoModelIds'
    | 'reasoningOptions'
    | 'imageOptions'
    | 'videoOptions'>

export type ConversationSettings = {
    contextMode: ConversationContextMode
    midRunPolicy: ConversationMidRunPolicy
    models: ConversationModelPreferences
}

export const createConversationSettings = (): ConversationSettings => ({
    contextMode: 'explicit',
    midRunPolicy: 'steer',
    models: {
        reasoningModelIds: [],
        imageModelIds: [],
        videoModelIds: [],
    },
})

export type ConversationJson = null | boolean | number | string | ConversationJson[] | { [key: string]: ConversationJson }
export type ConversationMessageNode = {
    type: string
    text?: string
    attrs?: Record<string, ConversationJson>
    content?: ConversationMessageNode[]
    marks?: Array<{
        type: string
        attrs?: Record<string, ConversationJson>
    }>
}

export type ConversationReference = {
    assetId: string
    role: 'content' | 'conversation' | 'provenance' | 'media' | 'artifact'
    revision?: number
    renditionId?: string
}

export type ConversationSourceSnapshot = ConversationReference & {
    revision: number
    blobHash?: string
    documentVersion?: number
    acquiredBy: 'explicit' | 'discovery' | 'conversation-output'
    relationshipPath: string[]
}

export type ConversationCommandBase = {
    protocolVersion: 1
    workspaceId: string
    conversationAssetId: string
}

export type ConversationCreateRequest = Omit<ConversationCommandBase, 'conversationAssetId'> & {
    clientConversationId: string
    settings?: Partial<ConversationSettings>
}

export type ConversationListRequest = Pick<ConversationCommandBase, 'protocolVersion' | 'workspaceId'> & {
    cursor?: string
    limit?: number
}

export type ConversationGetRequest = ConversationCommandBase & {
    clientMessageId?: string
}

export type ConversationMessagesRequest = ConversationCommandBase & {
    cursor?: string
    limit?: number
}

export type ConversationSubmitRequest = ConversationCommandBase & {
    clientMessageId: string
    fragment: ConversationMessageNode
    references: ConversationReference[]
    settingsRevision: number
    midRunPolicy?: ConversationMidRunPolicy
    interruptId?: string
}

export type ConversationSettingsRequest = ConversationCommandBase & {
    expectedRevision: number
    patch: Partial<ConversationSettings>
}

export type ConversationStopRequest = ConversationCommandBase & {
    runId: string
    clientCommandId: string
}

export type ConversationQueueRequest = ConversationCommandBase & {
    expectedRevision: number
    clientCommandId: string
    action: 'cancel-message' | 'resume'
    turnIds: string[]
}

export type ConversationReplayRequest = ConversationCommandBase & {
    afterEventSeq: number
    limit?: number
}

export type ConversationFailure = {
    code: string
    message: string
    recoverable: boolean
    currentRevision?: number
    changedObjectIds?: string[]
}

export type ConversationAcknowledgement = {
    status: 'accepted' | 'duplicate'
    clientMessageId: string
    turnId: string
    commandSeq: number
    eventSeq: number
    documentRevision: number
    projectionPending: boolean
} | {
    status: 'rejected'
    clientMessageId: string
    error: ConversationFailure
}

export type ConversationTurn = {
    turnId: string
    clientMessageId: string
    commandSeq: number
    userId: string
    fragment: ConversationMessageNode
    references: ConversationSourceSnapshot[]
    settings: ConversationSettings
    settingsRevision: number
    midRunPolicy: ConversationMidRunPolicy
    state: ConversationRunState
    createdAt: number
    interruptId?: string
}

export type AgentTurnBudget = {
    modelCalls: number
    toolCalls: number
    specialistCalls: number
    maxModelCalls: number
    maxToolCalls: number
    maxSpecialistCalls: number
}

export type ConversationRun = {
    runId: string
    continuedFromRunId?: string
    budgetAllocationId?: string
    continuedFromBudgetAllocationId?: string
    turnId: string
    state: ConversationRunState
    epoch: number
    instructionRevision: number
    continuationEpoch: number
    budget: AgentTurnBudget
    operationIds: string[]
    interruptId?: string
    error?: ConversationFailure
    updatedAt: number
}

export type AgentOperation = {
    operationId: string
    conversationAssetId: string
    turnId: string
    runId: string
    responseMessageId: string
    operationKey: string
    executionId?: string
    stepId?: string
    stepLabel?: string
    inputHash: string
    sources: ConversationSourceSnapshot[]
    state: AgentOperationState
    epoch: number
    continuationEpoch: number
    modelId?: string
    inferenceProvider?: 'aws-bedrock'
    authorizationId?: string
    providerRequestId?: string
    providerJobId?: string
    outputAssetIds: Record<string, string>
    error?: ConversationFailure
    createdAt: number
    updatedAt: number
}

export type ConversationMessage = {
    messageId: string
    turnId: string
    role: 'user' | 'assistant' | 'configuration'
    text: string
    clientMessageId?: string
    complete: boolean
    createdAt: number
    orderKey?: string
}

export type ConversationMessagesPage = {
    messages: ConversationMessage[]
    operations?: ConversationOperationSummary[]
    cursor?: string
}

export type ConversationOperationSummary = Pick<AgentOperation, 'operationId' | 'turnId' | 'responseMessageId' | 'operationKey' | 'executionId' | 'stepId' | 'stepLabel' | 'state' | 'outputAssetIds' | 'error' | 'createdAt' | 'updatedAt'>

export type ConversationSnapshot = ConversationCommandBase & {
    title: string
    settings: ConversationSettings
    settingsRevision: number
    queueRevision: number
    queuePaused: boolean
    queuedTurns: Array<Pick<ConversationTurn, 'turnId' | 'clientMessageId' | 'commandSeq' | 'state' | 'createdAt' | 'interruptId'>>
    run?: ConversationRun
    messages: ConversationMessage[]
    operations?: ConversationOperationSummary[]
    messageCursor?: string
    documentRevision: number
    eventSeq: number
    createdAt: number
    updatedAt: number
    acknowledgement?: ConversationAcknowledgement
}

export type ConversationEventPayloads = {
    'message.accepted': ConversationAcknowledgement
    'message.delta': {
        messageId: string
        offset: number
        text: string
    }
    'message.completed': ConversationMessage
    'run.state': ConversationRun
    'queue.state': {
        revision: number
        paused: boolean
        turnIds: string[]
    }
    'operation.status': ConversationOperationSummary
    'output.committed': {
        operationId: string
        outputSlot: string
        assetId: string
    }
    'settings.changed': {
        settings: ConversationSettings
        revision: number
    }
    error: ConversationFailure
}

export type ConversationEvent = {
    [Kind in keyof ConversationEventPayloads]: ConversationCommandBase & {
        type: Kind
        payload: ConversationEventPayloads[Kind]
        turnId: string | null
        runId: string | null
        epoch: number
        eventSeq: number
        createdAt: number
    }
}[keyof ConversationEventPayloads]

export type ConversationReplay = {
    events: ConversationEvent[]
    eventSeq: number
    hasMore: boolean
    snapshotRequired: boolean
}

export type AgentToolResult<T> = {
    status: 'completed'
    data: T
    sources: ConversationSourceSnapshot[]
} | {
    status: 'pending'
    operationId: string
} | {
    status: 'error'
    error: ConversationFailure
}
