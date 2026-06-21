'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import type { Partial, Pick } from 'type-fest'
import { getDynamoDbTableStageName, type Organization, type OrganizationAccessList } from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE
} = process.env

export default {
    getOrganization: async ({
        organizationId,
        userId
    }: Pick<Organization, 'organizationId'> & { userId: string }): Promise<Organization | { error: string }> => {
        const org = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
            key: { organizationId },
            origin: 'model::Organization->get()'
        })

        if (!org || Object.keys(org).length === 0) {
            return { error: 'NOT_FOUND' }
        }

        // Check if user has permission to access organization
        const hasAccess = org.accessList && org.accessList[userId]

        if (!hasAccess) {
            return { error: 'PERMISSION_DENIED' }
        }

        delete org.accessList

        return org
    },

    getUserOrganizations: async ({
        userId
    }: { userId: string }): Promise<Organization[]> => {
        const userOrgs = await dynamoDBService.queryItems({
            tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
            indexName: 'updatedAt',
            keyConditions: { userId: userId },
            limit: 25,
            fetchAllItems: true,
            scanIndexForward: false,
            origin: 'model::Organization->getUserOrganizations()',
        })

        if (!userOrgs.items.length) {
            return []
        }

        const orgDetails = await dynamoDBService.batchReadItems({
            queries: [{
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                keys: userOrgs.items.map(({ organizationId }) => ({ organizationId })),
            }],
            readBatchSize: 100,
            fetchAllItems: true,
            scanIndexForward: false,
            origin: 'model::Organization->getUserOrganizations()'
        })

        return orgDetails.items[getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE)]
    },

    createOrganization: async ({
        name,
        userId,
        accessLevel
    }: Pick<Organization, 'name'> & { userId: string; accessLevel: string }): Promise<Organization | { error: string }> => {
        const currentDate = new Date().getTime()
        const organizationId = uuid()

        const newOrgData = {
            organizationId,
            name,
            tags: {},
            accessList: { [userId]: accessLevel },
            createdAt: currentDate,
            updatedAt: currentDate,
        }

        try {
            // Insert the new organization data into the database
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                item: newOrgData,
                origin: 'createOrganization'
            })

            // Insert the new organization access list into the database
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                item: {
                    userId: userId,    // Partition key
                    organizationId,    // Sort key
                    accessLevel,
                    createdAt: currentDate,
                    updatedAt: currentDate
                },
                origin: 'createOrganization'
            })

            return newOrgData
        } catch (e) {
            console.error('createOrganization failed', e)
            return { error: 'CREATION_FAILED' }
        }
    },

    updateOrganization: async ({
        organizationId,
        name,
        userId
    }: Pick<Organization, 'organizationId'> & { name?: string; userId: string }): Promise<Organization | { error: string }> => {
        const currentDate = new Date().getTime()

        try {
            const org = await this.getOrganization({ organizationId, userId })
            if (org.error) {
                return org
            }

            const updates = {
                ...(name && { name }),
                updatedAt: currentDate
            }

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updates,
                origin: 'updateOrganization'
            })

            return { ...org, ...updates }
        } catch (e) {
            console.error(e)
            return { error: 'UPDATE_FAILED' }
        }
    },

    deleteOrganization: async ({
        organizationId,
        userId
    }: Pick<Organization, 'organizationId'> & { userId: string }): Promise<{ status: string; organizationId: string } | { error: string }> => {
        try {
            const org = await this.getOrganization({ organizationId, userId })
            if (org.error) {
                return org
            }

            if (org.accessList[userId] !== 'owner') {
                return { error: 'PERMISSION_DENIED' }
            }

            // Delete the organization
            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                origin: 'deleteOrganization:Organizations'
            })

            // Delete all access list entries for this organization
            const accessListEntries = await dynamoDBService.queryItems({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                indexName: 'organizationId',
                keyConditions: { organizationId },
                fetchAllItems: true,
                origin: 'deleteOrganization:AccessList',
            })

            for (const entry of accessListEntries.items) {
                await dynamoDBService.deleteItems({
                    tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                    key: { userId: entry.userId, organizationId },
                    origin: 'deleteOrganization:AccessList'
                })
            }

            return { status: 'deleted', organizationId }
        } catch (e) {
            console.error(e)
            return { error: 'DELETION_FAILED' }
        }
    },

    addUserToOrganization: async ({
        organizationId,
        userId,
        accessLevel,
        addedByUserId
    }: Pick<Organization, 'organizationId'> & { userId: string; accessLevel: string; addedByUserId: string }): Promise<{ status: string; userId: string; organizationId: string; accessLevel: string } | { error: string }> => {
        const currentDate = new Date().getTime()

        try {
            const org = await this.getOrganization({ organizationId, userId: addedByUserId })
            if (org.error) {
                return org
            }

            if (org.accessList[addedByUserId] !== 'owner') {
                return { error: 'PERMISSION_DENIED' }
            }

            // Update Organizations table
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updates: {
                    [`accessList.${userId}`]: accessLevel,
                    updatedAt: currentDate
                },
                origin: 'addUserToOrganization:Organizations'
            })

            // Add entry to Organizations-Access-List table
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                item: {
                    userId: userId,    // Partition key
                    organizationId,    // Sort key
                    accessLevel,
                    createdAt: currentDate,
                    updatedAt: currentDate
                },
                origin: 'addUserToOrganization:AccessList'
            })

            return { status: 'added', userId, organizationId, accessLevel }
        } catch (e) {
            console.error(e)
            return { error: 'ADD_USER_FAILED' }
        }
    },

        removeUserFromOrganization: async ({
        organizationId,
        userId,
        removedByUserId
    }: Pick<Organization, 'organizationId'> & { userId: string; removedByUserId: string }): Promise<{ status: string; userId: string; organizationId: string } | { error: string }> => {
        const currentDate = new Date().getTime()

        try {
            const org = await this.getOrganization({ organizationId, userId: removedByUserId })
            if (org.error) {
                return org
            }

            if (org.accessList[removedByUserId] !== 'owner' && removedByUserId !== userId) {
                return { error: 'PERMISSION_DENIED' }
            }

            // Update Organizations table
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updates: {
                    [`accessList.${userId}`]: null,
                    updatedAt: currentDate
                },
                origin: 'removeUserFromOrganization:Organizations'
            })

            // Remove entry from Organizations-Access-List table
            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                key: { userId: userId, organizationId },
                origin: 'removeUserFromOrganization:AccessList'
            })

            return { status: 'removed', userId, organizationId }
        } catch (e) {
            console.error(e)
            return { error: 'REMOVE_USER_FAILED' }
        }
    },

    createTag: async ({
        organizationId,
        name,
        color,
        userId
    }: Pick<Organization, 'organizationId'> & { name: string; color: string; userId: string }): Promise<{ tags: Record<string, { name: string; color: string }> } | null> => {
        const currentDate = new Date().getTime()
        const tagId = uuid()

        try {
            const updateExpression = 'SET #tags.#tagId = :tagValue, #updatedAt = :updatedAt'

            const expressionAttributeNames = {
                '#tags': 'tags',
                '#tagId': tagId,
                '#updatedAt': 'updatedAt'
            }

            const expressionAttributeValues = {
                ':tagValue': { name, color },
                ':updatedAt': currentDate
            }

            const createdOrganizationTag = await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updateExpression,
                expressionAttributeNames,
                expressionAttributeValues,
                origin: 'model::Organization->createTag()'
            })

            return { tags: createdOrganizationTag.tags }    // Returns tags object where the key is the tagId and the value is the tag object
        } catch (e) {
            console.error(e)
            return null
        }
    },

    updateTag: async ({
        organizationId,
        tagId,
        name,
        color,
        userId
    }: Pick<Organization, 'organizationId'> & { tagId: string; name: string; color: string; userId: string }): Promise<any> => {
        const currentDate = new Date().getTime()

        try {
            const updates = {
                [`#tags.${tagId}`]: { name, color },
                updatedAt: currentDate
            }

            const expressionAttributeNames = {
                '#tags': 'tags'
            }

            const updatedOrganizationTag = await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updates,
                expressionAttributeNames,
                origin: 'model::Organization->updateTag()'
            })

            return updatedOrganizationTag
        } catch (e) {
            console.error(e)
            return null
        }
    },

    deleteTag: async ({
        organizationId,
        tagId,
        userId
    }: Pick<Organization, 'organizationId'> & { tagId: string; userId: string }): Promise<any> => {
        const currentDate = new Date().getTime()

        try {
            const updates = {
                [`#tags.${tagId}`]: null,
                updatedAt: currentDate
            }

            const expressionAttributeNames = {
                '#tags': 'tags'
            }

            const updatedOrg = await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                key: { organizationId },
                updates,
                expressionAttributeNames,
                origin: 'model::Organization->deleteTag()'
            })

            return updatedOrg
        } catch (e) {
            console.error(e)
            return null
        }
    },
}
