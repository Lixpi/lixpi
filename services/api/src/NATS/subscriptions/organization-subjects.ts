'use strict'

import chalk from 'chalk'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import Organization from '../../models/organization.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'
const { ORGANIZATION_SUBJECTS } = NATS_SUBJECTS


export const organizationSubjects = [
    // Organization ------------------------------------------------------------------------------------------------
    {
        subject: ORGANIZATION_SUBJECTS.GET_ORGANIZATION,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.GET_ORGANIZATION ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.GET_ORGANIZATION ] }
        },
        handler: async (data, msg) => {
            const { organizationId } = data
            const userId = socket?.user?.userId

            return await Organization.getOrganization({ organizationId, userId })
        }
    },

    {
        subject: ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION ] }
        },
        handler: async (data, msg) => {
            const { name, availableModels } = data
            const userId = socket?.user?.userId

            return await Organization.createOrganization({
                name,
                userId,
                accessLevel: 'owner'
            })
        }
    },
    {
        subject: ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION ] }
        },
        handler: async (data, msg) => {
            infoStr([
                chalk.green('Socket.IO -> '),
                chalk.green('update->organization')
            ])

            const { organizationId, name, availableModels } = data
            const userId = socket?.user?.userId

            return await Organization.updateOrganization({
                organizationId,
                name,
                userId
            })
        }
    },
    // END Organization --------------------------------------------------------------------------------------------


    // Organization Tags -------------------------------------------------------------------------------------------------------
    {
        subject: ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION_TAG,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION_TAG ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.CREATE_ORGANIZATION_TAG ] }
        },
        handler: async (data, msg) => {
            const { organizationId, name, color } = data
            const userId = socket?.user?.userId

            return await Organization.createTag({ organizationId, name, color, userId })
        }
    },
    {
        subject: ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION_TAG,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION_TAG ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.UPDATE_ORGANIZATION_TAG ] }
        },
        handler: async (data, msg) => {
            const { organizationId, tagId, name, color } = data
            const userId = socket?.user?.userId

            return await Organization.updateTag({ organizationId, tagId, name, color, userId })
        }
    },
    {
        subject: ORGANIZATION_SUBJECTS.DELETE_ORGANIZATION_TAG,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ ORGANIZATION_SUBJECTS.DELETE_ORGANIZATION_TAG ] },
            sub: { allow: [ ORGANIZATION_SUBJECTS.DELETE_ORGANIZATION_TAG ] }
        },
        handler: async (data, msg) => {
            const { organizationId, tagId } = data
            const userId = socket?.user?.userId

            return await Organization.deleteTag({ organizationId, tagId, userId })
        }
    },
    // END Organization Tags ---------------------------------------------------------------------------------------------------
]
