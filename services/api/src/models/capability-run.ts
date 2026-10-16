import * as process from 'node:process'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import {
    getDynamoDbTableStageName,
    type CapabilityRun,
    type CapabilityRunStatus,
} from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE,
} = process.env
const capabilityRunsTableName = (): string => getDynamoDbTableStageName(
    'CAPABILITY_RUNS',
    ORG_NAME,
    STAGE,
)

export type StoredCapabilityRun = CapabilityRun & {
    ownerUserId: string
}

export const createCapabilityRun = async (run: StoredCapabilityRun): Promise<StoredCapabilityRun> => {
    await dynamoDBService.transactWrite({
        operations: [{
            type: 'put',
            tableName: capabilityRunsTableName(),
            item: run,
            conditionExpression: 'attribute_not_exists(#runId)',
            expressionAttributeNames: { '#runId': 'runId' },
        }],
        origin: 'CapabilityRun.create',
    })

    return run
}

export const getAuthorizedCapabilityRun = async ({
    runId,
    workspaceId,
    userId,
}: {
    runId: string
    workspaceId: string
    userId: string
}): Promise<StoredCapabilityRun | { error: 'NOT_FOUND' | 'PERMISSION_DENIED' }> => {
    const run = (await dynamoDBService.getItem({
        tableName: capabilityRunsTableName(),
        key: {
            runId,
            workspaceId,
        },
        consistentRead: true,
        origin: 'CapabilityRun.getAuthorized',
    })) as StoredCapabilityRun | undefined

    if (!run)
        return { error: 'NOT_FOUND' }

    if (run.ownerUserId !== userId)
        return { error: 'PERMISSION_DENIED' }

    return run
}

export const updateCapabilityRunStatus = async ({
    runId,
    workspaceId,
    expectedStatuses,
    status,
    currentStepIds,
    outputAssetIds,
}: {
    runId: string
    workspaceId: string
    expectedStatuses: CapabilityRunStatus[]
    status: CapabilityRunStatus
    currentStepIds?: string[]
    outputAssetIds?: string[]
}): Promise<void> => {
    if (expectedStatuses.length === 0)
        throw new Error('EXPECTED_RUN_STATUS_REQUIRED')

    const statusValues = Object.fromEntries(
        expectedStatuses.map((value, index) => [`:expectedStatus${index}`, value]),
    )
    await updateAccountItem({
        tableName: capabilityRunsTableName(),
        key: {
            runId,
            workspaceId,
        },
        updates: {
            status,
            updatedAt: Date.now(),
            ...(currentStepIds ? { currentStepIds } : {}),
            ...(outputAssetIds ? { outputAssetIds } : {}),
        },
        conditionExpression: `#status IN (${expectedStatuses.map((_, index) => `:expectedStatus${index}`).join(', ')})`,
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: statusValues,
        origin: 'CapabilityRun.updateStatus',
    })
}

const CapabilityRunModel = {
    create: createCapabilityRun,
    getAuthorized: getAuthorizedCapabilityRun,
    updateStatus: updateCapabilityRunStatus,
}

export const cancelCapabilityRun = async (args: {
    runId: string
    workspaceId: string
    ownerUserId: string
}): Promise<boolean> => {
    try {
        await updateAccountItem({
            tableName: capabilityRunsTableName(),
            key: {
                runId: args.runId,
                workspaceId: args.workspaceId,
            },
            updates: {
                status: 'cancelled',
                currentStepIds: [],
                updatedAt: Date.now(),
            },
            conditionExpression: '#owner = :owner AND #status IN (:pending, :running, :cancelled)',
            expressionAttributeNames: {
                '#owner': 'ownerUserId',
                '#status': 'status',
            },
            expressionAttributeValues: {
                ':owner': args.ownerUserId,
                ':pending': 'pending',
                ':running': 'running',
                ':cancelled': 'cancelled',
            },
            logConditionalCheckFailures: false,
            origin: 'CapabilityRun.cancel',
        })

        return true
    } catch (error) {
        if (isTransactionConditionalCheckFailure(error))
            return false

        throw error
    }
}

export default CapabilityRunModel
import { updateAccountItem } from '../services/account-model-update.ts'
