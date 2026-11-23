import { getDynamoDbTableStageName } from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    emptyCanvasRoom,
    type CanvasRoomState,
} from './canvas-collaboration-state.ts'

import { canvasRoomKey } from './workspace-navigation/table-keys.ts'

const roomTable = (): string => getDynamoDbTableStageName(
    'WORKSPACE_TREE',
    process.env.ORG_NAME,
    process.env.STAGE,
)

export const readCanvasRoom = async (workspaceId: string): Promise<CanvasRoomState> => {
    const result = await dynamoDBService.getItem({
        tableName: roomTable(),
        key: canvasRoomKey(workspaceId),
        consistentRead: true,
        origin: 'canvas-collaboration:read',
    })

    const state = result?.state as CanvasRoomState | undefined

    return state ? {
        ...state,
        assetWrites: state.assetWrites ?? {},
        agentPublications: state.agentPublications ?? {},
    } : emptyCanvasRoom()
}

export const writeCanvasRoom = (
    workspaceId: string,
    previousRevision: number,
    state: CanvasRoomState,
): TransactOperation => ({
    type: 'put',
    tableName: roomTable(),
    item: {
        ...canvasRoomKey(workspaceId),
        state,
        revision: state.revision,
    },
    conditionExpression: previousRevision === 0 ? 'attribute_not_exists(#pk)' : '#revision = :previous',
    ...(previousRevision === 0
        ? { expressionAttributeNames: { '#pk': 'pk' } }
        : {
            expressionAttributeNames: { '#revision': 'revision' },
            expressionAttributeValues: { ':previous': previousRevision },
        }),
})

export const activeWorkspaceCondition = (workspaceId: string): TransactOperation => ({
    type: 'check',
    tableName: getDynamoDbTableStageName(
        'WORKSPACES',
        process.env.ORG_NAME,
        process.env.STAGE,
    ),
    key: { workspaceId },
    conditionExpression: 'attribute_exists(#workspaceId) AND attribute_not_exists(#deletingAt)',
    expressionAttributeNames: {
        '#workspaceId': 'workspaceId',
        '#deletingAt': 'deletingAt',
    },
})

export const canvasLeaseCondition = (
    workspaceId: string,
    actorId: string,
    leases: Record<string, string>,
): TransactOperation => {
    const expressionAttributeNames: Record<string, string> = {
        '#state': 'state',
        '#leases': 'leases',
        '#participants': 'participants',
        '#actor': actorId,
        '#leaseId': 'leaseId',
        '#expiresAt': 'expiresAt',
    }
    const expressionAttributeValues: Record<string, unknown> = {
        ':now': Date.now(),
    }
    const conditions = ['#state.#participants.#actor.#expiresAt > :now']

    for (const [index, [target, leaseId]] of Object.entries(leases).entries()) {
        const keyName = `#target${index}`
        const valueName = `:lease${index}`

        expressionAttributeNames[keyName] = target
        expressionAttributeValues[valueName] = leaseId
        conditions.push(`#state.#leases.${keyName}.#leaseId = ${valueName}`)
    }

    return {
        type: 'check',
        tableName: roomTable(),
        key: canvasRoomKey(workspaceId),
        conditionExpression: conditions.join(' AND '),
        expressionAttributeNames,
        expressionAttributeValues,
    }
}
