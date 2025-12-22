'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Document from '../../models/document.ts'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { DOCUMENT_SUBJECTS } = NATS_SUBJECTS

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
]
