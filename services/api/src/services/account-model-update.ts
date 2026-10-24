import {
    type default as DynamoDBService,
} from '@lixpi/dynamodb-service'
import { AccountRequestContext } from './account-request-context.ts'

// User mutations use a transaction so the API database adapter can attach the
// admission condition. Internal lease cleanup retains its ordinary update path.
export const updateAccountItem = async (request: Parameters<DynamoDBService['updateItem']>[0]): Promise<void> => {
    const scope = AccountRequestContext.current()

    if (!scope) {
        await dynamoDBService.updateItem(request)

        return
    }

    scope.assertActive()

    if (
        !request.tableName
        || !request.key
        || Object.keys(request.key).length === 0
    )
        throw new Error('ACCOUNT_SCOPED_UPDATE_REQUIRES_KEY')

    const {
        origin,
        logConditionalCheckFailures,
        ...operation
    } = request
    await dynamoDBService.transactWrite({
        operations: [{
            type: 'update',
            ...operation,
            tableName: request.tableName,
            key: request.key,
        }],
        origin,
        logConditionalCheckFailures,
        abortSignal: scope.signal,
    })
    scope.assertActive()
}
