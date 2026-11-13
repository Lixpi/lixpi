// Keys of the WORKSPACE_TREE table, whose key schema is
// WORKSPACE_TREE_TABLE_SCHEMA in @lixpi/constants. A partition holds one
// parent's children, and the sort key orders them by position. Two entries
// that received the same position from concurrent inserts are ordered by id.

export const WORKSPACE_TREE_ROOT_PARENT = 'ROOT'

export const workspaceTreePartitionKey = (
    organizationId: string,
    parentWorkspaceId: string | undefined,
): string => `ORG#${organizationId}#PARENT#${parentWorkspaceId ?? WORKSPACE_TREE_ROOT_PARENT}`

export const workspaceTreeEntrySortKey = (
    position: string,
    entryId: string,
): string => `${position}#${entryId}`

export const WORKSPACE_HEADING_POINTER_SORT_KEY = 'POINTER'

export const workspaceHeadingPointerPartitionKey = (
    organizationId: string,
    headingId: string,
): string => `ORG#${organizationId}#HEADING#${headingId}`
