'use strict'

import * as process from 'process'
import { getDynamoDbTableStageName, type User } from '@lixpi/constants'
import type { Partial } from 'type-fest'

const {
    ORG_NAME,
    STAGE
} = process.env

export default {
    get: async (userId: string): Promise<User | undefined> => {
        return await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
            key: { userId },
            origin: `model::User->get( ${userId} )`
        })
    },

    create: async (user: Partial<User>): Promise<User | undefined> => {
        const newUserData = {
            userId: user.userId,    // Partition key
            stripeCustomerId: user.stripeCustomerId,    // Sort key
            email: user.email,
            name: user.name,
            givenName: user.givenName,
            familyName: user.familyName,
            avatar: user.avatar,
            createdAt: new Date().getTime(),
        }

        try {
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
                item: newUserData,
                origin: 'model::User->create()'
            })

            return newUserData
        } catch (e) {
            console.error('Error creating user:', e)
        }
    },

    update: async ({
        userId,
        email,
        name,
        given_name,
        family_name,
        avatar,
        projects_accessList,
        organizations
    }: Partial<User> & {
        userId: string
    }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
                key: { userId },
                updates: {
                    ...(email && { email }),
                    ...(name && { name }),
                    ...(given_name && { given_name }),
                    ...(family_name && { family_name }),
                    ...(avatar && { avatar }),
                    ...(projects_accessList && { projects_accessList }),
                    ...(organizations && { organizations }),
                    updatedAt: currentDate
                },
                origin: 'model::User->update()'
            })
        } catch (e) {
            console.error('Error updating user:', e)
        }
    },

    addRecentTag: async ({
        userId,
        tagId
    }: Pick<User, 'userId'> & { tagId: string }): Promise<any> => {
        try {
            const currentDate = new Date().getTime();

            // Fetch the current recentTags
            const user = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
                key: { userId },
                origin: 'model::User->addRecentTag()'
            });

            // Prepare the new recentTags list
            let currentTags = user?.recentTags || [];

            // Remove the tag if it already exists, as we'll prepend it
            currentTags = currentTags.filter((id: string) => id !== tagId);

            // Prepend the new tagId and trim the list to maximum 10 items
            const updatedTags = [tagId, ...currentTags].slice(0, 10);

            const result = await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
                key: { userId },
                updateExpression: `SET
                    #recentTags = :updatedTags,
                    #updatedAt = :updatedAt
                `,
                expressionAttributeNames: {
                    '#recentTags': 'recentTags',
                    '#updatedAt': 'updatedAt'
                },
                expressionAttributeValues: {
                    ':updatedTags': updatedTags,
                    ':updatedAt': currentDate
                },
                origin: 'model::User->addRecentTag()'
            });

            return result;
        } catch (error) {
            console.error('Error adding recent tag:', error);
            throw error;
        }
    },
}
