'use strict'


export const DYNAMODB_TABLES: Record<string, string> = {
    USERS: 'Users',
    ORGANIZATIONS: 'Organizations',
    ORGANIZATIONS_ACCESS_LIST: 'Organizations-Access-List',
    WORKSPACES: 'Workspaces',
    WORKSPACES_META: 'Workspaces-Meta',
    WORKSPACES_ACCESS_LIST: 'Workspaces-Access-List',
    AI_TOKENS_USAGE_TRANSACTIONS: 'AI-Tokens-Usage-Transactions',
    FINANCIAL_TRANSACTIONS: 'Financial-Transactions',
    AI_TOKENS_USAGE_REPORTS: 'AI-Tokens-Usage-Reports',
    AI_MODELS_LIST: 'AI-Models-List',
    CAPABILITIES: 'Capabilities',
    CAPABILITIES_META: 'Capabilities-Meta',
    CAPABILITIES_ACCESS_LIST: 'Capabilities-Access-List',
    CAPABILITY_RUNS: 'Capability-Runs',
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

export const formatStageResourceName = (resourceName: string, orgName: string, stageName: string): string => `${resourceName}-${orgName}-${stageName}`

export const getDynamoDbTableStageName = (tableName: keyof typeof DYNAMODB_TABLES, orgName: string, stageName: string): string => formatStageResourceName(DYNAMODB_TABLES[tableName]!, orgName, stageName)
