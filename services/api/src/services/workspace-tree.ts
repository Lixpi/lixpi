import * as process from 'node:process'

import { getDynamoDbTableStageName } from '@lixpi/constants'
import {
    DynamoDbWorkspaceTreeRepository,
    type WorkspaceTreeTables,
} from './workspace-navigation/dynamodb-workspace-tree-repository.ts'
import { WorkspaceAccessResolver } from './workspace-navigation/workspace-access-resolver.ts'

const tableName = (resource: string): string => getDynamoDbTableStageName(
    resource,
    process.env.ORG_NAME,
    process.env.STAGE,
)

export const workspaceTreeTables = (): WorkspaceTreeTables => ({
    workspaces: tableName('WORKSPACES'),
    workspacesMeta: tableName('WORKSPACES_META'),
    workspacesAccessList: tableName('WORKSPACES_ACCESS_LIST'),
    workspaceTree: tableName('WORKSPACE_TREE'),
    workspaceTreeLocks: tableName('WORKSPACE_TREE_LOCKS'),
})

// Built on each call from the current global database service, so the
// account-admission wrapper installed at startup (and test doubles) apply.
export const workspaceTreeRepository = (): DynamoDbWorkspaceTreeRepository => new DynamoDbWorkspaceTreeRepository(
    dynamoDBService,
    workspaceTreeTables(),
)

export const workspaceAccessResolver = (): WorkspaceAccessResolver => new WorkspaceAccessResolver(
    workspaceTreeRepository(),
)
