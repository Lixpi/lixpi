'use strict'


export const DYNAMODB_TABLES: Record<string, string> = {
    USERS: 'Users',
    ORGANIZATIONS: 'Organizations',
    ORGANIZATIONS_ACCESS_LIST: 'Organizations-Access-List',
    DOCUMENTS: 'Documents',
    DOCUMENTS_META: 'Documents-Meta',
    DOCUMENTS_ACCESS_LIST: 'Documents-Access-List',
    AI_TOKENS_USAGE_TRANSACTIONS: 'AI-Tokens-Usage-Transactions',
    FINANCIAL_TRANSACTIONS: 'Financial-Transactions',
    AI_TOKENS_USAGE_REPORTS: 'AI-Tokens-Usage-Reports',
    AI_MODELS_LIST: 'AI-Models-List'
}

export const formatStageResourceName = (resourceName: string, orgName: string, stageName: string): string => `${resourceName}-${orgName}-${stageName}`

export const getDynamoDbTableStageName = (tableName: keyof typeof DYNAMODB_TABLES, orgName: string, stageName: string): string => formatStageResourceName(DYNAMODB_TABLES[tableName]!, orgName, stageName)
