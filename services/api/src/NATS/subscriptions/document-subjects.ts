'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Document from '../../models/document.ts'
import AiChatThread from '../../models/ai-chat-thread.ts'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
    getDocumentStepSubject,
    getWorkspaceStepStreamName,
    type DocCoordinate,
    type DocSnapshot,
    type LoggedStepStreamEvent,
    type SubmitStepsPayload,
} from '@lixpi/prosemirror'
import { ProseMirrorStepTransport } from '../../prosemirror/prosemirror-step-transport.ts'

const { DOCUMENT_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const { DOCUMENT_STEP_SUBJECTS } = NATS_SUBJECTS
const DOCUMENT_STEP_STREAM_SUBJECT = `${DOCUMENT_STEP_SUBJECTS.DOC_STEPS}.>`
const DOCUMENT_STEP_SNAPSHOT_SETTLE_MS = 5000
const DOCUMENT_STEP_WORKSPACE_ACCESS_CACHE_MS = 5000
const documentStepSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>()
const documentStepWorkspaceAccessCache = new Map<string, { expiresAt: number }>()

function parseStoredDocContent(content: unknown): object | null {
    if (!content) return null
    if (typeof content === 'object') return content
    if (typeof content !== 'string') return null

    try {
        const parsed = JSON.parse(content)
        return typeof parsed === 'object' && parsed !== null ? parsed : null
    } catch {
        return null
    }
}

function getStoredDocVersion(record: Record<string, any>): number {
    const rawVersion = record.proseMirrorVersion ?? record.version
    return typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 0
        ? rawVersion
        : 0
}

async function loadProseMirrorSnapshot(coordinate: DocCoordinate): Promise<DocSnapshot | null> {
    if (coordinate.docType === 'aiChatThread') {
        const thread = await AiChatThread.getAiChatThread({
            workspaceId: coordinate.workspaceId,
            threadId: coordinate.docId,
        })
        if (!thread || 'error' in thread) return null
        const doc = parseStoredDocContent(thread.content)
        if (!doc) return null

        return {
            ...coordinate,
            version: getStoredDocVersion(thread),
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            doc,
        }
    }

    const document = await Document.getDocument({
        workspaceId: coordinate.workspaceId,
        documentId: coordinate.docId,
        revision: 1,
    })
    if (!document || 'error' in document) return null
    const doc = parseStoredDocContent(document.content)
    if (!doc) return null

    return {
        ...coordinate,
        version: getStoredDocVersion(document),
        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        doc,
    }
}

function getDocumentSnapshotKey(coordinate: DocCoordinate): string {
    return `${coordinate.workspaceId}:${coordinate.docType}:${coordinate.docId}`
}

async function verifyDocumentStepWorkspaceAccess({ userId, workspaceId }: { userId: string; workspaceId: string }): Promise<{ error?: string }> {
    const cacheKey = `${userId}:${workspaceId}`
    const cached = documentStepWorkspaceAccessCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return {}

    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    if (!workspace || 'error' in workspace) {
        documentStepWorkspaceAccessCache.delete(cacheKey)
        return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
    }

    documentStepWorkspaceAccessCache.set(cacheKey, { expiresAt: Date.now() + DOCUMENT_STEP_WORKSPACE_ACCESS_CACHE_MS })
    return {}
}

function getDocumentTitleFromSnapshot(snapshot: object): string {
    const doc = snapshot as { content?: Array<{ type?: string; content?: Array<{ text?: string }> }> }
    const titleNode = doc.content?.find(node => node.type === 'documentTitle')
    return titleNode?.content?.map(node => node.text ?? '').join('') || 'Untitled'
}

async function persistSettledDocumentStepSnapshot(coordinate: DocCoordinate): Promise<void> {
    if (coordinate.docType !== DOCUMENT_TYPE.DOCUMENT) return

    const snapshot = await loadProseMirrorSnapshot(coordinate)
    const transport = ProseMirrorStepTransport.fromSingleton()
    const events = await transport.replayDocumentStepEvents({
        ...coordinate,
        startStreamSeq: 1,
        maxMessages: 10000,
    })
    const engine = new HeadlessProseMirrorEngine({
        documentType: DOCUMENT_TYPE.DOCUMENT,
        doc: snapshot?.doc,
        version: snapshot?.version ?? 0,
    })

    for (const event of events) {
        if (event.kind !== 'STEP' || event.version <= engine.version) continue
        engine.applyStepJson(event.step)
    }

    const finalVersion = engine.version
    if (snapshot && finalVersion <= snapshot.version) return

    const finalSnapshot = engine.snapshot()
    await Document.update({
        workspaceId: coordinate.workspaceId,
        documentId: coordinate.docId,
        title: getDocumentTitleFromSnapshot(finalSnapshot),
        content: finalSnapshot as any,
        proseMirrorVersion: finalVersion,
    })
}

function scheduleSettledDocumentStepSnapshot(coordinate: DocCoordinate): void {
    if (coordinate.docType !== DOCUMENT_TYPE.DOCUMENT) return

    const key = getDocumentSnapshotKey(coordinate)
    const existingTimer = documentStepSnapshotTimers.get(key)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
        documentStepSnapshotTimers.delete(key)
        void persistSettledDocumentStepSnapshot(coordinate).catch((error) => {
            console.error('[DOCUMENT_STEPS] settled snapshot failed:', { coordinate, error })
        })
    }, DOCUMENT_STEP_SNAPSHOT_SETTLE_MS)
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') timer.unref()
    documentStepSnapshotTimers.set(key, timer)
}

function shouldReplayStepStreamEvent(event: LoggedStepStreamEvent, localVersion: number): boolean {
    if (event.kind === 'START') return localVersion <= event.baseVersion
    if (event.kind === 'END') return localVersion < event.finalVersion
    if (event.kind === 'ERROR') return true
    return event.version > localVersion
}

async function replayRelevantStepStreamEvents({
    transport,
    coordinate,
    localStreamSeq,
    localVersion,
    currentStreamSeq,
    maxMessages,
}: {
    transport: ProseMirrorStepTransport
    coordinate: DocCoordinate
    localStreamSeq: number
    localVersion: number
    currentStreamSeq: number
    maxMessages: number
}): Promise<LoggedStepStreamEvent[]> {
    const replayEvents: LoggedStepStreamEvent[] = []
    let nextStreamSeq = Math.max(1, localStreamSeq + 1)

    while (nextStreamSeq <= currentStreamSeq && replayEvents.length < maxMessages) {
        const events = await transport.replayDocumentStepEvents({
            ...coordinate,
            startStreamSeq: nextStreamSeq,
            maxMessages,
        })
        if (events.length === 0) break

        for (const event of events) {
            if (shouldReplayStepStreamEvent(event, localVersion)) replayEvents.push(event)
            if (replayEvents.length >= maxMessages) break
        }

        const lastEvent = events.at(-1)
        if (!lastEvent || lastEvent.streamSequence >= currentStreamSeq) break
        nextStreamSeq = lastEvent.streamSequence + 1
    }

    return replayEvents
}

export const documentSubjects = [
    {
        subject: DOCUMENT_SUBJECTS.GET_DOCUMENT,
        type: 'reply',
        payloadType: 'json',

        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.GET_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.GET_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, documentId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            return await Document.getDocument({
                workspaceId,
                documentId,
                revision: 1
            })
        }
    },

    {
        subject: DOCUMENT_SUBJECTS.CREATE_DOCUMENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.CREATE_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.CREATE_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            const {
                user: { userId },
                workspaceId,
                title,
                content
            } = data

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const document = await Document.createDocument({
                workspaceId,
                title,
                content
            })

            return document
        }
    },

    {
        subject: DOCUMENT_SUBJECTS.UPDATE_DOCUMENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.UPDATE_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.UPDATE_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, documentId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            await Document.update({
                workspaceId,
                documentId,
                title: data.title,
                prevRevision: data.prevRevision,
                content: data.content
            })

            return {
                success: true,
                documentId
            }
        }
    },


    {
        subject: DOCUMENT_SUBJECTS.DELETE_DOCUMENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.DELETE_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.DELETE_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId, documentId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            await Document.delete({
                workspaceId,
                documentId
            })

            return {
                success: true,
                documentId
            }
        }
    },

    {
        subject: DOCUMENT_SUBJECTS.ADD_TAG_TO_DOCUMENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.ADD_TAG_TO_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.ADD_TAG_TO_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            return await Document.addTagToDocument({
                userId: data.user.userId,
                documentId: data.documentId,
                tagId: data.tagId
            })
        }
    },
    {
        subject: DOCUMENT_SUBJECTS.REMOVE_TAG_FROM_DOCUMENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.REMOVE_TAG_FROM_DOCUMENT ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.REMOVE_TAG_FROM_DOCUMENT ] }
        },
        handler: async (data: any, msg: any) => {
            return await Document.removeTagFromDocument({
                documentId: data.documentId,
                tagId: data.tagId
            })
        }
    },
    {
        subject: DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEPS,
        type: 'reply',
        queue: 'documentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEPS] },
            sub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEPS] }
        },
        handler: async (data: SubmitStepsPayload & { user: { userId: string } }, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const access = await verifyDocumentStepWorkspaceAccess({ userId, workspaceId })
            if (access.error) return access

            const result = await ProseMirrorStepTransport.fromSingleton().submitSteps({
                workspaceId: data.workspaceId,
                docType: data.docType,
                docId: data.docId,
                baseVersion: data.baseVersion,
                expectedVersion: data.expectedVersion,
                steps: data.steps,
                origin: 'client-edit',
            })
            if (result.status === 'ACCEPTED') {
                scheduleSettledDocumentStepSnapshot({
                    workspaceId: data.workspaceId,
                    docType: data.docType,
                    docId: data.docId,
                })
            }
            return result
        }
    },
    {
        subject: DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
        type: 'reply',
        queue: 'documentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_RESUME] },
            sub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_RESUME, DOCUMENT_STEP_STREAM_SUBJECT] }
        },
        handler: async (data: DocCoordinate & { baseVersion?: number; localVersion?: number; localStreamSeq?: number; user: { userId: string } }, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const snapshot = await loadProseMirrorSnapshot(data)
            const localVersion = data.localVersion ?? data.baseVersion ?? snapshot?.version ?? 0
            const localStreamSeq = typeof data.localStreamSeq === 'number' ? data.localStreamSeq : 0
            const transport = ProseMirrorStepTransport.fromSingleton()
            const subjectState = await transport.getCurrentSubjectStateOrNull(data)
            const currentStreamSeq = subjectState?.streamSequence ?? 0
            const currentVersion = Math.max(
                snapshot?.version ?? 0,
                subjectState?.documentVersion ?? 0,
            )
            if (localVersion >= currentVersion && localStreamSeq >= currentStreamSeq) {
                return {
                    snapshot,
                    currentVersion,
                    currentStreamSeq,
                    streamName: getWorkspaceStepStreamName(workspaceId),
                    subject: getDocumentStepSubject(data),
                    events: [],
                }
            }
            const replayEvents = await replayRelevantStepStreamEvents({
                transport,
                coordinate: {
                    workspaceId: data.workspaceId,
                    docType: data.docType,
                    docId: data.docId,
                },
                localStreamSeq,
                localVersion,
                currentStreamSeq,
                maxMessages: 1000,
            })

            return {
                snapshot,
                currentVersion,
                currentStreamSeq,
                streamName: getWorkspaceStepStreamName(workspaceId),
                subject: getDocumentStepSubject(data),
                events: replayEvents,
            }
        }
    },
]
