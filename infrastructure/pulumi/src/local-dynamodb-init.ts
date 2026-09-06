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
// Existing tables are force-recreated from the current definitions by default so
// the persisted dynamodb-data volume can never serve a stale schema; see
// local-dynamodb-table-reconciler.ts for the prompt, the
// LOCAL_DYNAMODB_FORCE_RECREATE override, and the data-loss reporting.

import {
    err as debugError,
    log as debugLog,
} from '@lixpi/debug-tools'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { getTableDefinitions } from './resources/db/DynamoDB-tables.ts'
import {
    LocalDynamoDbTableReconciler,
    resolveForceRecreate,
    type TableDefinition,
} from './local-dynamodb-table-reconciler.ts'

const { DYNAMODB_ENDPOINT } = process.env

if (!DYNAMODB_ENDPOINT) {
    debugError('DYNAMODB_ENDPOINT is required')
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

const createTables = async () => {
    const tableDefs = Object.values(
        getTableDefinitions(),
    ) as TableDefinition[]
    const forceRecreate = await resolveForceRecreate()
    const reconciler = new LocalDynamoDbTableReconciler(client, forceRecreate)

    debugLog(`Creating DynamoDB tables in ${DYNAMODB_ENDPOINT}...`)
    debugLog(`Stage: ${process.env.STAGE}, Org: ${process.env.ORG_NAME}`)
    debugLog(`Force-recreate existing tables: ${forceRecreate}`)

    for (const table of tableDefs) {
        await reconciler.ensureTable(table)
    }

    debugLog('Done!')
}

try {
    await createTables()
} catch (e) {
    debugError('Failed to create tables:', e)
    process.exit(1)
}
