'use strict'

import * as process from 'process'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

import { formatStageResourceName, getDynamoDbTableStageName } from '@lixpi/constants'

const { ORG_NAME, STAGE, ENVIRONMENT } = process.env

type TableAttribute = { name: string; type: 'S' | 'N' | 'B' }
type SecondaryIndex = { name: string; rangeKey: string; projectionType: 'ALL' }
type TableDefinition = {
    name: string
    attributes: TableAttribute[]
    hashKey: string
    rangeKey?: string
    localSecondaryIndexes?: SecondaryIndex[]
}

type LegacyStorageRemovalStage = 'retain' | 'disable-protection' | 'remove'

const table = (
    resource: Parameters<typeof getDynamoDbTableStageName>[0],
    attributes: TableAttribute[],
    hashKey: string,
    rangeKey?: string,
    localSecondaryIndexes?: SecondaryIndex[],
): TableDefinition => ({
    name: getDynamoDbTableStageName(resource, ORG_NAME, STAGE),
    attributes,
    hashKey,
    ...(rangeKey ? { rangeKey } : {}),
    ...(localSecondaryIndexes ? { localSecondaryIndexes } : {}),
})

export const getTableDefinitions = () => ({
    usersTable: table('USERS', [{ name: 'userId', type: 'S' }], 'userId'),
    organizationsTable: table('ORGANIZATIONS', [{ name: 'organizationId', type: 'S' }], 'organizationId'),
    organizationsAccessListTable: table(
        'ORGANIZATIONS_ACCESS_LIST',
        [
            { name: 'userId', type: 'S' },
            { name: 'organizationId', type: 'S' },
            { name: 'createdAt', type: 'N' },
        ],
        'userId',
        'organizationId',
        [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' },
        ],
    ),
    workspacesTable: table('WORKSPACES', [{ name: 'workspaceId', type: 'S' }], 'workspaceId'),
    workspacesMetaTable: table('WORKSPACES_META', [{ name: 'workspaceId', type: 'S' }], 'workspaceId'),
    workspacesAccessListTable: table(
        'WORKSPACES_ACCESS_LIST',
        [
            { name: 'userId', type: 'S' },
            { name: 'workspaceId', type: 'S' },
            { name: 'createdAt', type: 'N' },
            { name: 'updatedAt', type: 'N' },
        ],
        'userId',
        'workspaceId',
        [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' },
            { name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' },
        ],
    ),
    aiTokensUsageTransactionsTable: table(
        'AI_TOKENS_USAGE_TRANSACTIONS',
        [
            { name: 'userId', type: 'S' },
            { name: 'transactionProcessedAt', type: 'N' },
            { name: 'documentId', type: 'S' },
            { name: 'aiModel', type: 'S' },
            { name: 'organizationId', type: 'S' },
            { name: 'transactionProcessedAtFormatted', type: 'S' },
        ],
        'userId',
        'transactionProcessedAt',
        [
            { name: 'documentId', rangeKey: 'documentId', projectionType: 'ALL' },
            { name: 'aiModel', rangeKey: 'aiModel', projectionType: 'ALL' },
            { name: 'organizationId', rangeKey: 'organizationId', projectionType: 'ALL' },
            { name: 'transactionProcessedAtFormatted', rangeKey: 'transactionProcessedAtFormatted', projectionType: 'ALL' },
        ],
    ),
    financialTransactionsTable: table(
        'FINANCIAL_TRANSACTIONS',
        [
            { name: 'userId', type: 'S' },
            { name: 'transactionId', type: 'S' },
            { name: 'status', type: 'S' },
            { name: 'createdAt', type: 'N' },
            { name: 'provider', type: 'S' },
        ],
        'userId',
        'transactionId',
        [
            { name: 'status', rangeKey: 'status', projectionType: 'ALL' },
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' },
            { name: 'provider', rangeKey: 'provider', projectionType: 'ALL' },
        ],
    ),
    aiTokensUsageReportsTable: table(
        'AI_TOKENS_USAGE_REPORTS',
        [
            { name: 'recordKey', type: 'S' },
            { name: 'aiModel', type: 'S' },
            { name: 'organizationId', type: 'S' },
        ],
        'recordKey',
        'aiModel',
        [{ name: 'organizationId', rangeKey: 'organizationId', projectionType: 'ALL' }],
    ),
    aiModelsListTable: table(
        'AI_MODELS_LIST',
        [{ name: 'provider', type: 'S' }, { name: 'model', type: 'S' }],
        'provider',
        'model',
    ),
    capabilitiesTable: table('CAPABILITIES', [{ name: 'capabilityId', type: 'S' }], 'capabilityId'),
    capabilitiesMetaTable: table(
        'CAPABILITIES_META',
        [{ name: 'scopeAndOwner', type: 'S' }, { name: 'searchKey', type: 'S' }],
        'scopeAndOwner',
        'searchKey',
    ),
    capabilitiesAccessListTable: table(
        'CAPABILITIES_ACCESS_LIST',
        [{ name: 'capabilityId', type: 'S' }, { name: 'principalId', type: 'S' }],
        'capabilityId',
        'principalId',
    ),
    capabilityRunsTable: table(
        'CAPABILITY_RUNS',
        [{ name: 'runId', type: 'S' }, { name: 'workspaceId', type: 'S' }],
        'runId',
        'workspaceId',
    ),
    mediaGenerationRequestsTable: table(
        'MEDIA_GENERATION_REQUESTS',
        [{ name: 'generationRequestId', type: 'S' }, { name: 'workspaceId', type: 'S' }],
        'generationRequestId',
        'workspaceId',
    ),
    mediaGenerationRequestsMetaTable: table(
        'MEDIA_GENERATION_REQUESTS_META',
        [
            { name: 'workspaceId', type: 'S' },
            { name: 'generationRequestId', type: 'S' },
            { name: 'updatedAt', type: 'N' },
            { name: 'statusUpdatedAt', type: 'N' },
        ],
        'workspaceId',
        'generationRequestId',
        [
            { name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' },
            { name: 'statusUpdatedAt', rangeKey: 'statusUpdatedAt', projectionType: 'ALL' },
        ],
    ),
    mediaGenerationRequestsAccessListTable: table(
        'MEDIA_GENERATION_REQUESTS_ACCESS_LIST',
        [{ name: 'generationRequestId', type: 'S' }, { name: 'principalId', type: 'S' }],
        'generationRequestId',
        'principalId',
    ),
    assetsTable: table('ASSETS', [{ name: 'assetId', type: 'S' }], 'assetId'),
    assetsMetaTable: table(
        'ASSETS_META',
        [
            { name: 'scopeAndOwner', type: 'S' },
            { name: 'assetId', type: 'S' },
            { name: 'updatedAt', type: 'N' },
        ],
        'scopeAndOwner',
        'assetId',
        [{ name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' }],
    ),
    assetsSearchTable: table(
        'ASSETS_SEARCH',
        [{ name: 'scopeAndOwner', type: 'S' }, { name: 'searchKey', type: 'S' }],
        'scopeAndOwner',
        'searchKey',
    ),
    assetsAccessListTable: table(
        'ASSETS_ACCESS_LIST',
        [{ name: 'assetId', type: 'S' }, { name: 'principalId', type: 'S' }],
        'assetId',
        'principalId',
    ),
    assetReferencesTable: table(
        'ASSET_REFERENCES',
        [{ name: 'assetId', type: 'S' }, { name: 'referenceKey', type: 'S' }],
        'assetId',
        'referenceKey',
    ),
    assetSubjectIdentityAttestationsTable: table(
        'ASSET_SUBJECT_IDENTITY_ATTESTATIONS',
        [{ name: 'assetId', type: 'S' }, { name: 'attestationId', type: 'S' }],
        'assetId',
        'attestationId',
    ),
    promptReferenceRecentsTable: table(
        'PROMPT_REFERENCE_RECENTS',
        [
            { name: 'userId', type: 'S' },
            { name: 'referenceKey', type: 'S' },
            { name: 'updatedAt', type: 'N' },
        ],
        'userId',
        'referenceKey',
        [{ name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' }],
    ),
    blobsTable: table('BLOBS', [{ name: 'blobKey', type: 'S' }], 'blobKey'),
    blobReferencesTable: table(
        'BLOB_REFERENCES',
        [{ name: 'blobKey', type: 'S' }, { name: 'referenceKey', type: 'S' }],
        'blobKey',
        'referenceKey',
    ),
})

const getLegacyStorageDefinitions = (): Record<string, TableDefinition> => ({
    legacyDocumentsTable: {
        name: formatStageResourceName('Documents', ORG_NAME, STAGE),
        attributes: [
            { name: 'workspaceId', type: 'S' },
            { name: 'documentId', type: 'S' },
            { name: 'createdAt', type: 'N' },
        ],
        hashKey: 'workspaceId',
        rangeKey: 'documentId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' },
        ],
    },
    legacyDocumentsMetaTable: {
        name: formatStageResourceName('Documents-Meta', ORG_NAME, STAGE),
        attributes: [{ name: 'documentId', type: 'S' }],
        hashKey: 'documentId',
    },
    legacyDocumentsAccessListTable: {
        name: formatStageResourceName('Documents-Access-List', ORG_NAME, STAGE),
        attributes: [
            { name: 'userId', type: 'S' },
            { name: 'documentId', type: 'S' },
            { name: 'createdAt', type: 'N' },
        ],
        hashKey: 'userId',
        rangeKey: 'documentId',
        localSecondaryIndexes: [
            { name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' },
            { name: 'updatedAt', rangeKey: 'createdAt', projectionType: 'ALL' },
        ],
    },
    legacyAiChatThreadsTable: {
        name: formatStageResourceName('AI-Chat-Threads', ORG_NAME, STAGE),
        attributes: [
            { name: 'workspaceId', type: 'S' },
            { name: 'threadId', type: 'S' },
            { name: 'createdAt', type: 'N' },
        ],
        hashKey: 'workspaceId',
        rangeKey: 'threadId',
        localSecondaryIndexes: [{ name: 'createdAt', rangeKey: 'createdAt', projectionType: 'ALL' }],
    },
    legacyMediaLibraryItemsTable: {
        name: formatStageResourceName('Media-Library-Items', ORG_NAME, STAGE),
        attributes: [{ name: 'itemId', type: 'S' }, { name: 'version', type: 'N' }],
        hashKey: 'itemId',
        rangeKey: 'version',
    },
    legacyMediaLibraryItemsMetaTable: {
        name: formatStageResourceName('Media-Library-Items-Meta', ORG_NAME, STAGE),
        attributes: [{ name: 'scopeAndOwner', type: 'S' }, { name: 'itemId', type: 'S' }],
        hashKey: 'scopeAndOwner',
        rangeKey: 'itemId',
    },
    legacyMediaLibraryItemsAccessListTable: {
        name: formatStageResourceName('Media-Library-Items-Access-List', ORG_NAME, STAGE),
        attributes: [
            { name: 'principalId', type: 'S' },
            { name: 'itemId', type: 'S' },
            { name: 'updatedAt', type: 'N' },
        ],
        hashKey: 'principalId',
        rangeKey: 'itemId',
        localSecondaryIndexes: [{ name: 'updatedAt', rangeKey: 'updatedAt', projectionType: 'ALL' }],
    },
})

export const createDynamoDbTables = async (opts?: { provider?: aws.Provider }) => {
    const resourceOpts: pulumi.CustomResourceOptions | undefined = opts?.provider ? { provider: opts.provider } : undefined
    const enableStreams = !opts?.provider
    const enableDeletionProtection = !opts?.provider && ENVIRONMENT === 'production'
    const legacyStorageRemovalStage = (process.env.LEGACY_STORAGE_REMOVAL_STAGE ?? 'remove') as LegacyStorageRemovalStage
    if (!['retain', 'disable-protection', 'remove'].includes(legacyStorageRemovalStage)) {
        throw new Error(`Invalid LEGACY_STORAGE_REMOVAL_STAGE: ${legacyStorageRemovalStage}`)
    }
    const definitions = getTableDefinitions()

    const create = (definition: TableDefinition): aws.dynamodb.Table => new aws.dynamodb.Table(
        definition.name,
        {
            ...definition,
            billingMode: 'PAY_PER_REQUEST',
            ...(enableDeletionProtection ? { deletionProtectionEnabled: true } : {}),
            ...(enableStreams ? {
                streamEnabled: true,
                streamViewType: 'NEW_AND_OLD_IMAGES',
            } : {}),
            tags: { Name: definition.name },
        } as aws.dynamodb.TableArgs,
        resourceOpts,
    )

    const tables = Object.fromEntries(
        Object.entries(definitions).map(([logicalName, definition]) => [logicalName, create(definition)]),
    ) as { [K in keyof typeof definitions]: aws.dynamodb.Table }

    // Production tables created by the pre-Asset model have deletion protection.
    // Phase 11's completed default omits retired resources. On a protected
    // production stack, deploy once with `disable-protection` so Pulumi updates
    // those existing URNs in place, then deploy with `remove` (or unset) to
    // delete them. Use `retain` only to hold a pre-removal stack deliberately.
    // Local stacks never recreate these inert resources.
    const legacyTables = !opts?.provider && legacyStorageRemovalStage !== 'remove'
        ? Object.fromEntries(Object.entries(getLegacyStorageDefinitions()).map(([logicalName, definition]) => [
            logicalName,
            new aws.dynamodb.Table(definition.name, {
                ...definition,
                billingMode: 'PAY_PER_REQUEST',
                deletionProtectionEnabled: enableDeletionProtection && legacyStorageRemovalStage === 'retain',
                streamEnabled: true,
                streamViewType: 'NEW_AND_OLD_IMAGES',
                tags: { Name: definition.name },
            } as aws.dynamodb.TableArgs),
        ])) as Record<string, aws.dynamodb.Table>
        : {}

    const allTables = { ...tables, ...legacyTables }

    const outputs = Object.fromEntries(
        Object.entries(allTables).map(([logicalName, resource]) => [
            `${logicalName.replace(/Table$/, '')}TableName`,
            resource.name,
        ]),
    ) as Record<string, pulumi.Output<string>>

    return { ...allTables, outputs }
}
