'use strict'

// Local DynamoDB Table Initialization
//
// This script creates DynamoDB tables for local development using AWS SDK directly.
// It imports table definitions from DynamoDB-tables.ts to avoid duplication.
//
// Why this exists separately from DynamoDB-tables.ts:
// - DynamoDB-tables.ts: Pulumi IaC for AWS cloud deployment (uses Pulumi SDK)
// - local-dynamodb-init.ts: Direct AWS SDK calls for DynamoDB Local (no Pulumi)
//
// For local dev, we bypass Pulumi and use AWS SDK CreateTableCommand directly because:
// 1. Pulumi's table waiters are incompatible with DynamoDB Local
// 2. Faster startup - no Pulumi state management overhead
// 3. Simpler Docker integration - just run this script on container start

import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { getTableDefinitions } from './resources/db/DynamoDB-tables.ts'

const { DYNAMODB_ENDPOINT } = process.env

if (!DYNAMODB_ENDPOINT) {
    console.error('DYNAMODB_ENDPOINT is required')
    process.exit(1)
}

const client = new DynamoDBClient({
    endpoint: DYNAMODB_ENDPOINT,
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
    },
})

async function tableExists(tableName: string): Promise<boolean> {
    try {
        await client.send(new DescribeTableCommand({ TableName: tableName }))
        return true
    } catch (error: unknown) {
        if ((error as { name?: string }).name === 'ResourceNotFoundException') {
            return false
        }
        throw error
    }
}

async function createTables() {
    const tableDefs = getTableDefinitions()

    console.log(`Creating DynamoDB tables in ${DYNAMODB_ENDPOINT}...`)
    console.log(`Stage: ${process.env.STAGE}, Org: ${process.env.ORG_NAME}`)

    for (const table of tableDefs) {
        if (await tableExists(table.name)) {
            console.log(`  ✓ ${table.name} (already exists)`)
            continue
        }

        try {
            await client.send(new CreateTableCommand({
                TableName: table.name,
                KeySchema: [
                    { AttributeName: table.hashKey, KeyType: 'HASH' },
                    ...(table.rangeKey ? [{ AttributeName: table.rangeKey, KeyType: 'RANGE' as const }] : []),
                ],
                AttributeDefinitions: table.attributes.map(attr => ({
                    AttributeName: attr.name,
                    AttributeType: attr.type,
                })),
                BillingMode: 'PAY_PER_REQUEST',
                ...(table.localSecondaryIndexes && {
                    LocalSecondaryIndexes: table.localSecondaryIndexes.map(lsi => ({
                        IndexName: lsi.name,
                        KeySchema: [
                            { AttributeName: table.hashKey, KeyType: 'HASH' as const },
                            { AttributeName: lsi.rangeKey, KeyType: 'RANGE' as const },
                        ],
                        Projection: { ProjectionType: lsi.projectionType },
                    })),
                }),
            }))
            console.log(`  ✓ ${table.name} (created)`)
        } catch (error: unknown) {
            console.error(`  ✗ ${table.name}: ${(error as Error).message}`)
        }
    }

    console.log('Done!')
}

createTables().catch((e) => {
    console.error('Failed to create tables:', e)
    process.exit(1)
})
