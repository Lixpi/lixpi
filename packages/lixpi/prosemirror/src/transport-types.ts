import type { MediaGenerationRunMeta } from '@lixpi/constants'

export type ProseMirrorDocType = 'document' | 'aiChatThread'

export type DocCoordinate = {
    workspaceId: string
    docType: ProseMirrorDocType
    docId: string
}

export type StepEnvelope = DocCoordinate & {
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

export type SubmitStepsPayload = DocCoordinate & {
    baseVersion: number
    expectedVersion: number
    steps: Array<{
        step: object
        msgId?: string
        clientId?: string
    }>
    origin?: 'client-edit'
}

export type SubmitResult =
    | { status: 'ACCEPTED'; version: number }
    | { status: 'CONFLICT'; currentVersion: number }

export type StreamControl =
    | { kind: 'START'; docId: string; baseVersion: number; schemaVersion: string }
    | { kind: 'END'; docId: string; finalVersion: number }
    | { kind: 'ERROR'; docId: string; error: string }

export type StepStreamControlEnvelope = DocCoordinate & StreamControl & {
    version: number
    subjectSeq: number
    msgId?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
    origin: 'ai-stream'
}

export type StepStreamEvent = StepEnvelope | StepStreamControlEnvelope

export type LoggedStepStreamEvent = StepStreamEvent & {
    streamSequence: number
}

export type DocSnapshot = DocCoordinate & {
    version: number
    schemaVersion: string
    doc: object
}

export type DocResumePayload = DocCoordinate & {
    baseVersion?: number
    localVersion?: number
    localStreamSeq?: number
}

export type DocResumeResult = {
    snapshot: DocSnapshot | null
    currentVersion: number
    currentStreamSeq: number
    streamName: string
    subject: string
    events: LoggedStepStreamEvent[]
}

export const PROSEMIRROR_STEP_SUBJECT_PREFIX = 'document.steps'

export function getWorkspaceStepStreamName(workspaceId: string): string {
    return `PM_STEPS_${sanitizeStreamToken(workspaceId)}`
}

export function getWorkspaceStepStreamSubject(workspaceId: string): string {
    return `${PROSEMIRROR_STEP_SUBJECT_PREFIX}.${sanitizeSubjectToken(workspaceId)}.>`
}

export function getDocumentStepSubject(coordinate: DocCoordinate): string {
    return [
        PROSEMIRROR_STEP_SUBJECT_PREFIX,
        sanitizeSubjectToken(coordinate.workspaceId),
        sanitizeSubjectToken(coordinate.docType),
        sanitizeSubjectToken(coordinate.docId),
    ].join('.')
}

function sanitizeStreamToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeSubjectToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}
