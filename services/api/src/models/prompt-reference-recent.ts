'use strict'

import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    type PromptReference,
    type PromptReferenceRecent,
    type PromptReferenceType,
} from '@lixpi/constants'

const { ORG_NAME, STAGE } = process.env
const recentsTableName = (): string => getDynamoDbTableStageName('PROMPT_REFERENCE_RECENTS', ORG_NAME, STAGE)
const MAX_RECENTS_PER_USER = 100

export function getPromptReferenceId(reference: PromptReference): string {
    if (reference.referenceType === 'media') return reference.assetId
    if (reference.referenceType === 'capability-module') return reference.moduleId
    return reference.capabilityId
}

export function buildPromptReferenceKey(referenceType: PromptReferenceType, referenceId: string): string {
    return `${referenceType}#${referenceId}`
}

const PromptReferenceRecentModel = {
    recordAccepted: async ({
        userId,
        references,
        now = Date.now(),
    }: {
        userId: string
        references: PromptReference[]
        now?: number
    }): Promise<void> => {
        const byKey = new Map<string, PromptReferenceRecent>()
        for (const [index, reference] of references.entries()) {
            const referenceId = getPromptReferenceId(reference)
            const referenceKey = buildPromptReferenceKey(reference.referenceType, referenceId)
            byKey.set(referenceKey, {
                userId,
                referenceKey,
                referenceType: reference.referenceType,
                referenceId,
                updatedAt: now + index,
            })
        }
        const rows = [...byKey.values()].slice(-MAX_RECENTS_PER_USER)
        if (rows.length > 0) {
            await dynamoDBService.transactWrite({
                operations: rows.map((item) => ({ type: 'put' as const, tableName: recentsTableName(), item })),
                origin: 'PromptReferenceRecent.recordAccepted',
            })
        }

        const result = await dynamoDBService.queryItems({
            tableName: recentsTableName(),
            indexName: 'updatedAt',
            keyConditions: { userId },
            limit: 1000,
            fetchAllItems: true,
            scanIndexForward: false,
            consistentRead: true,
            origin: 'PromptReferenceRecent.trim',
        })
        const overflow = ((result?.items ?? []) as PromptReferenceRecent[]).slice(MAX_RECENTS_PER_USER)
        for (let index = 0; index < overflow.length; index += 100) {
            const batch = overflow.slice(index, index + 100)
            await dynamoDBService.transactWrite({
                operations: batch.map((item) => ({
                    type: 'delete' as const,
                    tableName: recentsTableName(),
                    key: { userId, referenceKey: item.referenceKey },
                })),
                origin: 'PromptReferenceRecent.trimOverflow',
            })
        }
    },

    list: async ({
        userId,
        referenceTypes,
        limit = 5,
    }: {
        userId: string
        referenceTypes: PromptReferenceType[]
        limit?: number
    }): Promise<PromptReferenceRecent[]> => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_PROMPT_REFERENCE_RECENT_LIMIT')
        const result = await dynamoDBService.queryItems({
            tableName: recentsTableName(),
            indexName: 'updatedAt',
            keyConditions: { userId },
            limit: MAX_RECENTS_PER_USER,
            scanIndexForward: false,
            consistentRead: true,
            origin: 'PromptReferenceRecent.list',
        })
        const allowedTypes = new Set(referenceTypes)
        return ((result?.items ?? []) as PromptReferenceRecent[])
            .filter((item) => allowedTypes.has(item.referenceType))
            .slice(0, limit)
    },

    remove: async ({ userId, referenceKeys }: { userId: string; referenceKeys: string[] }): Promise<void> => {
        if (referenceKeys.length === 0) return
        await dynamoDBService.transactWrite({
            operations: [...new Set(referenceKeys)].map((referenceKey) => ({
                type: 'delete' as const,
                tableName: recentsTableName(),
                key: { userId, referenceKey },
            })),
            origin: 'PromptReferenceRecent.remove',
        })
    },
}

export default PromptReferenceRecentModel
