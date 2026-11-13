import {
    WorkspaceCanvasSessionHub,
    normalizeWorkspaceCanvasState,
} from '@lixpi/canvas-components/workspace/shared'
import {
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import {
    type AuthTokenProvider,
} from '@lixpi/auth-client'
import { createWorkspacePersistencePorts } from '$src/canvas-adapters/workspace-persistence.ts'

import {
    NATS_SUBJECTS,
    type CanvasState,
} from '@lixpi/constants'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

import { WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS } from '$src/services/requestTimeouts.ts'
import {
    measureWorkspaceOpen,
    measureWorkspaceOpenAsync,
} from '$src/services/workspace-open-timing.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { workspaceTreeStore } from '$src/stores/workspaceTreeStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'

type WorkspaceRouter = Pick<WebClientRouterService, 'getRouteParams' | 'navigateTo'>

export type WorkspaceServiceConfig = {
    auth: AuthTokenProvider
    router: WorkspaceRouter
}

class WorkspaceService {
    readonly canvasSessions: WorkspaceCanvasSessionHub

    constructor(private readonly config: WorkspaceServiceConfig) {
        this.canvasSessions = new WorkspaceCanvasSessionHub(() => createWorkspacePersistencePorts(config))
    }

    // `beforePublish` receives the fetched workspace before the store does.
    // Publishing renders the canvas synchronously, so work started there,
    // such as asset requests, goes out first and loads during the render.
    public async getWorkspace({
        workspaceId,
        signal,
        beforePublish,
    }: {
        workspaceId: string
        signal?: AbortSignal
        beforePublish?: (workspace: { canvasState: CanvasState }) => void
    }): Promise<void> {
        const superseded = (): boolean => Boolean(signal?.aborted) || this.config.router.getRouteParams().workspaceId !== workspaceId

        if (superseded())
            return

        workspaceStore.beginWorkspaceLoad(workspaceId)

        try {
            const token = await this.config.auth.getTokenSilently()

            if (superseded())
                return

            const workspace: any = await measureWorkspaceOpenAsync(
                'fetch',
                workspaceId,
                async () => await servicesStore.getData('nats')!.request(
                    WORKSPACE_SUBJECTS.GET_WORKSPACE,
                    {
                        token,
                        workspaceId,
                    },
                    WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS,
                    signal,
                ),
            )

            if (superseded())
                return

            if (workspace.error) {
                workspaceStore.failWorkspaceLoad(workspace.error)

                return
            }

            const normalizedWorkspace = {
                ...workspace,
                canvasStateUpdatedAt: workspace.canvasStateUpdatedAt ?? workspace.updatedAt,
                canvasState: normalizeWorkspaceCanvasState(workspace.canvasState),
            }

            if (beforePublish) {
                beforePublish(normalizedWorkspace)
                // One task lets the requests started above reach the socket
                // before the render takes the main thread.
                await new Promise(resolve => setTimeout(resolve, 0))

                if (superseded())
                    return
            }

            measureWorkspaceOpen(
                'render',
                workspaceId,
                () => workspaceStore.completeWorkspaceLoad(normalizedWorkspace),
            )
        } catch (error) {
            if (superseded())
                return

            console.error('Failed to load workspace:', error)
            workspaceStore.failWorkspaceLoad(error)
        }
    }

    // Loads the user's workspace trees into the store the side panel shows.
    public async getUserWorkspaceTree(): Promise<void> {
        try {
            const trees: any = await servicesStore.getData('nats')!.request(
                WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE,
                { token: await this.config.auth.getTokenSilently() },
            )

            if (
                !trees
                || trees.error
                || !Array.isArray(trees.organizations)
            )
                throw new Error(trees?.error ?? 'WORKSPACE_TREE_UNAVAILABLE')

            workspaceTreeStore.replaceAll(trees)
        } catch (error) {
            console.error('Failed to load the workspace tree:', error)
        }
    }

    public updateCanvasState({
        workspaceId,
        canvasState,
        persistViewport = false,
    }: {
        workspaceId: string
        canvasState: CanvasState
        persistViewport?: boolean
    }): void {
        this.canvasSessions.get(workspaceId).persistence.update(canvasState, persistViewport)
    }

    public async runCanvasMembershipMutation<Result>({
        workspaceId,
        mutation,
    }: {
        workspaceId: string
        mutation: () => Promise<Result>
    }): Promise<Result> {
        return await this.canvasSessions.get(workspaceId).persistence.runMembershipMutation(mutation)
    }

    public adoptAuthoritativeCanvasState({
        workspaceId,
        canvasState,
        canvasStateUpdatedAt,
    }: {
        workspaceId: string
        canvasState: CanvasState
        canvasStateUpdatedAt: number
    }): void {
        this.canvasSessions.get(workspaceId).persistence.adoptAuthoritative({
            canvasState,
            version: {
                updatedAt: canvasStateUpdatedAt,
                canvasStateUpdatedAt,
            },
        })
    }
}

export default WorkspaceService
