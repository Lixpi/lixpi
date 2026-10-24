import DynamoDBService from '@lixpi/dynamodb-service'
import { AccountRequestContext } from './account-request-context.ts'
import { AccountCommitter } from './account-committer.ts'

// User transactions are fenced centrally so a model cannot accidentally omit
// the admission condition. Background housekeeping has no user execution scope.
export class AccountDatabaseService extends DynamoDBService {
    constructor(
        configuration: ConstructorParameters<typeof DynamoDBService>[0],
        private readonly admissionTable: string,
        private readonly targetPrincipalFields: Readonly<Record<string, 'userId' | 'principalId'>> = {},
        private readonly reconciliationTables: ReadonlySet<string> = new Set(),
    ) {
        super(configuration)
    }

    override async transactWrite(request: Parameters<DynamoDBService['transactWrite']>[0]) {
        const guarded = {
            ...request,
            operations: request.operations.map(operation => this.guardReconciliation(operation)),
        }
        const scope = AccountRequestContext.current()

        if (!scope)
            return await super.transactWrite(guarded)

        const committer = new AccountCommitter(
            {
                transactWrite: async guarded => await super.transactWrite({
                    ...guarded,
                    abortSignal: request.abortSignal
                        ? AbortSignal.any([guarded.abortSignal, request.abortSignal])
                        : guarded.abortSignal,
                }),
            },
            this.admissionTable,
        )

        return await committer.commit(
            scope,
            guarded.operations,
            request.origin ?? 'account-request',
            request.operations.flatMap(operation => {
                const field = this.targetPrincipalFields[operation.tableName]

                if (
                    !field
                    || (operation.type !== 'put' && operation.type !== 'update')
                )
                    return []

                const record = operation.type === 'put' ? operation.item : operation.key
                const subject = record[field]

                if (
                    typeof subject !== 'string'
                    || !subject
                )
                    throw new Error('ACCOUNT_TARGET_REQUIRED')

                return [subject]
            }),
        )
    }

    override async updateItem(request: Parameters<DynamoDBService['updateItem']>[0]) {
        this.requireInternalWrite()

        return await super.updateItem(
            this.guardReconciliation(request),
        )
    }

    override async putItem(request: Parameters<DynamoDBService['putItem']>[0]) {
        this.requireInternalWrite()
        this.requireResourceTransaction(request.tableName)

        return await super.putItem(request)
    }

    override async deleteItems(request: Parameters<DynamoDBService['deleteItems']>[0]) {
        this.requireInternalWrite()
        this.requireResourceTransaction(request.tableName)

        return await super.deleteItems(request)
    }

    override async batchWriteItems(request: Parameters<DynamoDBService['batchWriteItems']>[0]) {
        this.requireInternalWrite()
        this.requireResourceTransaction(request.tableName)

        return await super.batchWriteItems(request)
    }

    override async getItem(request: Parameters<DynamoDBService['getItem']>[0]) {
        const guarded = this.reconciliationTables.has(request.tableName ?? '')
        const item = await super.getItem(guarded ? {
            ...request,
            consistentRead: true,
        } : request)

        if (
            guarded
            && item?.accountReconciliationOperation
        )
            throw new Error('ACCOUNT_RESOURCE_RECONCILING')

        return item
    }

    private guardReconciliation<T extends {
        tableName?: string
        conditionExpression?: string
        expressionAttributeNames?: Record<string, string>
    }>(operation: T): T {
        if (!this.reconciliationTables.has(operation.tableName ?? ''))
            return operation

        let name = '#accountReconciliation'

        while (Object.hasOwn(operation.expressionAttributeNames ?? {}, name))
            name += '_'

        return {
            ...operation,
            conditionExpression: [operation.conditionExpression && `(${operation.conditionExpression})`, `attribute_not_exists(${name})`]
                .filter(Boolean).join(' AND '),
            expressionAttributeNames: {
                ...operation.expressionAttributeNames,
                [name]: 'accountReconciliationOperation',
            },
        }
    }

    private requireResourceTransaction(tableName?: string): void {
        if (this.reconciliationTables.has(tableName ?? ''))
            throw new Error('ACCOUNT_RESOURCE_TRANSACTION_REQUIRED')
    }

    private requireInternalWrite(): void {
        if (AccountRequestContext.current())
            throw new Error('ACCOUNT_SCOPED_TRANSACTION_REQUIRED')
    }
}
