import { NATS_SUBJECTS, getNatsUserSubjectToken, type MediaGenerationRunMeta } from '@lixpi/constants'

export type AssetDocumentRole = 'content' | 'conversation' | 'provenance'

export type AssetDocCoordinate = {
    organizationId: string
    assetId: string
    role: AssetDocumentRole
}

export type AssetStepEnvelope = AssetDocCoordinate & {
    kind: 'STEP'
    version: number
    subjectSeq: number
    step: object
    msgId?: string
    clientId?: string
    schemaVersion?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
    origin: 'ai-stream' | 'client-edit'
}

export type AssetStepControlEnvelope = AssetDocCoordinate & {
    kind: 'START' | 'END' | 'ERROR'
    version: number
    subjectSeq: number
    baseVersion?: number
    finalVersion?: number
    schemaVersion?: string
    error?: string
    msgId?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
    origin: 'ai-stream'
}

export type AssetStepStreamEvent = AssetStepEnvelope | AssetStepControlEnvelope

export type LoggedAssetStepStreamEvent = AssetStepStreamEvent & {
    streamSequence: number
}

export type AssetDocResumeResult = {
    snapshot: AssetDocSnapshot | null
    currentVersion: number
    currentStreamSeq: number
    streamName: string
    subject: string
    liveSubject?: string
    events: LoggedAssetStepStreamEvent[]
}

export type AssetSubmitStepsPayload = AssetDocCoordinate & {
    workspaceId: string
    leaseId: string
    holderId: string
    baseVersion: number
    expectedVersion: number
    steps: Array<{ step: object; msgId?: string; clientId?: string }>
    origin?: 'client-edit'
}

export type AssetDocSnapshot = AssetDocCoordinate & {
    blobHash?: string
    version: number
    schemaVersion: string
    doc: object
}

export const ASSET_PROSEMIRROR_STEP_SUBJECT_PREFIX = 'asset.document.steps'

export function getOrganizationAssetStepStreamName(organizationId: string): string {
    return `ASSET_STEPS_${sanitizeStreamToken(organizationId)}`
}

export function getOrganizationAssetStepStreamSubject(organizationId: string): string {
    return `${ASSET_PROSEMIRROR_STEP_SUBJECT_PREFIX}.${sanitizeSubjectToken(organizationId)}.>`
}

export function getAssetStepSubject(coordinate: AssetDocCoordinate): string {
    return [
        ASSET_PROSEMIRROR_STEP_SUBJECT_PREFIX,
        sanitizeSubjectToken(coordinate.organizationId),
        sanitizeSubjectToken(coordinate.assetId),
        sanitizeSubjectToken(coordinate.role),
    ].join('.')
}

export function getAssetDocumentEventSubject(userId: string, coordinate: AssetDocCoordinate): string {
    return [
        NATS_SUBJECTS.ASSET_SUBJECTS.DOCUMENT_EVENTS,
        getNatsUserSubjectToken(userId),
        sanitizeSubjectToken(coordinate.organizationId),
        sanitizeSubjectToken(coordinate.assetId),
        sanitizeSubjectToken(coordinate.role),
    ].join('.')
}

export type SubmitResult =
    | { status: 'ACCEPTED'; version: number }
    | { status: 'CONFLICT'; currentVersion: number }

function sanitizeStreamToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeSubjectToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}
