'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Document from '../../models/document.ts'
import AiChatThread from '../../models/ai-chat-thread.ts'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    PROSEMIRROR_SCHEMA_VERSION,
    getDocumentStepSubject,
    getWorkspaceStepStreamName,
    type DocCoordinate,
    type DocSnapshot,
    type StepStreamEvent,
    type SubmitStepPayload,
} from '@lixpi/prosemirror'
import { ProseMirrorStepTransport } from '../../prosemirror/prosemirror-step-transport.ts'

const { DOCUMENT_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const { DOCUMENT_STEP_SUBJECTS } = NATS_SUBJECTS
const DOCUMENT_STEP_STREAM_SUBJECT = `${DOCUMENT_STEP_SUBJECTS.DOC_STEPS}.>`

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

function getReplayCurrentVersion(snapshot: DocSnapshot | null, events: StepStreamEvent[]): number {
    let currentVersion = snapshot?.version ?? 0
    for (const event of events) {
        if (event.kind === 'END') {
            currentVersion = Math.max(currentVersion, event.finalVersion)
            continue
        }
        currentVersion = Math.max(currentVersion, event.version)
    }
    return currentVersion
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
        subject: DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEP,
        type: 'reply',
        queue: 'documentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEP] },
            sub: { allow: [DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEP] }
        },
        handler: async (data: SubmitStepPayload & { user: { userId: string } }, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            return await ProseMirrorStepTransport.fromSingleton().submitStep({
                workspaceId: data.workspaceId,
                docType: data.docType,
                docId: data.docId,
                baseVersion: data.baseVersion,
                expectedVersion: data.expectedVersion,
                step: data.step,
                msgId: data.msgId,
                clientId: data.clientId,
                origin: 'client-edit',
            })
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
        handler: async (data: DocCoordinate & { baseVersion?: number; localVersion?: number; user: { userId: string } }, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const transport = ProseMirrorStepTransport.fromSingleton()
            await transport.ensureWorkspaceStream(workspaceId)
            const snapshot = await loadProseMirrorSnapshot(data)
            const localVersion = data.localVersion ?? data.baseVersion ?? snapshot?.version ?? 0
            const currentSubjectSeq = await transport.getCurrentSubjectSequence(data)
            const currentVersion = Math.max(
                snapshot?.version ?? 0,
                (data.baseVersion ?? snapshot?.version ?? 0) + currentSubjectSeq,
            )
            if (localVersion >= currentVersion) {
                return {
                    snapshot,
                    currentVersion,
                    streamName: getWorkspaceStepStreamName(workspaceId),
                    subject: getDocumentStepSubject(data),
                    events: [],
                }
            }
            const events = await transport.replayDocumentStepEvents({
                workspaceId: data.workspaceId,
                docType: data.docType,
                docId: data.docId,
                startStreamSeq: 1,
                maxMessages: 1000,
            })
            const replayEvents = events.filter((event) => {
                if (event.kind === 'START') return localVersion <= event.baseVersion
                if (event.kind === 'END') return localVersion < event.finalVersion
                if (event.kind === 'ERROR') return true
                return event.version > localVersion
            })

            return {
                snapshot,
                currentVersion: getReplayCurrentVersion(snapshot, events),
                streamName: getWorkspaceStepStreamName(workspaceId),
                subject: getDocumentStepSubject(data),
                events: replayEvents,
            }
        }
    },
]
