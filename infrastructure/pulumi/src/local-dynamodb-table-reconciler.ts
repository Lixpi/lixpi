// Reconciles DynamoDB Local tables against the definitions in
// resources/db/DynamoDB-tables.ts. Local data persists on the dynamodb-data
// volume across restarts, so a table created before a schema change keeps its
// old key layout and breaks queries written against the new one. Instead of
// diffing schemas, the operator decides once per run whether existing tables
// are force-recreated from the current definitions (the default), and every
// recreation reports the table's item count so it is explicit what data is
// being deleted. Local data is disposable by design.

import {
    log as debugLog,
    err as debugError,
} from '@lixpi/debug-tools'
import readline from 'node:readline/promises'

import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    type CreateTableCommandInput,
    type DynamoDBClient,
    type TableDescription,
} from '@aws-sdk/client-dynamodb'

export type TableDefinition = {
    name: string
    attributes: Array<{
        name: string
        type: 'S' | 'N' | 'B'
    }>
    hashKey: string
    rangeKey?: string
    localSecondaryIndexes?: Array<{
        name: string
        rangeKey: string
        projectionType: 'ALL'
    }>
}

// Resolves whether existing tables get force-recreated this run:
// 1. LOCAL_DYNAMODB_FORCE_RECREATE=true|false wins (containers, CI);
// 2. an interactive terminal is asked, defaulting to yes;
// 3. no terminal (docker compose) falls back to the default: recreate.
export const resolveForceRecreate = async (): Promise<boolean> => {
    const env = process.env.LOCAL_DYNAMODB_FORCE_RECREATE

    if (env === 'true')
        return true

    if (env === 'false')
        return false

    if (!process.stdin.isTTY)
        return true

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    try {
        const answer = await rl.question('Force-recreate existing local DynamoDB tables? Existing local data will be deleted. [Y/n] ')

        return !/^n/i.test(
            answer.trim(),
        )
    } finally {
        rl.close()
    }
}

export class LocalDynamoDbTableReconciler {
    constructor(
        private readonly client: DynamoDBClient,
        private readonly forceRecreate: boolean,
    ) {}

    // Creates a missing table, or (when force-recreate is on) replaces an
    // existing one with the current definition, logging how many items die.
    async ensureTable(table: TableDefinition): Promise<void> {
        const live = await this.describeTable(table.name)

        if (live) {
            if (!this.forceRecreate) {
                debugLog(`  ✓ ${table.name} (exists — kept as is)`)

                return
            }

            const itemCount = live.ItemCount ?? 0
            const dataLossNote = itemCount > 0 ? `${itemCount} items will be deleted` : 'empty — no data lost'
            debugLog(`  ↻ ${table.name} (recreating; ${dataLossNote})`)
            await this.deleteTableAndWait(table.name)
        }

        try {
            await this.client.send(
                new CreateTableCommand(
                    this.buildCreateTableInput(table),
                ),
            )
            debugLog(`  ✓ ${table.name} (created)`)
        } catch (error: unknown) {
            debugError(`  ✗ ${table.name}: ${(error as Error).message}`)
        }
    }

    private buildCreateTableInput(table: TableDefinition): CreateTableCommandInput {
        return {
            TableName: table.name,
            KeySchema: [
                {
                    AttributeName: table.hashKey,
                    KeyType: 'HASH',
                },
                ...(table.rangeKey ? [{
                    AttributeName: table.rangeKey,
                    KeyType: 'RANGE' as const,
                }] : []),
            ],
            AttributeDefinitions: table.attributes.map(
                attr => ({
                    AttributeName: attr.name,
                    AttributeType: attr.type,
                }),
            ),
            BillingMode: 'PAY_PER_REQUEST',
            ...(table.localSecondaryIndexes && {
                LocalSecondaryIndexes: table.localSecondaryIndexes.map(
                    lsi => ({
                        IndexName: lsi.name,
                        KeySchema: [
                            {
                                AttributeName: table.hashKey,
                                KeyType: 'HASH' as const,
                            },
                            {
                                AttributeName: lsi.rangeKey,
                                KeyType: 'RANGE' as const,
                            },
                        ],
                        Projection: { ProjectionType: lsi.projectionType },
                    }),
                ),
            }),
        }
    }

    private async describeTable(tableName: string): Promise<TableDescription | null> {
        try {
            const response = await this.client.send(
                new DescribeTableCommand({ TableName: tableName }),
            )

            return response.Table ?? null
        } catch (error: unknown) {
            if ((error as { name?: string }).name === 'ResourceNotFoundException')
                return null

            throw error
        }
    }

    private async deleteTableAndWait(tableName: string): Promise<void> {
        await this.client.send(
            new DeleteTableCommand({ TableName: tableName }),
        )

        // DynamoDB Local removes tables quickly, but poll so the follow-up
        // CreateTable never races a still-present table.
        for (let attempt = 0; attempt < 30; attempt++) {
            if (!(await this.describeTable(tableName)))
                return

            await new Promise(resolve => setTimeout(resolve, 200))
        }

        throw new Error(`Timed out waiting for ${tableName} to be deleted`)
    }
}
