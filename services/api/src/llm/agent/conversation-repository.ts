import { createHash } from 'node:crypto'
import {
    AGENT_DISPATCH_SHARDS,
    getDynamoDbTableStageName,
    type AccountWorkContext,
    type ConversationRun,
    type ConversationSettings,
} from '@lixpi/constants'
import {
    type default as DynamoDBService,
    type TransactOperation,
} from '@lixpi/dynamodb-service'

export type ConversationMeta = {
    protocolVersion: 1
    organizationId: string
    workspaceId: string
    conversationAssetId: string
    ownerUserId: string
    creationHash: string
    title: string
    activated: boolean
    revision: number
    settings: ConversationSettings
    settingsRevision: number
    queueRevision: number
    queuePaused: boolean
    commandSeq: number
    eventSeq: number
    projectedCommandSeq: number
    documentRevision: number
    epoch: number
    leaseOwner?: string
    leaseExpiresAt?: number
    run?: ConversationRun
    checkpointNamespace: string
    createdAt: number
    updatedAt: number
    expiresAt?: number
}

export type ConversationDispatch = {
    jobId: string
    purpose?: 'projection'
    projectionRevision?: number
    organizationId: string
    workspaceId: string
    conversationAssetId: string
    userId: string
    turnId: string
    dueAt: number
    account?: AccountWorkContext
}

type ConversationDatabase = Pick<DynamoDBService, 'getItem' | 'queryItems' | 'transactWrite'>

export const conversationPartition = (
    organizationId: string,
    conversationAssetId: string,
): string => `ORG#${encodeURIComponent(organizationId)}#CONVERSATION#${conversationAssetId}`

export const conversationWorkspacePartition = (
    organizationId: string,
    workspaceId: string,
): string => `ORG#${encodeURIComponent(organizationId)}#WORKSPACE#${workspaceId}`

export const conversationSequenceKey = (sequence: number): string => {
    if (
        !Number.isSafeInteger(sequence)
        || sequence < 0
    )
        throw new Error('INVALID_CONVERSATION_SEQUENCE')

    return String(sequence).padStart(16, '0')
}

export const conversationDuePartition = (conversationAssetId: string): string =>
    `DISPATCH#${createHash('sha256').update(conversationAssetId).digest().readUInt32BE(0) % AGENT_DISPATCH_SHARDS}`

export const conversationDueKey = (job: ConversationDispatch): string => `${conversationSequenceKey(job.dueAt)}#${job.jobId}`

export class ConversationRepository {
    readonly tableName: string

    constructor(
        private readonly database: ConversationDatabase = dynamoDBService,
        tableName = getDynamoDbTableStageName(
            'AGENT_CONVERSATIONS',
            process.env.ORG_NAME!,
            process.env.STAGE!,
        ),
    ) {
        this.tableName = tableName
    }

    async read<T>(
        pk: string,
        sk: string,
    ): Promise<T | undefined> {
        const row = await this.database.getItem({
            tableName: this.tableName,
            key: {
                pk,
                sk,
            },
            consistentRead: true,
            origin: 'Conversation.read',
        })

        return row as T | undefined
    }

    async query<T>(
        pk: string,
        prefix: string,
        options: {
            after?: string
            limit?: number
            descending?: boolean
        } = {},
    ): Promise<{
        items: T[]
        cursor?: string
    }> {
        const result = await this.database.queryItems({
            tableName: this.tableName,
            keyConditions: { pk },
            ...(prefix ? { sortKeyCondition: {
                key: 'sk',
                operator: 'begins_with',
                value: prefix,
            } } : {}),
            ...(options.after ? { exclusiveStartKey: {
                pk,
                sk: options.after,
            } } : {}),
            limit: options.limit ?? 100,
            scanIndexForward: !options.descending,
            consistentRead: true,
            origin: 'Conversation.query',
        })

        return {
            items: (result?.items ?? []) as T[],
            ...(result?.lastEvaluatedKey?.sk ? { cursor: String(result.lastEvaluatedKey.sk) } : {}),
        }
    }

    put(
        pk: string,
        sk: string,
        data: object,
        expectedRevision?: number,
    ): TransactOperation {
        return {
            type: 'put',
            tableName: this.tableName,
            item: {
                ...data,
                pk,
                sk,
            },
            conditionExpression: expectedRevision === undefined ? 'attribute_not_exists(#pk)' : '#revision = :revision',
            expressionAttributeNames: expectedRevision === undefined ? { '#pk': 'pk' } : { '#revision': 'revision' },
            ...(expectedRevision === undefined ? {} : { expressionAttributeValues: { ':revision': expectedRevision } }),
        }
    }

    replace(
        pk: string,
        sk: string,
        data: object,
    ): TransactOperation {
        return {
            type: 'put',
            tableName: this.tableName,
            item: {
                ...data,
                pk,
                sk,
            },
        }
    }

    remove(
        pk: string,
        sk: string,
    ): TransactOperation {
        return {
            type: 'delete',
            tableName: this.tableName,
            key: {
                pk,
                sk,
            },
        }
    }

    ownerFence(
        meta: ConversationMeta,
        now: number,
    ): TransactOperation {
        if (!meta.leaseOwner)
            throw new Error('CONVERSATION_OWNER_REQUIRED')

        return {
            type: 'check',
            tableName: this.tableName,
            key: {
                pk: conversationPartition(meta.organizationId, meta.conversationAssetId),
                sk: 'META',
            },
            conditionExpression: '#epoch = :epoch AND #owner = :owner AND #expires > :now',
            expressionAttributeNames: {
                '#epoch': 'epoch',
                '#owner': 'leaseOwner',
                '#expires': 'leaseExpiresAt',
            },
            expressionAttributeValues: {
                ':epoch': meta.epoch,
                ':owner': meta.leaseOwner,
                ':now': now,
            },
        }
    }

    async commit(operations: TransactOperation[]): Promise<void> {
        await this.database.transactWrite({
            operations,
            logConditionalCheckFailures: false,
            origin: 'Conversation.commit',
        })
    }
}
