import {
    NATS_SUBJECTS,
    WORKSPACE_TREE_ERROR,
    type CreateWorkspaceHeadingRequest,
    type CreateWorkspaceRequest,
    type DeleteWorkspaceHeadingRequest,
    type DeleteWorkspaceResult,
    type MoveWorkspaceHeadingRequest,
    type MoveWorkspaceRequest,
    type SaveWorkspaceNavigationRequest,
    type UserWorkspaceNavigation,
    type WorkspaceNavigationSnapshot,
    type UpdateWorkspaceHeadingRequest,
    type UpdateWorkspaceRequest,
    type UserWorkspaceTrees,
    type WorkspaceMeta,
    type WorkspaceTree,
} from '@lixpi/constants'

// Sends one request and returns the reply. The host supplies its transport,
// such as an authenticated NATS request.
export type WorkspaceTreeRequestPort = (
    subject: string,
    payload: Record<string, unknown>,
) => Promise<unknown>

// A failed tree request. A stale request carries the current tree.
export class WorkspaceTreeClientError extends Error {
    constructor(
        readonly code: string,
        readonly tree?: WorkspaceTree,
        readonly snapshot?: WorkspaceNavigationSnapshot,
        readonly retryAfterMs?: number,
    ) {
        super(code)
        this.name = 'WorkspaceTreeClientError'
    }
}

export const BUSY_RETRIES = 3
const BUSY_RETRY_DELAY_MS = 300

const subjects = NATS_SUBJECTS.WORKSPACE_SUBJECTS

export type WorkspaceTreeClient = {
    getTrees: () => Promise<UserWorkspaceTrees>
    getNavigation: () => Promise<UserWorkspaceNavigation>
    saveNavigation: (request: SaveWorkspaceNavigationRequest) => Promise<WorkspaceNavigationSnapshot>
    createWorkspace: (request: CreateWorkspaceRequest) => Promise<{
        workspace: WorkspaceMeta
        tree: WorkspaceTree
    }>
    updateWorkspace: (request: UpdateWorkspaceRequest) => Promise<WorkspaceTree>
    moveWorkspace: (request: MoveWorkspaceRequest) => Promise<WorkspaceTree>
    deleteWorkspace: (workspaceId: string) => Promise<DeleteWorkspaceResult>
    createHeading: (request: CreateWorkspaceHeadingRequest) => Promise<WorkspaceTree>
    updateHeading: (request: UpdateWorkspaceHeadingRequest) => Promise<WorkspaceTree>
    moveHeading: (request: MoveWorkspaceHeadingRequest) => Promise<WorkspaceTree>
    deleteHeading: (request: DeleteWorkspaceHeadingRequest) => Promise<WorkspaceTree>
}

class WorkspaceTreeRequests implements WorkspaceTreeClient {
    constructor(
        private readonly request: WorkspaceTreeRequestPort,
        private readonly sleep: (milliseconds: number) => Promise<void>,
    ) {}

    // Retries a busy organization silently a few times before reporting it,
    // because another person's structure change usually finishes quickly.
    private async send<Reply>(
        subject: string,
        payload: object,
    ): Promise<Reply> {
        for (let attempt = 0; ; attempt += 1) {
            const reply = (await this.request(subject, payload as Record<string, unknown>)) as Reply & {
                error?: string
                tree?: WorkspaceTree
                snapshot?: WorkspaceNavigationSnapshot
                retryAfterMs?: number
            }

            if (!reply?.error)
                return reply

            if (
                reply.error === WORKSPACE_TREE_ERROR.BUSY
                && attempt < BUSY_RETRIES
            ) {
                await this.sleep(BUSY_RETRY_DELAY_MS * (attempt + 1))

                continue
            }

            throw new WorkspaceTreeClientError(
                reply.error,
                reply.tree,
                reply.snapshot,
                reply.retryAfterMs,
            )
        }
    }

    getTrees = async (): Promise<UserWorkspaceTrees> => await this.send(subjects.GET_USER_WORKSPACE_TREE, {})

    getNavigation = async (): Promise<UserWorkspaceNavigation> => await this.send(subjects.GET_USER_WORKSPACE_NAVIGATION, {})

    saveNavigation = async (request: SaveWorkspaceNavigationRequest): Promise<WorkspaceNavigationSnapshot> => (await this.send<{ snapshot: WorkspaceNavigationSnapshot }>(
        subjects.SAVE_WORKSPACE_NAVIGATION,
        request,
    )).snapshot

    createWorkspace = async (request: CreateWorkspaceRequest) =>
        await this.send<{
            workspace: WorkspaceMeta
            tree: WorkspaceTree
        }>(subjects.CREATE_WORKSPACE, request)

    updateWorkspace = async (request: UpdateWorkspaceRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.UPDATE_WORKSPACE,
        request,
    )).tree

    moveWorkspace = async (request: MoveWorkspaceRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.MOVE_WORKSPACE,
        request,
    )).tree

    deleteWorkspace = async (workspaceId: string): Promise<DeleteWorkspaceResult> => await this.send(subjects.DELETE_WORKSPACE, { workspaceId })

    createHeading = async (request: CreateWorkspaceHeadingRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.CREATE_WORKSPACE_HEADING,
        request,
    )).tree

    updateHeading = async (request: UpdateWorkspaceHeadingRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.UPDATE_WORKSPACE_HEADING,
        request,
    )).tree

    moveHeading = async (request: MoveWorkspaceHeadingRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.MOVE_WORKSPACE_HEADING,
        request,
    )).tree

    deleteHeading = async (request: DeleteWorkspaceHeadingRequest): Promise<WorkspaceTree> => (await this.send<{ tree: WorkspaceTree }>(
        subjects.DELETE_WORKSPACE_HEADING,
        request,
    )).tree
}

export const createWorkspaceTreeClient = (
    request: WorkspaceTreeRequestPort,
    sleep: (milliseconds: number) => Promise<void> = async milliseconds => await new Promise(resolve => setTimeout(resolve, milliseconds)),
): WorkspaceTreeClient => new WorkspaceTreeRequests(request, sleep)
