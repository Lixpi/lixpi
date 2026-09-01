import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    type CapabilityRun,
    type CapabilityRunStatus,
} from '@lixpi/constants'

const { ORG_NAME, STAGE } = process.env
const capabilityRunsTableName = (): string => getDynamoDbTableStageName('CAPABILITY_RUNS', ORG_NAME, STAGE)

export type StoredCapabilityRun = CapabilityRun & {
    ownerUserId: string
}

export async function createCapabilityRun(run: StoredCapabilityRun): Promise<StoredCapabilityRun> {
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

export async function getAuthorizedCapabilityRun({
    runId,
    workspaceId,
    userId,
}: {
    runId: string
    workspaceId: string
    userId: string
}): Promise<StoredCapabilityRun | { error: 'NOT_FOUND' | 'PERMISSION_DENIED' }> {
    const run = await dynamoDBService.getItem({
        tableName: capabilityRunsTableName(),
        key: { runId, workspaceId },
        consistentRead: true,
        origin: 'CapabilityRun.getAuthorized',
    }) as StoredCapabilityRun | undefined
    if (!run) return { error: 'NOT_FOUND' }
    if (run.ownerUserId !== userId) return { error: 'PERMISSION_DENIED' }
    return run
}

export async function updateCapabilityRunStatus({
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
}): Promise<void> {
    if (expectedStatuses.length === 0) throw new Error('EXPECTED_RUN_STATUS_REQUIRED')
    const statusValues = Object.fromEntries(expectedStatuses.map((value, index) => [`:expectedStatus${index}`, value]))
    await dynamoDBService.updateItem({
        tableName: capabilityRunsTableName(),
        key: { runId, workspaceId },
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

export default CapabilityRunModel
