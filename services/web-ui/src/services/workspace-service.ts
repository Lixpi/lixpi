'use strict'

import {
    NATS_SUBJECTS,
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

import AuthService from '$src/services/auth-service.ts'
import RouterService from '$src/services/router-service.ts'
import { WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS } from '$src/services/requestTimeouts.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { workspacesStore } from '$src/stores/workspacesStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'

type CanvasSaveQueue = {
    inFlight: boolean
    pendingRequest: CanvasStateSaveRequest | null
    staleRetryCount: number
    authoritativeEpoch: number
}

type CanvasStateSaveRequest = {
    canvasState: CanvasState
    persistViewport: boolean
    sequence: number
}

type CanvasStateUpdateResponse = {
    success?: boolean
    workspaceId?: string
    updatedAt?: number
    canvasStateUpdatedAt?: number
    error?: string
    currentUpdatedAt?: number
    currentCanvasStateUpdatedAt?: number
}

class CanvasWriteLock {
    private locked = false
    private readonly waiters: Array<() => void> = []

    public async run<Result>(operation: () => Promise<Result>): Promise<Result> {
        await this.acquire()
        try {
            return await operation()
        } finally {
            this.release()
        }
    }

    private async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true
            return
        }

        await new Promise<void>((resolve) => this.waiters.push(() => resolve()))
    }

    private release(): void {
        const next = this.waiters.shift()
        if (next) {
            next()
            return
        }
        this.locked = false
    }
}

class WorkspaceService {
    private readonly canvasSaveQueues = new Map<string, CanvasSaveQueue>()
    private readonly canvasWriteLocks = new Map<string, CanvasWriteLock>()
    private canvasSaveRequestSequence = 0
    private static readonly MAX_CANVAS_SAVE_STALE_RETRIES = 3

    constructor() {}

    public async getWorkspace({ workspaceId }: { workspaceId: string }): Promise<void> {
        if (RouterService.getRouteParams().workspaceId !== workspaceId) return
        workspaceStore.beginWorkspaceLoad(workspaceId)

        try {
            const workspace: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            }, WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS)

            if (RouterService.getRouteParams().workspaceId !== workspaceId) return

            if (workspace.error) {
                workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.error })
                workspaceStore.setDataValues({ error: workspace.error })
                return
            }

            const normalizedWorkspace = {
                ...workspace,
                canvasStateUpdatedAt: workspace.canvasStateUpdatedAt ?? workspace.updatedAt,
                canvasState: {
                    ...workspace.canvasState,
                    edges: workspace.canvasState?.edges ?? []
                }
            }

            workspaceStore.setDataValues(normalizedWorkspace)
            workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.success })

        } catch (error) {
            if (RouterService.getRouteParams().workspaceId !== workspaceId) return

            console.error('Failed to load workspace:', error)
            workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.error })
            workspaceStore.setDataValues({ error: error })
        }
    }

    public async getUserWorkspaces(): Promise<void> {
        try {
            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

            const response: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.GET_USER_WORKSPACES, {
                token: await AuthService.getTokenSilently(),
            })

            // Ensure response is an array
            const workspaces = Array.isArray(response) ? response : []
            workspacesStore.setWorkspaces(workspaces)
            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load user workspaces:', error)
            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.error })
            workspacesStore.setWorkspaces([])
        }
    }

    public async createWorkspace({ name }: { name: string }): Promise<void> {
        try {
            const workspace: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.CREATE_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                name
            })

            if (workspace.error) {
                workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.error })
                workspaceStore.setDataValues({ error: workspace.error })
                return
            }

            const normalizedWorkspace = {
                ...workspace,
                canvasStateUpdatedAt: workspace.canvasStateUpdatedAt ?? workspace.updatedAt,
                canvasState: {
                    ...workspace.canvasState,
                    edges: workspace.canvasState?.edges ?? []
                }
            }

            workspaceStore.setDataValues(normalizedWorkspace)
            workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.success })

            // Add workspace to the workspaces list in sidebar
            workspacesStore.addWorkspaces([{
                workspaceId: workspace.workspaceId,
                name: workspace.name,
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt
            }])

            RouterService.navigateTo('/workspace/:workspaceId', {
                params: { workspaceId: workspace.workspaceId },
                shouldFetchData: true
            })

        } catch (error) {
            console.error('Failed to create workspace:', error)
            workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.error })
            workspaceStore.setDataValues({ error: error })
        }
    }

    public async updateWorkspace({ workspaceId, name }: { workspaceId: string; name: string }): Promise<void> {
        try {
            const result: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.UPDATE_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                name
            })

            if (!result.error) {
                workspaceStore.setDataValues({ name })
                workspacesStore.updateWorkspace(workspaceId, { name })
            }
        } catch (error) {
            console.error('Failed to update workspace:', error)
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
        const queue = this.getCanvasSaveQueue(workspaceId)
        queue.pendingRequest = {
            canvasState,
            persistViewport: persistViewport || queue.pendingRequest?.persistViewport === true,
            sequence: ++this.canvasSaveRequestSequence,
        }
        queue.staleRetryCount = 0

        if (!queue.inFlight) {
            void this.flushCanvasStateSaveQueue(workspaceId, queue)
        }
    }

    public async runCanvasMembershipMutation<Result>({
        workspaceId,
        mutation,
    }: {
        workspaceId: string
        mutation: () => Promise<Result>
    }): Promise<Result> {
        return await this.getCanvasWriteLock(workspaceId).run(async () => {
            const includedCanvasSaveSequence = this.canvasSaveRequestSequence
            const result = await mutation()
            this.discardCanvasSavesIncludedInMembershipMutation(workspaceId, includedCanvasSaveSequence)
            return result
        })
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
        const currentCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
        if (typeof currentCanvasStateUpdatedAt === 'number'
            && currentCanvasStateUpdatedAt > canvasStateUpdatedAt) return

        const queue = this.canvasSaveQueues.get(workspaceId)
        // An authoritative state carries the server's viewport, which lags the
        // user's live pan/zoom. Dropping a queued viewport save here would lose
        // that pan/zoom permanently, so re-queue it on top of the adopted state.
        const pendingViewport = queue?.pendingRequest?.persistViewport
            ? queue.pendingRequest.canvasState.viewport
            : null
        if (queue) {
            queue.authoritativeEpoch += 1
            queue.pendingRequest = null
            queue.staleRetryCount = 0
            if (pendingViewport) {
                queue.pendingRequest = {
                    canvasState: { ...canvasState, viewport: pendingViewport },
                    persistViewport: true,
                    sequence: ++this.canvasSaveRequestSequence,
                }
            }
        }

        workspaceStore.updateCanvasState(pendingViewport ? { ...canvasState, viewport: pendingViewport } : canvasState)
        workspaceStore.setDataValues({
            canvasStateUpdatedAt,
            updatedAt: canvasStateUpdatedAt,
        })
        workspaceStore.setMetaValues({ requiresSave: false })
        workspacesStore.updateWorkspace(workspaceId, { updatedAt: canvasStateUpdatedAt })

        if (queue?.pendingRequest && !queue.inFlight) {
            void this.flushCanvasStateSaveQueue(workspaceId, queue)
        }
    }

    private getCanvasSaveQueue(workspaceId: string): CanvasSaveQueue {
        const existing = this.canvasSaveQueues.get(workspaceId)
        if (existing) return existing

        const queue = { inFlight: false, pendingRequest: null, staleRetryCount: 0, authoritativeEpoch: 0 }
        this.canvasSaveQueues.set(workspaceId, queue)
        return queue
    }

    private getCanvasWriteLock(workspaceId: string): CanvasWriteLock {
        const existing = this.canvasWriteLocks.get(workspaceId)
        if (existing) return existing

        const lock = new CanvasWriteLock()
        this.canvasWriteLocks.set(workspaceId, lock)
        return lock
    }

    private discardCanvasSavesIncludedInMembershipMutation(
        workspaceId: string,
        includedCanvasSaveSequence: number,
    ): void {
        const queue = this.canvasSaveQueues.get(workspaceId)
        if (queue?.pendingRequest && queue.pendingRequest.sequence <= includedCanvasSaveSequence) {
            queue.pendingRequest = null
            queue.staleRetryCount = 0
        }
        if (!queue?.pendingRequest) workspaceStore.setMetaValues({ requiresSave: false })
    }

    private async flushCanvasStateSaveQueue(workspaceId: string, queue: CanvasSaveQueue): Promise<void> {
        queue.inFlight = true

        try {
            await this.getCanvasWriteLock(workspaceId).run(async () => {
                await this.flushCanvasStateSaveQueueUnlocked(workspaceId, queue)
            })
        } finally {
            queue.inFlight = false
            if (queue.pendingRequest) {
                void this.flushCanvasStateSaveQueue(workspaceId, queue)
            } else {
                this.canvasSaveQueues.delete(workspaceId)
            }
        }
    }

    private async flushCanvasStateSaveQueueUnlocked(workspaceId: string, queue: CanvasSaveQueue): Promise<void> {
        let activeRequestEpoch = queue.authoritativeEpoch
        let staleRefetchRequeueUsed = false

        try {
            while (queue.pendingRequest) {
                const request = queue.pendingRequest
                queue.pendingRequest = null
                activeRequestEpoch = queue.authoritativeEpoch
                const storedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
                const expectedCanvasStateUpdatedAt = Number.isFinite(storedCanvasStateUpdatedAt)
                    ? storedCanvasStateUpdatedAt
                    : workspaceStore.getData('updatedAt')

                const result: CanvasStateUpdateResponse = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE, {
                    token: await AuthService.getTokenSilently(),
                    workspaceId,
                    canvasState: request.canvasState,
                    ...(request.persistViewport ? { persistViewport: true } : {}),
                    ...(Number.isFinite(expectedCanvasStateUpdatedAt) ? { expectedCanvasStateUpdatedAt } : {}),
                })

                if (activeRequestEpoch !== queue.authoritativeEpoch) continue

                if (result.error === 'STALE_CANVAS_STATE') {
                    const routeStillOwnsWorkspace = RouterService.getRouteParams().workspaceId === workspaceId
                    const canRetryWithCurrentToken = typeof result.currentCanvasStateUpdatedAt === 'number'
                    if (routeStillOwnsWorkspace && canRetryWithCurrentToken && queue.staleRetryCount < WorkspaceService.MAX_CANVAS_SAVE_STALE_RETRIES) {
                        queue.staleRetryCount += 1
                        if (typeof result.currentUpdatedAt === 'number') {
                            workspaceStore.setDataValues({ updatedAt: result.currentUpdatedAt })
                            workspacesStore.updateWorkspace(workspaceId, { updatedAt: result.currentUpdatedAt })
                        }
                        workspaceStore.setDataValues({ canvasStateUpdatedAt: result.currentCanvasStateUpdatedAt })
                        if (queue.pendingRequest) {
                            queue.pendingRequest = {
                                ...queue.pendingRequest,
                                persistViewport: queue.pendingRequest.persistViewport || request.persistViewport,
                            }
                        } else {
                            queue.pendingRequest = request
                        }
                        continue
                    }

                    queue.pendingRequest = null
                    queue.staleRetryCount = 0
                    workspaceStore.setMetaValues({ requiresSave: false })
                    if (routeStillOwnsWorkspace) {
                        await this.getWorkspace({ workspaceId })
                        // Server-side generation runs bump canvasStateUpdatedAt
                        // continuously, so a viewport save can exhaust its stale
                        // retries through no conflict of its own. The refetch
                        // above yields a fresh token — re-queue the viewport on
                        // top of the refetched state instead of dropping it.
                        if (request.persistViewport && !staleRefetchRequeueUsed) {
                            staleRefetchRequeueUsed = true
                            const refetchedCanvasState = workspaceStore.getData('canvasState')
                            if (refetchedCanvasState) {
                                queue.pendingRequest = {
                                    canvasState: { ...refetchedCanvasState, viewport: request.canvasState.viewport },
                                    persistViewport: true,
                                    sequence: ++this.canvasSaveRequestSequence,
                                }
                                workspaceStore.updateCanvasState(queue.pendingRequest.canvasState)
                                continue
                            }
                        }
                    }
                    queue.pendingRequest = null
                    return
                }

                if (result.error) {
                    console.error('Failed to update canvas state:', result.error)
                    workspaceStore.setMetaValues({ requiresSave: true })
                    return
                }

                if (typeof result.updatedAt === 'number') {
                    workspaceStore.setDataValues({ updatedAt: result.updatedAt })
                    workspacesStore.updateWorkspace(workspaceId, { updatedAt: result.updatedAt })
                }
                if (typeof result.canvasStateUpdatedAt === 'number') {
                    workspaceStore.setDataValues({ canvasStateUpdatedAt: result.canvasStateUpdatedAt })
                }

                queue.staleRetryCount = 0
                if (!queue.pendingRequest) {
                    workspaceStore.setMetaValues({ requiresSave: false })
                }
            }
        } catch (error) {
            if (activeRequestEpoch !== queue.authoritativeEpoch) return
            console.error('Failed to update canvas state:', error)
            workspaceStore.setMetaValues({ requiresSave: true })
        }
    }

    public async deleteWorkspace({ workspaceId }: { workspaceId: string }): Promise<void> {
        try {
            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

            const result: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.DELETE_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            })

            const { workspaceId: deletedWorkspaceId, success } = result

            if (!success)
                throw new Error('Failed to delete workspace')

            const currentWorkspaceIndex = workspacesStore.getData().findIndex(workspace => workspace.workspaceId === deletedWorkspaceId)

            // Remove workspace from the sidebar
            workspacesStore.deleteWorkspace(deletedWorkspaceId)

            // Navigate to the next available workspace
            const currentWorkspaceId = RouterService.getRouteParams().workspaceId
            const isDeletingCurrentlyOpenedWorkspace = currentWorkspaceId === deletedWorkspaceId
            const shiftedWorkspaceIndex = Math.max(currentWorkspaceIndex - 1, 0)
            const prevWorkspaceId = workspacesStore.getData()[shiftedWorkspaceIndex]?.workspaceId

            if (isDeletingCurrentlyOpenedWorkspace) {
                if (prevWorkspaceId) {
                    RouterService.navigateTo('/workspace/:workspaceId', {
                        params: { workspaceId: prevWorkspaceId },
                        shouldFetchData: true
                    })
                } else {
                    RouterService.navigateTo('/', { params: {} })
                }
            }

            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.success })

        } catch (error) {
            console.error('Failed to delete workspace:', error)
            workspacesStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }
    }

    addTagToWorkspace({ workspaceId, tagId, organizationId }: { workspaceId: string; tagId: string; organizationId: string }) {
        // SocketService.emit({
        //     event: WORKSPACE_SUBJECTS.ADD_TAG_TO_WORKSPACE,
        //     data: {
        //         workspaceId,
        //         tagId,
        //         organizationId
        //     }
        // })
    }

    _addTagToWorkspaceResponse(data: any) {
        // if (data.error) {
        //     // Handle error case
        //     workspaceStore.setMetaValues({ isLoaded: true, errorLoading: data.error })
        // } else {
        //     // Assuming data contains updated workspace tags
        //     const updatedTags = data.tags

        //     // Update the tags in the workspace data
        //     workspaceStore.setDataValues({ tags: updatedTags })

        //     // Set metadata indicating successful loading
        //     workspaceStore.setMetaValues({ isLoaded: true, errorLoading: false })
        // }
    }

    removeTagFromWorkspace({ workspaceId, tagId }: { workspaceId: string; tagId: string }) {
        // SocketService.emit({
        //     event: WORKSPACE_SUBJECTS.REMOVE_TAG_FROM_WORKSPACE,
        //     data: {
        //         workspaceId,
        //         tagId
        //     }
        // })
    }

    _removeTagFromWorkspaceResponse(data: any) {
    }
}

export default WorkspaceService
