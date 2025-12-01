'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import Document from '../../models/document.ts'

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
        handler: async (data, msg) => {
            return await Document.getDocument({
                userId: data.user.userId,
                documentId: data.documentId,
                revision: 1,
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
        handler: async (data, msg) => {
            const {
                user: {
                    userId
                },
                title,
                aiModel,
                content
            } = data

            const document = await Document.createDocument({
                title,
                aiModel: aiModel,
                content,
                permissions: {
                    userId: userId,
                    accessLevel: 'owner'
                }
            })

            //TODO: when document is created, not just the requester but all the users in the organization should be notified
            //TODO: nats publish to all users in the organization (except the requester???)

            return document
        }
    },

    {
        subject: DOCUMENT_SUBJECTS.GET_USER_DOCUMENTS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ DOCUMENT_SUBJECTS.GET_USER_DOCUMENTS ] },
            sub: { allow: [ DOCUMENT_SUBJECTS.GET_USER_DOCUMENTS ] }
        },
        handler: async (data, msg) => {
            const userId = data.user.userId

            if (!userId) {
                err('NATS -> DOCUMENT_SUBJECTS.GET_USER_DOCUMENTS', 'userId is not available in the socket token.')
                return
            }

            return await Document.getUserDocuments({ userId })
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
        handler: async (data, msg) => {
            const document = await Document.update({
                userId: data.user.userId,
                permissions: data.permissions,
                documentId: data.documentId,
                title: data.title,
                prevRevision: data.prevRevision,
                aiModel: data.aiModel,
                content: data.content,
            })

            return {
                success: true,
                documentId: data.documentId
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
        handler: async (data, msg) => {
            const document = await Document.delete({
                userId: data.user.userId,
                documentId: data.documentId
            })

            return {
                success: true,
                documentId: data.documentId
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
        handler: async (data, msg) => {
            return  await Document.addTagToDocument({
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
        handler: async (data, msg) => {
            return await Document.removeTagFromDocument({
                documentId: data.documentId,
                tagId: data.tagId
            })
        }
    },
]
