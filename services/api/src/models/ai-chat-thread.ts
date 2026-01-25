'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type AiChatThread,
    type AiChatThreadStatus
} from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE
} = process.env

export default {
    getAiChatThread: async ({
        workspaceId,
        threadId
    }: Pick<AiChatThread, 'workspaceId' | 'threadId'>): Promise<AiChatThread | { error: string }> => {
        const thread = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
            key: { workspaceId, threadId },
            origin: `model::AiChatThread->get(${workspaceId}:${threadId})`
        })

        if (!thread || Object.keys(thread).length === 0) {
            return { error: 'NOT_FOUND' }
        }

        return thread
    },

    getWorkspaceAiChatThreads: async ({
        workspaceId
    }: { workspaceId: string }): Promise<AiChatThread[]> => {
        const threads = await dynamoDBService.queryItems({
            tableName: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
            keyConditions: { workspaceId },
            fetchAllItems: true,
            scanIndexForward: false,
            origin: 'model::AiChatThread->getWorkspaceAiChatThreads()'
        })

        return threads?.items || []
    },

    createAiChatThread: async ({
        workspaceId,
        threadId,
        content,
        aiModel
    }: Pick<AiChatThread, 'workspaceId' | 'threadId' | 'content' | 'aiModel'>): Promise<AiChatThread | undefined> => {
        const currentDate = new Date().getTime()

        const newThread: AiChatThread = {
            workspaceId,
            threadId,
            content,
            aiModel,
            status: 'active',
            createdAt: currentDate,
            updatedAt: currentDate
        }

        try {
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
                item: newThread,
                origin: 'createAiChatThread'
            })

            return newThread
        } catch (error) {
            console.error('Failed to create AI chat thread:', error)
        }
    },

    update: async ({
        workspaceId,
        threadId,
        content,
        aiModel,
        status
    }: Pick<AiChatThread, 'workspaceId' | 'threadId'> & Partial<Pick<AiChatThread, 'content' | 'aiModel' | 'status'>>): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            const updates: Record<string, any> = { updatedAt: currentDate }

            if (content !== undefined) updates.content = content
            if (aiModel !== undefined) updates.aiModel = aiModel
            if (status !== undefined) updates.status = status

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
                key: { workspaceId, threadId },
                updates,
                origin: 'updateAiChatThread'
            })
        } catch (e) {
            console.error(e)
        }
    },

    delete: async ({
        workspaceId,
        threadId
    }: Pick<AiChatThread, 'workspaceId' | 'threadId'>): Promise<{ status: string; threadId: string }> => {
        try {
            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
                key: { workspaceId, threadId },
                origin: 'deleteAiChatThread'
            })

            return { status: 'deleted', threadId }
        } catch (error) {
            throw error
        }
    }
}
