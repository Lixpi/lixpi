import {
    type WorkspaceTree,
    type WorkspaceTreeErrorCode,
} from '@lixpi/constants'

// Request validation codes that are not tree conflicts.
export type WorkspaceTreeValidationCode =
    | 'NAME_REQUIRED'
    | 'INVALID_HEADING_LEVEL'
    | 'ORGANIZATION_ACCESS_DENIED'
    | 'WORKSPACE_DELETING'
    | 'WORKSPACE_NAVIGATION_INVALID'
    | 'WORKSPACE_NAVIGATION_STALE'
    | 'WORKSPACE_NAVIGATION_HIDDEN_ENTRY'
    | 'WORKSPACE_NAVIGATION_HIDDEN_PARENT'
    | 'WORKSPACE_NAVIGATION_UNKNOWN_WORKSPACE'
    | 'WORKSPACE_NAVIGATION_EXPLICIT_DELETE_REQUIRED'
    | 'WORKSPACE_NAVIGATION_MUTATION_REUSED'
    | 'WORKSPACE_NAVIGATION_ID_COLLISION'
    | 'WORKSPACE_NAVIGATION_DELETE_TOPOLOGY'

// A typed failure returned to the client. A stale request carries the
// current tree so the client can replace its optimistic copy.
export class WorkspaceTreeError extends Error {
    constructor(
        readonly code: WorkspaceTreeErrorCode | WorkspaceTreeValidationCode,
        readonly tree?: WorkspaceTree,
    ) {
        super(code)
        this.name = 'WorkspaceTreeError'
    }
}
