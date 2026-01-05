'use strict'

/**
 * DynamoDB Table Definitions for Pulumi Cloud Deployment
 *
 * This file defines all DynamoDB table schemas for AWS cloud infrastructure.
 * It exports getTableDefinitions() for reuse in local development.
 *
 * Why there are two DynamoDB files:
 * - DynamoDB-tables.ts (this file): Pulumi resources for AWS cloud deployment
 * - local-dynamodb-init.ts: AWS SDK script for DynamoDB Local (development)
 *
 * The table definitions are shared via getTableDefinitions() to eliminate duplication.
 * Pulumi-specific logic (streams, deletion protection, tags) stays in createDynamoDbTables().
 */

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import {
    getDynamoDbTableStageName
} from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE,
    ENVIRONMENT,
} = process.env

// Export table definitions for reuse in local init script
export const getTableDefinitions = () => [
    {
        name: getDynamoDbTableStageName('USERS', ORG_NAME, STAGE),
        attributes: [{ name: 'userId', type: 'S' as const }],
        hashKey: 'userId',
    },
    {
        name: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
        attributes: [{ name: 'organizationId', type: 'S' as const }],
        hashKey: 'organizationId',
    },
    {
        name: getDynamoDbTableStageName('ORGANIZATIONS_ACCESS_LIST', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' as const },
            { name: 'organizationId', type: 'S' as const },
            { name: 'createdAt', type: 'N' as const },
        ],
        hashKey: 'userId',
        rangeKey: 'organizationId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
        attributes: [{ name: 'workspaceId', type: 'S' as const }],
        hashKey: 'workspaceId',
    },
    {
        name: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
        attributes: [{ name: 'workspaceId', type: 'S' as const }],
        hashKey: 'workspaceId',
    },
    {
        name: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' as const },
            { name: 'workspaceId', type: 'S' as const },
            { name: 'createdAt', type: 'N' as const },
            { name: 'updatedAt', type: 'N' as const },
        ],
        hashKey: 'userId',
        rangeKey: 'workspaceId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
            { name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
        attributes: [
            { name: 'documentId', type: 'S' as const },
            { name: 'revision', type: 'N' as const },
            { name: 'createdAt', type: 'N' as const },
            { name: 'workspaceId', type: 'S' as const },
        ],
        hashKey: 'documentId',
        rangeKey: 'revision',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
        ],
        globalSecondaryIndexes: [
            { name: 'workspaceId', hashKey: 'workspaceId', projectionType: 'ALL' as const },
        ],
        ttl: { attributeName: 'revisionExpiresAt', enabled: true },
    },
    {
        name: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
        attributes: [{ name: 'documentId', type: 'S' as const }],
        hashKey: 'documentId',
    },
    {
        name: getDynamoDbTableStageName('DOCUMENTS_ACCESS_LIST', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' as const },
            { name: 'documentId', type: 'S' as const },
            { name: 'createdAt', type: 'N' as const },
        ],
        hashKey: 'userId',
        rangeKey: 'documentId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('AI_TOKENS_USAGE_TRANSACTIONS', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' as const },
            { name: 'transactionProcessedAt', type: 'N' as const },
            { name: 'documentId', type: 'S' as const },
            { name: 'aiModel', type: 'S' as const },
            { name: 'organizationId', type: 'S' as const },
            { name: 'transactionProcessedAtFormatted', type: 'S' as const },
        ],
        hashKey: 'userId',
        rangeKey: 'transactionProcessedAt',
        localSecondaryIndexes: [
            { name: 'documentId', rangeKey: 'documentId', projectionType: 'ALL' as const },
            { name: 'aiModel', rangeKey: 'aiModel', projectionType: 'ALL' as const },
            { name: 'organizationId', rangeKey: 'organizationId', projectionType: 'ALL' as const },
            { name: 'transactionProcessedAtFormatted', rangeKey: 'transactionProcessedAtFormatted', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('FINANCIAL_TRANSACTIONS', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' as const },
            { name: 'transactionId', type: 'S' as const },
            { name: 'status', type: 'S' as const },
            { name: 'createdAt', type: 'N' as const },
            { name: 'provider', type: 'S' as const },
        ],
        hashKey: 'userId',
        rangeKey: 'transactionId',
        localSecondaryIndexes: [
            { name: 'status', rangeKey: 'status', projectionType: 'ALL' as const },
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
            { name: 'provider', rangeKey: 'provider', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('AI_TOKENS_USAGE_REPORTS', ORG_NAME, STAGE),
        attributes: [
            { name: 'recordKey', type: 'S' as const },
            { name: 'aiModel', type: 'S' as const },
            { name: 'organizationId', type: 'S' as const },
        ],
        hashKey: 'recordKey',
        rangeKey: 'aiModel',
        localSecondaryIndexes: [
            { name: 'organizationId', rangeKey: 'organizationId', projectionType: 'ALL' as const },
        ],
    },
    {
        name: getDynamoDbTableStageName('AI_MODELS_LIST', ORG_NAME, STAGE),
        attributes: [
            { name: 'provider', type: 'S' as const },
            { name: 'model', type: 'S' as const },
        ],
        hashKey: 'provider',
        rangeKey: 'model',
    },
    {
        name: getDynamoDbTableStageName('AI_CHAT_THREADS', ORG_NAME, STAGE),
        attributes: [
            { name: 'workspaceId', type: 'S' as const },
            { name: 'threadId', type: 'S' as const },
            { name: 'createdAt', type: 'N' as const },
        ],
        hashKey: 'workspaceId',
        rangeKey: 'threadId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' as const },
        ],
    },
]

export const createDynamoDbTables = async (opts?: { provider?: aws.Provider }) => {

    const resourceOpts: pulumi.CustomResourceOptions | undefined = opts?.provider ? { provider: opts.provider } : undefined
    const enableStreams = !opts?.provider
    // Only enable deletion protection for real AWS (no custom local provider) AND production environment
    const enableDeletionProtection = !opts?.provider && ENVIRONMENT === 'production'

    const tableDefs = getTableDefinitions()

    const usersTable = new aws.dynamodb.Table(tableDefs[0].name, {
        ...tableDefs[0],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[0].name },
    }, resourceOpts)

    const organizationsTable = new aws.dynamodb.Table(tableDefs[1].name, {
        ...tableDefs[1],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[1].name },
    }, resourceOpts)

    const organizationsAccessListTable = new aws.dynamodb.Table(tableDefs[2].name, {
        ...tableDefs[2],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[2].name },
    }, resourceOpts)

    const workspacesTable = new aws.dynamodb.Table(tableDefs[3].name, {
        ...tableDefs[3],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[3].name },
    }, resourceOpts)

    const workspacesMetaTable = new aws.dynamodb.Table(tableDefs[4].name, {
        ...tableDefs[4],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[4].name },
    }, resourceOpts)

    const workspacesAccessListTable = new aws.dynamodb.Table(tableDefs[5].name, {
        ...tableDefs[5],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[5].name },
    }, resourceOpts)

    const documentsTable = new aws.dynamodb.Table(tableDefs[6].name, {
        ...tableDefs[6],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[6].name },
    }, resourceOpts)

    const documentsMetaTable = new aws.dynamodb.Table(tableDefs[7].name, {
        ...tableDefs[7],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[7].name },
    }, resourceOpts)

    const documentsAccessListTable = new aws.dynamodb.Table(tableDefs[8].name, {
        ...tableDefs[8],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[8].name },
    }, resourceOpts)

    // Billing ----------------------------------------------------------------------
    const aiTokensUsageTransactionsTable = new aws.dynamodb.Table(tableDefs[9].name, {
        ...tableDefs[9],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        // tableClass: 'STANDARD_INFREQUENT_ACCESS'    // TODO, make sure to set infrequent access for this table when we reach 25GB storage (because the first 25GB is free for standard tables, but not for infrequent access tables)
        tags: { Name: tableDefs[9].name },
    }, resourceOpts)

    const financialTransactionsTable = new aws.dynamodb.Table(tableDefs[10].name, {
        ...tableDefs[10],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[10].name },
    }, resourceOpts)

    const aiTokensUsageReportsTable = new aws.dynamodb.Table(tableDefs[11].name, {
        ...tableDefs[11],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[11].name },
    }, resourceOpts)

    const aiModelsListTable = new aws.dynamodb.Table(tableDefs[12].name, {
        ...tableDefs[12],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[12].name },
    }, resourceOpts)

    const aiChatThreadsTable = new aws.dynamodb.Table(tableDefs[13].name, {
        ...tableDefs[13],
        billingMode: 'PAY_PER_REQUEST',
        ...(enableDeletionProtection && { deletionProtectionEnabled: true }),
        ...(enableStreams && {
            streamEnabled: true as const,
            streamViewType: 'NEW_AND_OLD_IMAGES' as const,
        }),
        tags: { Name: tableDefs[13].name },
    }, resourceOpts)
    // END Billing -------------------------------------------------------------------

    // Create parameter outputs
    const outputs: Record<string, pulumi.Output<string>> = {
        usersTableName: usersTable.name,

        organizationsTableName: organizationsTable.name,
        organizationsAccessListTableName: organizationsAccessListTable.name,

        workspacesTableName: workspacesTable.name,
        workspacesMetaTableName: workspacesMetaTable.name,
        workspacesAccessListTableName: workspacesAccessListTable.name,

        documentsTableName: documentsTable.name,
        documentsMetaTableName: documentsMetaTable.name,
        documentsAccessListTableName: documentsAccessListTable.name,

        aiChatThreadsTableName: aiChatThreadsTable.name,

        aiTokensUsageTransactionsTableName: aiTokensUsageTransactionsTable.name,
        aiTokensUsageReportsTableName: aiTokensUsageReportsTable.name,
        aiModelsListTableName: aiModelsListTable.name,

        financialTransactionsTableName: financialTransactionsTable.name,
    }

    return {
        usersTable,

        organizationsTable,
        organizationsAccessListTable,

        workspacesTable,
        workspacesMetaTable,
        workspacesAccessListTable,

        documentsTable,
        documentsMetaTable,
        documentsAccessListTable,

        aiChatThreadsTable,

        aiTokensUsageTransactionsTable,
        aiTokensUsageReportsTable,
        aiModelsListTable,

        financialTransactionsTable,

        // Optional bindings preserved for consumers; undefined in this module
        stripeBillingHandlerLambda: undefined,
        subscriptionBalanceUpdatesSNSTopic: undefined,

        outputs,
    }
}
