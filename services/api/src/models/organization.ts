'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import type { Partial, Pick } from 'type-fest'
import { getDynamoDbTableStageName, type Organization, type OrganizationAccessList } from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE
} = process.env

// Internal loader that keeps the accessList map — permission checks and the
// access-list fan-out need it; getOrganization strips it before returning.
const getOrganizationRecord = async (organizationId: string): Promise<Record<string, any> | null> => {
    const org = await dynamoDBService.getItem({
        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
        key: { organizationId },
        origin: 'model::Organization->getRecord()'
    })

    if (!org || Object.keys(org).length === 0) {
        return null
    }

    return org
}

const OrganizationModel = {
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
            // Organization row + owner's access-list row commit or fail together
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                        item: newOrgData
                    },
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                        item: {
                            userId: userId,    // Partition key
                            organizationId,    // Sort key
                            accessLevel,
                            createdAt: currentDate,
                            updatedAt: currentDate
                        }
                    }
                ],
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
            const org = await getOrganizationRecord(organizationId)
            if (!org) {
                return { error: 'NOT_FOUND' }
            }
            if (!org.accessList?.[userId]) {
                return { error: 'PERMISSION_DENIED' }
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
            const org = await getOrganizationRecord(organizationId)
            if (!org) {
                return { error: 'NOT_FOUND' }
            }

            if (org.accessList?.[userId] !== 'owner') {
                return { error: 'PERMISSION_DENIED' }
            }

            // The org row's accessList map names every member whose access-list
            // row must go. Delete the org and all member rows in one transaction.
            const memberIds = Object.keys(org.accessList ?? {})

            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'delete',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                        key: { organizationId }
                    },
                    ...memberIds.map((memberId) => ({
                        type: 'delete' as const,
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                        key: { userId: memberId, organizationId }
                    }))
                ],
                origin: 'deleteOrganization'
            })

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
            const org = await getOrganizationRecord(organizationId)
            if (!org) {
                return { error: 'NOT_FOUND' }
            }

            if (org.accessList?.[addedByUserId] !== 'owner') {
                return { error: 'PERMISSION_DENIED' }
            }

            // Org row accessList map + member's access-list row commit together
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                        key: { organizationId },
                        updates: {
                            [`accessList.${userId}`]: accessLevel,
                            updatedAt: currentDate
                        }
                    },
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                        item: {
                            userId: userId,    // Partition key
                            organizationId,    // Sort key
                            accessLevel,
                            createdAt: currentDate,
                            updatedAt: currentDate
                        }
                    }
                ],
                origin: 'addUserToOrganization'
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
            const org = await getOrganizationRecord(organizationId)
            if (!org) {
                return { error: 'NOT_FOUND' }
            }

            if (org.accessList?.[removedByUserId] !== 'owner' && removedByUserId !== userId) {
                return { error: 'PERMISSION_DENIED' }
            }

            // Org row accessList map + member's access-list row commit together
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
                        key: { organizationId },
                        updates: {
                            [`accessList.${userId}`]: null,
                            updatedAt: currentDate
                        }
                    },
                    {
                        type: 'delete',
                        tableName: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
                        key: { userId: userId, organizationId }
                    }
                ],
                origin: 'removeUserFromOrganization'
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

export default OrganizationModel
