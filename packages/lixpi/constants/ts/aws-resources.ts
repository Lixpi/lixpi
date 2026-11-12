export const DYNAMODB_TABLES: Record<string, string> = {
    USERS: 'Users',
    ACCOUNT_ADMISSION: 'Account-Admission',
    ORGANIZATIONS: 'Organizations',
    ORGANIZATIONS_ACCESS_LIST: 'Organizations-Access-List',
    WORKSPACES: 'Workspaces',
    WORKSPACES_META: 'Workspaces-Meta',
    WORKSPACES_ACCESS_LIST: 'Workspaces-Access-List',
    WORKSPACE_TREE: 'Workspace-Tree',
    WORKSPACE_TREE_LOCKS: 'Workspace-Tree-Locks',
    AI_TOKENS_USAGE_TRANSACTIONS: 'AI-Tokens-Usage-Transactions',
    FINANCIAL_TRANSACTIONS: 'Financial-Transactions',
    AI_TOKENS_USAGE_REPORTS: 'AI-Tokens-Usage-Reports',
    AI_MODELS_LIST: 'AI-Models-List',
    CAPABILITIES: 'Capabilities',
    CAPABILITIES_META: 'Capabilities-Meta',
    CAPABILITIES_ACCESS_LIST: 'Capabilities-Access-List',
    CAPABILITY_RUNS: 'Capability-Runs',
    AGENT_CONVERSATIONS: 'Agent-Conversations',
    MEDIA_GENERATION_REQUESTS: 'Media-Generation-Requests',
    MEDIA_GENERATION_REQUESTS_META: 'Media-Generation-Requests-Meta',
    MEDIA_GENERATION_REQUESTS_ACCESS_LIST: 'Media-Generation-Requests-Access-List',
    ASSETS: 'Assets',
    ASSETS_META: 'Assets-Meta',
    ASSETS_SEARCH: 'Assets-Search',
    ASSETS_ACCESS_LIST: 'Assets-Access-List',
    ASSET_REFERENCES: 'Asset-References',
    ASSET_SUBJECT_IDENTITY_ATTESTATIONS: 'Asset-Subject-Identity-Attestations',
    PROMPT_REFERENCE_RECENTS: 'Prompt-Reference-Recents',
    BLOBS: 'Blobs',
    BLOB_REFERENCES: 'Blob-References',
}

export const formatStageResourceName = (
    resourceName: string,
    orgName: string,
    stageName: string,
): string => `${resourceName}-${orgName}-${stageName}`

export const getDynamoDbTableStageName = (
    tableName: keyof typeof DYNAMODB_TABLES,
    orgName: string,
    stageName: string,
): string => formatStageResourceName(
    DYNAMODB_TABLES[tableName]!,
    orgName,
    stageName,
)

export type DynamoDbAttributeDefinition = {
    name: string
    type: 'S' | 'N' | 'B'
}

export type DynamoDbGlobalSecondaryIndex = {
    name: string
    hashKey: string
    rangeKey?: string
    projectionType: 'ALL'
}

export type DynamoDbKeySchema = {
    attributes: DynamoDbAttributeDefinition[]
    hashKey: string
    rangeKey?: string
    globalSecondaryIndexes?: DynamoDbGlobalSecondaryIndex[]
}

// Each parent's ordered children. `pk` is `ORG#<organizationId>#PARENT#<parentWorkspaceId|ROOT>`
// and `sk` is `<position>#<entryId>`, so one query on a partition lists a level in order.
export const WORKSPACE_TREE_TABLE_SCHEMA: DynamoDbKeySchema = {
    attributes: [
        {
            name: 'pk',
            type: 'S',
        },
        {
            name: 'sk',
            type: 'S',
        },
    ],
    hashKey: 'pk',
    rangeKey: 'sk',
}

// At most one structure operation per organization holds a row here.
export const WORKSPACE_TREE_LOCKS_TABLE_SCHEMA: DynamoDbKeySchema = {
    attributes: [{
        name: 'organizationId',
        type: 'S',
    }],
    hashKey: 'organizationId',
}

// Lists every grant on one workspace, used to deliver conversation events to
// everyone with inherited access.
export const WORKSPACE_ACCESS_BY_WORKSPACE_INDEX: DynamoDbGlobalSecondaryIndex = {
    name: 'workspaceId-userId',
    hashKey: 'workspaceId',
    rangeKey: 'userId',
    projectionType: 'ALL',
}
