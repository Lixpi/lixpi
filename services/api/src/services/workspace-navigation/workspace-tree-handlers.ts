import { getNatsSubjectPath } from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

import { WorkspaceTreeError } from './workspace-tree-errors.ts'
import {
    type WorkspaceTreeService,
} from './workspace-tree-service.ts'

// A request as the application's NATS layer delivers it: the verified user
// plus the subject's JSON payload.
export type WorkspaceTreeRequest = {
    user?: { userId?: string }
} & Record<string, any>

export type WorkspaceTreeHandler = (data: WorkspaceTreeRequest) => Promise<unknown>

// Turns a service call into the reply shape the browser expects: the result,
// or `{ error }` with the current tree when the request was stale.
const reply = (run: (
    userId: string,
    data: WorkspaceTreeRequest,
) => Promise<unknown>): WorkspaceTreeHandler =>
async data => {
    const userId = data.user?.userId

    if (!userId)
        return { error: 'UNAUTHORIZED' }

    try {
        return await run(userId, data)
    } catch (error) {
        if (error instanceof WorkspaceTreeError)
            return {
                error: error.code,
                ...(error.tree ? { tree: error.tree } : {}),
            }

        err('Workspace tree request failed:', error)

        return { error: 'WORKSPACE_TREE_FAILED' }
    }
}

// Handler definitions for the workspace tree subjects, keyed by subject path.
// The application binds them to its NATS subscriptions beside its own
// workspace handlers. A factory is resolved on each request, so an
// application can bind handlers before its storage is configured.
export const createWorkspaceTreeHandlers = (source: WorkspaceTreeService | (() => WorkspaceTreeService)): Record<string, WorkspaceTreeHandler> => {
    const service = (): WorkspaceTreeService => (typeof source === 'function' ? source() : source)

    return {
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_NAVIGATION)]: reply(
            async userId => await service().getUserWorkspaceNavigation(userId),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.SAVE_WORKSPACE_NAVIGATION)]: reply(
            async (userId, data) => await service().saveNavigation(
                userId,
                {
                    organizationId: data.organizationId,
                    baseRevision: data.baseRevision,
                    mutationId: data.mutationId,
                    document: data.document,
                    deletedWorkspaceIds: data.deletedWorkspaceIds,
                    createdWorkspaceIds: data.createdWorkspaceIds,
                },
            ),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE)]: reply(
            async userId => await service().getUserWorkspaceTree(userId),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)]: reply(
            async (userId, data) => await service().createWorkspace(
                userId,
                {
                    organizationId: data.organizationId,
                    name: data.name,
                    parentWorkspaceId: data.parentWorkspaceId,
                    beforeEntryId: data.beforeEntryId,
                    afterEntryId: data.afterEntryId,
                },
            ),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE)]: reply(
            async (userId, data) => ({
                tree: await service().updateWorkspace(
                    userId,
                    {
                        workspaceId: data.workspaceId,
                        name: data.name,
                        note: data.note,
                        tagIds: data.tagIds,
                    },
                ),
            }),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.MOVE_WORKSPACE)]: reply(
            async (userId, data) => ({
                tree: await service().moveWorkspace(
                    userId,
                    {
                        workspaceId: data.workspaceId,
                        parentWorkspaceId: data.parentWorkspaceId,
                        beforeEntryId: data.beforeEntryId,
                        afterEntryId: data.afterEntryId,
                    },
                ),
            }),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)]: reply(
            async (userId, data) => await service().deleteWorkspace(userId, data.workspaceId),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE_HEADING)]: reply(
            async (userId, data) => ({
                tree: await service().createHeading(
                    userId,
                    {
                        organizationId: data.organizationId,
                        parentWorkspaceId: data.parentWorkspaceId,
                        level: data.level,
                        name: data.name,
                        note: data.note,
                        beforeEntryId: data.beforeEntryId,
                        afterEntryId: data.afterEntryId,
                    },
                ),
            }),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE_HEADING)]: reply(
            async (userId, data) => ({
                tree: await service().updateHeading(
                    userId,
                    {
                        headingId: data.headingId,
                        organizationId: data.organizationId,
                        name: data.name,
                        level: data.level,
                        note: data.note,
                    },
                ),
            }),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.MOVE_WORKSPACE_HEADING)]: reply(
            async (userId, data) => ({
                tree: await service().moveHeading(
                    userId,
                    {
                        headingId: data.headingId,
                        organizationId: data.organizationId,
                        parentWorkspaceId: data.parentWorkspaceId,
                        beforeEntryId: data.beforeEntryId,
                        afterEntryId: data.afterEntryId,
                    },
                ),
            }),
        ),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE_HEADING)]: reply(
            async (userId, data) => ({
                tree: await service().deleteHeading(
                    userId,
                    {
                        headingId: data.headingId,
                        organizationId: data.organizationId,
                    },
                ),
            }),
        ),
    }
}
