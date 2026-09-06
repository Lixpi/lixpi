import {
    info as debugInfo,
    err as debugError,
    warn as debugWarn,
} from '@lixpi/debug-tools'
import chalk from 'chalk'

import { fromSSO } from '@aws-sdk/credential-providers'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    ScanCommand,
    BatchGetCommand,
    PutCommand,
    UpdateCommand,
    BatchWriteCommand,
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'

// Export all methods from '@aws-sdk/util-dynamodb' module, specifically marshall and unmarshall methods that are used to read DynamoDB streams
export * from '@aws-sdk/util-dynamodb'

const toCapacityUnits = cc => {
    if (!cc)
        return 0

    if (Array.isArray(cc))
        return cc.reduce((s, c) => s + (c?.CapacityUnits ?? 0), 0)

    return cc?.CapacityUnits ?? 0
}

export type SortKeyCondition =
    | {
        key: string
        operator: 'begins_with'
        value: string
    }
    | {
        key: string
        operator: '=' | '<' | '<=' | '>' | '>='
        value: unknown
    }
    | {
        key: string
        operator: 'between'
        lower: unknown
        upper: unknown
    }

const prepareSortKeyCondition = (condition: SortKeyCondition) => {
    const keyName = '#sortKey'

    if (condition.operator === 'begins_with') {
        return {
            expression: `begins_with(${keyName}, :sortKeyValue)`,
            expressionAttributeNames: { [keyName]: condition.key },
            expressionAttributeValues: { ':sortKeyValue': condition.value },
        }
    }

    if (condition.operator === 'between') {
        return {
            expression: `${keyName} BETWEEN :sortKeyLower AND :sortKeyUpper`,
            expressionAttributeNames: { [keyName]: condition.key },
            expressionAttributeValues: {
                ':sortKeyLower': condition.lower,
                ':sortKeyUpper': condition.upper,
            },
        }
    }

    return {
        expression: `${keyName} ${condition.operator} :sortKeyValue`,
        expressionAttributeNames: { [keyName]: condition.key },
        expressionAttributeValues: { ':sortKeyValue': condition.value },
    }
}

// One operation inside a transaction — same shapes the models pass to
// putItem / updateItem / deleteItems, discriminated by `type`. Soft deletes
// are expressed as a 'update' setting the TTL attribute.
export type TransactOperation =
    | {
        type: 'put'
        tableName: string
        item: Record<string, unknown>
        conditionExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
    }
    | {
        type: 'update'
        tableName: string
        key: Record<string, unknown>
        updates?: Record<string, unknown>
        updateExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
        conditionExpression?: string
    }
    | {
        type: 'delete'
        tableName: string
        key: Record<string, unknown>
        conditionExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
    }

// A transaction is cancelled as a whole; a failed per-item condition surfaces
// as TransactionCanceledException with a ConditionalCheckFailed reason instead
// of ConditionalCheckFailedException. Models use this to keep their existing
// optimistic-concurrency retry paths.
export const isTransactionConditionalCheckFailure = (error: unknown): boolean => {
    const candidate = error as {
        name?: string
        CancellationReasons?: Array<{ Code?: string }>
    }

    return candidate?.name === 'ConditionalCheckFailedException'
        || candidate?.name === 'TransactionCanceledException'
            && (candidate.CancellationReasons ?? []).some(reason => reason?.Code === 'ConditionalCheckFailed')
}

const logStats = ({
    operation,
    operationType,
    capacityUnits,
    tableName,
    origin,
}) => {
    let logColor = ''

    if (capacityUnits < 3)
        logColor = 'green'
    else if (capacityUnits < 5)
        logColor = 'yellow'
    else if (capacityUnits >= 5)
        logColor = 'red'

    const operationDirection = operationType === 'read' ? '<-' : '->'
    const logOrigin = chalk.white(`DynamoDB ${operationDirection}`)
    const dynamoDbOperation = `${chalk.white(operation)}`
    const capaticyUnitsInfo = chalk[logColor](`capacityUnits: ${capacityUnits}`)

    debugInfo(`${logOrigin} ${dynamoDbOperation} ${tableName}, ${capaticyUnitsInfo}, ${chalk.grey('origin:')}${origin}`)
}

export default class DynamoDBService {
    private dynamodbClient: DynamoDBClient
    private dynamodbDocumentClient: DynamoDBDocumentClient

    constructor({
        region = '',
        ssoProfile = '',
        endpoint = '',
    }: {
        region?: string
        ssoProfile?: string
        endpoint?: string
    }) {
        if (region === '')
            throw new Error('AWS region must be provided.')

        this.dynamodbClient = new DynamoDBClient({
            region,
            ...((ssoProfile !== '' && !endpoint) && {
                credentials: fromSSO({ profile: ssoProfile }),
            }),
            // point to DynamoDB Local when provided
            ...(endpoint && {
                endpoint,
                credentials: {
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                }, // For Local, supply dummy static credentials. For AWS, use SSO when provided.
            }),
        })

        this.dynamodbDocumentClient = DynamoDBDocumentClient.from(this.dynamodbClient)
    }

    prepareAttributes(
        attributes,
        delimiter = ', ',
    ) {
        const expression = Object.keys(attributes).map(key => `#${key} = :${key}`)
            .join(delimiter)
        const expressionAttributeValues = Object.keys(attributes).reduce(
            (acc, key) => ({
                ...acc,
                [`:${key}`]: attributes[key],
            }),
            {},
        )
        const expressionAttributeNames = Object.keys(attributes).reduce(
            (acc, key) => ({
                ...acc,
                [`#${key}`]: key,
            }),
            {},
        )

        return {
            expression,
            expressionAttributeValues,
            expressionAttributeNames,
        }
    }

    async getItem({
        tableName = '',
        key = {},
        consistentRead = false,
        origin = 'unknown',
    }) {
        if (
            !tableName
            || Object.keys(key).length === 0
        ) {
            debugError(`Error: Table name and key must be provided!, origin: ${origin}`)

            return
        }

        try {
            const response = await this.dynamodbDocumentClient.send(
                new GetCommand({
                    TableName: tableName,
                    Key: key,
                    ConsistentRead: consistentRead,
                    ReturnConsumedCapacity: 'TOTAL',
                }),
            )

            logStats({
                operation: 'getItem',
                operationType: 'read',
                capacityUnits: toCapacityUnits(response.ConsumedCapacity),
                tableName,
                origin,
            })

            return response.Item
        } catch (error) {
            debugError(`Error fetching record from DynamoDB ${tableName} table:`, error)
        }
    }

    async queryItems({
        tableName = '',
        indexName = '',
        keyConditions = {},
        limit = 1,
        fetchAllItems = false,
        scanIndexForward = true,
        consistentRead = false,
        exclusiveStartKey = undefined,
        origin = 'unknown',
        sortKeyCondition = undefined,
    }: {
        tableName?: string
        indexName?: string
        keyConditions?: Record<string, unknown>
        limit?: number
        fetchAllItems?: boolean
        scanIndexForward?: boolean
        consistentRead?: boolean
        exclusiveStartKey?: Record<string, unknown>
        origin?: string
        sortKeyCondition?: SortKeyCondition
    }) {
        if (Object.keys(keyConditions).length === 0) {
            debugError('Key conditions must be provided.')

            return
        }

        const preparedKeys = this.prepareAttributes(keyConditions, ' AND ')
        const preparedSortKey = sortKeyCondition ? prepareSortKeyCondition(sortKeyCondition) : undefined
        const keyConditionExpression = [preparedKeys.expression, preparedSortKey?.expression].filter(Boolean).join(' AND ')
        const expressionAttributeValues = {
            ...preparedKeys.expressionAttributeValues,
            ...preparedSortKey?.expressionAttributeValues,
        }
        const expressionAttributeNames = {
            ...preparedKeys.expressionAttributeNames,
            ...preparedSortKey?.expressionAttributeNames,
        }

        const params: any = {
            TableName: tableName,
            ...(indexName && { IndexName: indexName }),
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            Limit: limit,
            ScanIndexForward: scanIndexForward,
            ConsistentRead: consistentRead,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
            ReturnConsumedCapacity: 'TOTAL',
        }

        let items: any[] = []
        const consumedCapacities: any[] = []
        let lastEvaluatedKey = null
        let readIterations = 0

        do {
            if (lastEvaluatedKey)
                params.ExclusiveStartKey = lastEvaluatedKey

            const response = await this.dynamodbDocumentClient.send(
                new QueryCommand(params),
            )

            items.push(...(response.Items ?? []))

            if (response.ConsumedCapacity)
                consumedCapacities.push(response.ConsumedCapacity)

            lastEvaluatedKey = response.LastEvaluatedKey
            readIterations++

            if (!fetchAllItems)
                break
        } while (lastEvaluatedKey)

        logStats({
            operation: 'queryItems',
            operationType: 'read',
            capacityUnits: toCapacityUnits(consumedCapacities),
            tableName,
            origin,
        })

        return {
            items,
            consumedCapacities,
            readIterations,
            lastEvaluatedKey,
        }
    }

    async scanItems({
        tableName = '',
        limit = 1000,
        fetchAllItems = false,
        consistentRead = false,
        exclusiveStartKey,
        origin = 'unknown',
    }) {
        if (!tableName) {
            debugError(`Error: Table name must be provided!, origin: ${origin}`)

            return
        }

        const params: any = {
            TableName: tableName,
            Limit: limit,
            ConsistentRead: consistentRead,
            ReturnConsumedCapacity: 'TOTAL',
        }

        if (exclusiveStartKey)
            params.ExclusiveStartKey = exclusiveStartKey

        let items: any[] = []
        const consumedCapacities: any[] = []
        let lastEvaluatedKey: any = exclusiveStartKey ?? null
        let scanIterations = 0

        do {
            if (lastEvaluatedKey)
                params.ExclusiveStartKey = lastEvaluatedKey

            const response = await this.dynamodbDocumentClient.send(
                new ScanCommand(params),
            )

            items.push(...(response.Items ?? []))

            if (response.ConsumedCapacity)
                consumedCapacities.push(response.ConsumedCapacity)

            lastEvaluatedKey = response.LastEvaluatedKey
            scanIterations++

            if (!fetchAllItems)
                break
        } while (lastEvaluatedKey)

        logStats({
            operation: 'scanItems',
            operationType: 'read',
            capacityUnits: toCapacityUnits(consumedCapacities),
            tableName,
            origin,
        })

        return {
            items,
            consumedCapacities,
            scanIterations,
            ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}),
        }
    }

    async batchReadItems({
        queries = [],
        readBatchSize = 100,
        fetchAllItems = false,
        scanIndexForward = false,
        origin = 'unknown',
    }: {
        queries?: any[]
        readBatchSize?: number
        fetchAllItems?: boolean
        scanIndexForward?: boolean
        origin?: string
    }) {
        if (queries.length === 0)
            return new Error('Queries array must be provided and not be empty.')

        let items = {}
        const consumedCapacities: any[] = []
        let readIterations = 0
        let lastEvaluatedKey: any = null

        do {
            const params = {
                RequestItems: {},
                ReturnConsumedCapacity: 'TOTAL',
            }

            // Prepare batch keys for each table query
            for (const query of queries) {
                const batchKeys = query.keys.slice(readIterations * readBatchSize, (readIterations + 1) * readBatchSize)

                if (batchKeys.length > 0)
                    params.RequestItems[query.tableName] = { Keys: batchKeys }
            }

            try {
                const response = await this.dynamodbDocumentClient.send(
                    new BatchGetCommand(params),
                )

                // Collect responses for each table
                for (const tableName of Object.keys(response.Responses)) {
                    items[tableName] = items[tableName] || []
                    items[tableName].push(...response.Responses[tableName])
                }

                if (
                    response.ConsumedCapacity
                    && response.ConsumedCapacity.length > 0
                )
                    consumedCapacities.push(...response.ConsumedCapacity)

                readIterations++
                lastEvaluatedKey = response.UnprocessedKeys ? response.UnprocessedKeys : null

                if (!fetchAllItems)
                    break
            } catch (error) {
                debugError(`Error fetching records from DynamoDB:`, error)
            }
        } while (
            lastEvaluatedKey
            && Object.keys(lastEvaluatedKey).some(tableName => lastEvaluatedKey[tableName].Keys.length > 0)
            && fetchAllItems
        )

        const totalCapacityUnits = toCapacityUnits(consumedCapacities)
        logStats({
            operation: 'batchReadItems',
            operationType: 'read',
            capacityUnits: totalCapacityUnits,
            tableName: JSON.stringify(
                queries.map(q => q.tableName),
            ),
            origin,
        })

        // If scanIndexForward is false, reverse the order of the items for each table
        if (!scanIndexForward) {
            for (const tableName of Object.keys(items)) {
                items[tableName].reverse()
            }
        }

        return {
            items,
            consumedCapacities,
            readIterations,
        }
    }

    async batchWriteItems({
        tableName = '',
        items = [],
        origin = 'unknown',
    }) {
        if (
            !tableName
            || items.length === 0
        ) {
            debugError(`Error: Table name and at least one item must be provided!, origin: ${origin}`)

            return
        }

        const batchSize = 25 // DynamoDB's limit for batch write operations
        const batches: any[] = []

        // Split items into batches of 25
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(
                items.slice(i, i + batchSize),
            )
        }

        const consumedCapacities: any[] = []
        let totalItemsWritten = 0

        for (const batch of batches) {
            const params = {
                RequestItems: {
                    [tableName]: batch.map(
                        item => ({
                            PutRequest: { Item: item },
                        }),
                    ),
                },
                ReturnConsumedCapacity: 'TOTAL',
            }

            try {
                const response = await this.dynamodbDocumentClient.send(
                    new BatchWriteCommand(params),
                )

                if (response.ConsumedCapacity)
                    consumedCapacities.push(...response.ConsumedCapacity)

                totalItemsWritten += batch.length

                // Handle unprocessed items
                if (
                    response.UnprocessedItems
                    && Object.keys(response.UnprocessedItems).length > 0
                ) {
                    debugWarn(`Some items were not processed. Retrying...`)
                    const unprocessedItems = response.UnprocessedItems[tableName].map(item => item.PutRequest.Item)
                    await this.batchWriteItems({
                        tableName,
                        items: unprocessedItems,
                        origin,
                    })
                }
            } catch (error) {
                debugError(`Error in batch write operation:`, error)

                throw error
            }
        }

        const totalCapacityUnits = toCapacityUnits(consumedCapacities)

        logStats({
            operation: 'batchWriteItems',
            operationType: 'write',
            capacityUnits: totalCapacityUnits,
            tableName,
            origin,
        })

        return {
            totalItemsWritten,
            consumedCapacities,
        }
    }

    async putItem({
        tableName = '',
        item = {},
        origin = 'unknown',
    }) {
        try {
            const response = await this.dynamodbDocumentClient.send(
                new PutCommand({
                    TableName: tableName,
                    Item: item,
                    ReturnConsumedCapacity: 'TOTAL',
                }),
            )

            logStats({
                operation: 'putItem',
                operationType: 'write',
                capacityUnits: response.ConsumedCapacity.CapacityUnits,
                tableName,
                origin,
            })

            return response
        } catch (error) {
            debugError(`Error inserting record to DynamoDB ${tableName} table:`, error)
        }
    }

    async updateItem({
        tableName = '',
        key = {},
        updates = {}, // Preferred way to update items
        updateExpression = '', // Use this if you need to provide a custom update expression
        expressionAttributeNames = {}, // Use this if you need to provide custom attribute names
        expressionAttributeValues = {}, // Use this if you need to provide custom attribute values
        conditionExpression = '',
        logConditionalCheckFailures = true,
        origin = 'unknown',
    }) {
        if (
            !tableName
            || Object.keys(key).length === 0
        ) {
            debugError(`Error: Table name and key must be provided!, origin: ${origin}`)

            return
        }

        let params: any = {
            TableName: tableName,
            Key: key,
            ReturnValues: 'UPDATED_NEW',
            ReturnConsumedCapacity: 'TOTAL',
        }

        // Use the simple update method if 'updates' is provided
        if (Object.keys(updates).length > 0) {
            const prepared = this.prepareAttributes(updates)
            params.UpdateExpression = `SET ${prepared.expression}`
            params.ExpressionAttributeValues = {
                ...prepared.expressionAttributeValues,
                ...expressionAttributeValues,
            }
            params.ExpressionAttributeNames = {
                ...prepared.expressionAttributeNames,
                ...expressionAttributeNames,
            }
        } else if (updateExpression) {
            // TODO: make this work via this.prepareAttributes() method, I couldn't figure out why it wasn't working !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            params.UpdateExpression = updateExpression
            params.ExpressionAttributeNames = expressionAttributeNames
            params.ExpressionAttributeValues = expressionAttributeValues
        } else {
            debugError("Either 'updates' or 'updateExpression' must be provided.")

            return
        }

        if (conditionExpression)
            params.ConditionExpression = conditionExpression

        try {
            const response = await this.dynamodbDocumentClient.send(
                new UpdateCommand(params),
            )

            logStats({
                operation: 'updateItem',
                operationType: 'write',
                capacityUnits: response.ConsumedCapacity.CapacityUnits,
                tableName,
                origin,
            })

            return response.Attributes
        } catch (error) {
            if (
                logConditionalCheckFailures
                || (error as { name?: string })?.name !== 'ConditionalCheckFailedException'
            )
                debugError('Error updating item:', error)

            throw error
        }
    }

    // One atomic multi-table write. Operations mirror the argument shapes of
    // putItem / updateItem / deleteItems; the raw SDK TransactItems are built
    // internally so models never touch SDK shapes. Throws on cancellation —
    // when it throws, nothing was applied.
    async transactWrite({
        operations,
        logConditionalCheckFailures = true,
        origin = 'unknown',
    }: {
        operations: TransactOperation[]
        logConditionalCheckFailures?: boolean
        origin?: string
    }) {
        if (
            !operations
            || operations.length === 0
        )
            throw new Error(`DynamoDB transactWrite: at least one operation must be provided, origin: ${origin}`)

        if (operations.length > 100)
            throw new Error(`DynamoDB transactWrite: at most 100 operations are allowed, received ${operations.length}, origin: ${origin}`)

        const transactItems = operations.map(operation => {
            if (operation.type === 'put') {
                return {
                    Put: {
                        TableName: operation.tableName,
                        Item: operation.item,
                        ...(operation.conditionExpression && { ConditionExpression: operation.conditionExpression }),
                        ...(operation.expressionAttributeNames && { ExpressionAttributeNames: operation.expressionAttributeNames }),
                        ...(operation.expressionAttributeValues && { ExpressionAttributeValues: operation.expressionAttributeValues }),
                    },
                }
            }

            if (operation.type === 'delete') {
                return {
                    Delete: {
                        TableName: operation.tableName,
                        Key: operation.key,
                        ...(operation.conditionExpression && { ConditionExpression: operation.conditionExpression }),
                        ...(operation.expressionAttributeNames && { ExpressionAttributeNames: operation.expressionAttributeNames }),
                        ...(operation.expressionAttributeValues && { ExpressionAttributeValues: operation.expressionAttributeValues }),
                    },
                }
            }

            // 'update' — same expression building rules as updateItem: simple
            // `updates` map preferred, custom expression as the escape hatch.
            let updateExpression = operation.updateExpression ?? ''
            let expressionAttributeNames = operation.expressionAttributeNames ?? {}
            let expressionAttributeValues = operation.expressionAttributeValues ?? {}

            if (
                operation.updates
                && Object.keys(operation.updates).length > 0
            ) {
                const prepared = this.prepareAttributes(operation.updates)
                updateExpression = `SET ${prepared.expression}`
                expressionAttributeNames = {
                    ...prepared.expressionAttributeNames,
                    ...expressionAttributeNames,
                }
                expressionAttributeValues = {
                    ...prepared.expressionAttributeValues,
                    ...expressionAttributeValues,
                }
            }

            if (!updateExpression) {
                throw new Error(
                    `DynamoDB transactWrite: update operation for ${operation.tableName} needs 'updates' or 'updateExpression', origin: ${origin}`,
                )
            }

            return {
                Update: {
                    TableName: operation.tableName,
                    Key: operation.key,
                    UpdateExpression: updateExpression,
                    ...(Object.keys(expressionAttributeNames).length > 0 && { ExpressionAttributeNames: expressionAttributeNames }),
                    ...(Object.keys(expressionAttributeValues).length > 0 && { ExpressionAttributeValues: expressionAttributeValues }),
                    ...(operation.conditionExpression && { ConditionExpression: operation.conditionExpression }),
                },
            }
        })

        try {
            const response = await this.dynamodbDocumentClient.send(
                new TransactWriteCommand({
                    TransactItems: transactItems,
                    ReturnConsumedCapacity: 'TOTAL',
                }),
            )

            logStats({
                operation: 'transactWrite',
                operationType: 'write',
                capacityUnits: toCapacityUnits(response.ConsumedCapacity),
                tableName: operations.map(operation => operation.tableName).join(','),
                origin,
            })

            return response
        } catch (error) {
            if (
                logConditionalCheckFailures
                || !isTransactionConditionalCheckFailure(error)
            )
                debugError('Error completing DynamoDB transaction:', error)

            throw error
        }
    }

    async deleteItems({
        tableName = '',
        key = {},
        deleteRange = false,
        origin = 'unknown',
    }) {
        if (Object.keys(key).length === 0) {
            debugError('Key must be provided for delete operation')

            return
        }

        let itemsToDelete: any[] = []

        if (deleteRange) {
            debugInfo(
                chalk.grey(`DynamoDB -> deleteItems() :: deleteRange operation started. Fetching items to delete from ${tableName} table.`),
            )

            const readResult = await this.queryItems({
                tableName,
                keyConditions: key,
                limit: 25,
                fetchAllItems: true,
                origin: 'deleteItems() :: deleteRange operation',
            })

            if (
                readResult
                && readResult.items
            )
                itemsToDelete = readResult.items
            else
                itemsToDelete = [key]
        } else {
            // When not deleting a range, treat the provided key as the exact item to delete
            itemsToDelete = [key]
        }

        const deleteRequests = itemsToDelete.map(
            item => ({
                DeleteRequest: { Key: item },
            }),
        )

        const deleteChunks: any[] = []

        for (let i = 0; i < deleteRequests.length; i += 25) {
            deleteChunks.push(
                deleteRequests.slice(i, i + 25),
            )
        }

        const consumedCapacities: any[] = []

        for (const chunk of deleteChunks) {
            const response = await this.dynamodbDocumentClient.send(
                new BatchWriteCommand({
                    RequestItems: { [tableName]: chunk },
                    ReturnConsumedCapacity: 'TOTAL',
                }),
            )

            if (response.ConsumedCapacity)
                consumedCapacities.push(...response.ConsumedCapacity)
        }

        logStats({
            operation: 'deleteItems',
            operationType: 'write',
            capacityUnits: toCapacityUnits(consumedCapacities),
            tableName,
            origin,
        })

        return consumedCapacities
    }

    async softDeleteItem({
        tableName = '',
        key = {},
        timeToLiveAttributeName = '',
        timeToLiveAttributeValue = null,
        origin = '',
    }) {
        if (
            Object.keys(key).length === 0
            || !timeToLiveAttributeName
            || timeToLiveAttributeValue === null
        ) {
            debugError('Key, time-to-live attribute name, and value must be provided.')

            return
        }

        const updates = {
            [timeToLiveAttributeName]: timeToLiveAttributeValue,
        }

        try {
            const updateResult = await this.updateItem({
                tableName,
                key,
                updates,
                origin: `softDeleteItem:${origin}`,
            })

            return updateResult
        } catch (error) {
            debugError(`Error performing soft delete on DynamoDB ${tableName} table:`, error)

            throw error
        }
    }
}
