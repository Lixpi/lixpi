import { AsyncLocalStorage } from 'node:async_hooks'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'

export const isCanvasTransactionConflict = (error: unknown): boolean => {
    const failure = error as
        | {
            name?: string
            CancellationReasons?: { Code?: string }[]
        }
        | undefined

    return failure?.name === 'TransactionConflictException'
        || (failure?.name === 'TransactionCanceledException'
            && failure.CancellationReasons?.some(reason => reason.Code === 'TransactionConflict') === true)
}

const referencesSameItem = (
    operation: TransactOperation,
    check: Extract<TransactOperation, { type: 'check' }>,
): boolean => {
    if (operation.tableName !== check.tableName)
        return false

    const item = operation.type === 'put' ? operation.item : operation.key

    return Object.entries(check.key).every(([name, value]) => item[name] === value)
}

// DynamoDB accepts one operation per item. Put a fence on a graph update
// itself when that update also touches the workspace metadata being fenced.
export const appendCanvasTransactionFences = (
    operations: TransactOperation[],
    fences: TransactOperation[],
): TransactOperation[] => {
    const combined = [...operations]

    for (const [index, fence] of fences.entries()) {
        const position = fence.type === 'check'
            ? combined.findIndex(operation => referencesSameItem(operation, fence))
            : -1

        if (
            fence.type !== 'check'
            || position < 0
        ) {
            combined.push(fence)

            continue
        }

        const operation = combined[position]!
        const renamed = (token: string): string => `${token[0]}canvasFence${index}_${token.slice(1)}`
        const expression = fence.conditionExpression.replace(/[#:][A-Za-z0-9_]+/g, renamed)
        const names = Object.fromEntries(
            Object.entries(fence.expressionAttributeNames ?? {}).map(([token, value]) => [renamed(token), value]),
        )
        const values = Object.fromEntries(
            Object.entries(fence.expressionAttributeValues ?? {}).map(([token, value]) => [renamed(token), value]),
        )

        combined[position] = {
            ...operation,
            conditionExpression: operation.conditionExpression ? `(${operation.conditionExpression}) AND (${expression})` : expression,
            expressionAttributeNames: {
                ...operation.expressionAttributeNames,
                ...names,
            },
            expressionAttributeValues: {
                ...operation.expressionAttributeValues,
                ...values,
            },
        }
    }

    return combined
}

type WorkspaceCanvasWrite = {
    workspaceId: string
    canvasRevision: number
}

export const canvasLeaseTransaction = new AsyncLocalStorage<() => Promise<TransactOperation[]>>()

let workspaceCanvasObserver: ((write: WorkspaceCanvasWrite) => Promise<void>) | undefined

export const observeWorkspaceCanvasWrites = (observer: typeof workspaceCanvasObserver): void => void (workspaceCanvasObserver = observer)

export const notifyWorkspaceCanvasWrites = (
    operations: TransactOperation[],
    workspacesTable: string,
): void => {
    const observer = workspaceCanvasObserver

    if (!observer)
        return

    for (const operation of operations) {
        if (
            operation.tableName !== workspacesTable
            || operation.type !== 'update'
            || typeof operation.key.workspaceId !== 'string'
        )
            continue

        const canvasRevision = operation.updates?.canvasStateUpdatedAt ?? operation.expressionAttributeValues?.[':canvasStateUpdatedAt']

        if (typeof canvasRevision === 'number')
            void observer({
                workspaceId: operation.key.workspaceId,
                canvasRevision,
            })
    }
}
