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
//
// DynamoDB Local persists to the dynamodb-data volume across restarts. A table
// created before a schema change (e.g. LIX-301 moved Documents' hash key from
// documentId to workspaceId and dropped GSIs) keeps its old key schema forever
// unless we reconcile it — a plain "skip if the table exists" check would leave
// the stale schema in place and break queries written against the new schema
// (ValidationException: Query condition missed key schema element). We therefore
// compare each existing table's key layout against the definition and recreate it
// on drift. Local data is disposable, so dropping a drifted table is safe.

import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    DeleteTableCommand,
    type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb'
import { getTableDefinitions } from './resources/db/DynamoDB-tables.ts'

const { DYNAMODB_ENDPOINT } = process.env

if (!DYNAMODB_ENDPOINT) {
    console.error('DYNAMODB_ENDPOINT is required')
    process.exit(1)
}

type TableAttr = { name: string; type: 'S' | 'N' | 'B' }
type LocalIndexDef = { name: string; rangeKey: string; projectionType: string }
type GlobalIndexDef = { name: string; hashKey: string; rangeKey?: string; projectionType: string }
type TableDef = {
    name: string
    attributes: TableAttr[]
    hashKey: string
    rangeKey?: string
    localSecondaryIndexes?: LocalIndexDef[]
    globalSecondaryIndexes?: GlobalIndexDef[]
}

type LiveKeyElement = { AttributeName?: string; KeyType?: string }
type LiveIndex = { IndexName?: string; KeySchema?: LiveKeyElement[] }
type LiveTable = {
    KeySchema?: LiveKeyElement[]
    LocalSecondaryIndexes?: LiveIndex[]
    GlobalSecondaryIndexes?: LiveIndex[]
}

const client = new DynamoDBClient({
    endpoint: DYNAMODB_ENDPOINT,
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
    },
})

const buildCreateTableInput = (table: TableDef): CreateTableCommandInput => ({
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
            Projection: { ProjectionType: lsi.projectionType as 'ALL' },
        })),
    }),
    ...(table.globalSecondaryIndexes && {
        GlobalSecondaryIndexes: table.globalSecondaryIndexes.map(gsi => ({
            IndexName: gsi.name,
            KeySchema: [
                { AttributeName: gsi.hashKey, KeyType: 'HASH' as const },
                ...(gsi.rangeKey ? [{ AttributeName: gsi.rangeKey, KeyType: 'RANGE' as const }] : []),
            ],
            Projection: { ProjectionType: gsi.projectionType as 'ALL' },
        })),
    }),
})

// Normalized fingerprint of a table's key layout (base key schema + secondary
// index keys), used to compare the definition against an already-created table.
const definitionSchemaSignature = (table: TableDef): string => {
    const base = [
        `${table.hashKey}:HASH`,
        ...(table.rangeKey ? [`${table.rangeKey}:RANGE`] : []),
    ].join(',')
    const lsi = (table.localSecondaryIndexes ?? [])
        .map(index => `${index.name}[${table.hashKey}:HASH,${index.rangeKey}:RANGE]`)
        .sort()
        .join(',')
    const gsi = (table.globalSecondaryIndexes ?? [])
        .map(index => `${index.name}[${index.hashKey}:HASH${index.rangeKey ? `,${index.rangeKey}:RANGE` : ''}]`)
        .sort()
        .join(',')
    return `base=(${base}) lsi=(${lsi}) gsi=(${gsi})`
}

const keySchemaToString = (keySchema: LiveKeyElement[] | undefined): string =>
    (keySchema ?? []).map(element => `${element.AttributeName}:${element.KeyType}`).join(',')

const liveSchemaSignature = (live: LiveTable): string => {
    const base = keySchemaToString(live.KeySchema)
    const lsi = (live.LocalSecondaryIndexes ?? [])
        .map(index => `${index.IndexName}[${keySchemaToString(index.KeySchema)}]`)
        .sort()
        .join(',')
    const gsi = (live.GlobalSecondaryIndexes ?? [])
        .map(index => `${index.IndexName}[${keySchemaToString(index.KeySchema)}]`)
        .sort()
        .join(',')
    return `base=(${base}) lsi=(${lsi}) gsi=(${gsi})`
}

const describeTable = async (tableName: string): Promise<LiveTable | null> => {
    try {
        const response = await client.send(new DescribeTableCommand({ TableName: tableName }))
        return (response.Table ?? null) as LiveTable | null
    } catch (error: unknown) {
        if ((error as { name?: string }).name === 'ResourceNotFoundException') {
            return null
        }
        throw error
    }
}

const deleteTableAndWait = async (tableName: string): Promise<void> => {
    await client.send(new DeleteTableCommand({ TableName: tableName }))

    // DynamoDB Local removes the table quickly, but poll so the follow-up
    // CreateTable never races a still-present table.
    for (let attempt = 0; attempt < 30; attempt++) {
        if (!(await describeTable(tableName))) {
            return
        }
        await new Promise(resolve => setTimeout(resolve, 200))
    }

    throw new Error(`Timed out waiting for ${tableName} to be deleted`)
}

async function createTables() {
    const tableDefs = Object.values(getTableDefinitions()) as TableDef[]

    console.log(`Creating DynamoDB tables in ${DYNAMODB_ENDPOINT}...`)
    console.log(`Stage: ${process.env.STAGE}, Org: ${process.env.ORG_NAME}`)

    for (const table of tableDefs) {
        const live = await describeTable(table.name)

        if (live) {
            const expected = definitionSchemaSignature(table)
            const actual = liveSchemaSignature(live)

            if (expected === actual) {
                console.log(`  ✓ ${table.name} (already exists)`)
                continue
            }

            // Schema drift: this local table predates a definition change. Recreate
            // it so local dev matches the current schema instead of failing queries.
            console.log(`  ↻ ${table.name} (schema drift — recreating)`)
            console.log(`      expected ${expected}`)
            console.log(`      found    ${actual}`)
            await deleteTableAndWait(table.name)
        }

        try {
            await client.send(new CreateTableCommand(buildCreateTableInput(table)))
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
