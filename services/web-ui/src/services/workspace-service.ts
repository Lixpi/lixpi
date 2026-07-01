'use strict'

import {
    NATS_SUBJECTS,
    LoadingStatus,
    type CanvasState,
} from '@lixpi/constants'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

import AuthService from '$src/services/auth-service.ts'
import RouterService from '$src/services/router-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { workspacesStore } from '$src/stores/workspacesStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'

type CanvasSaveQueue = {
    inFlight: boolean
    pendingCanvasState: CanvasState | null
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

class WorkspaceService {
    private readonly canvasSaveQueues = new Map<string, CanvasSaveQueue>()

    constructor() {}

    public async getWorkspace({ workspaceId }: { workspaceId: string }): Promise<void> {
        workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const workspace: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            })

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

    public updateCanvasState({ workspaceId, canvasState }: { workspaceId: string; canvasState: CanvasState }): void {
        const queue = this.getCanvasSaveQueue(workspaceId)
        queue.pendingCanvasState = canvasState

        if (!queue.inFlight) {
            void this.flushCanvasStateSaveQueue(workspaceId, queue)
        }
    }

    private getCanvasSaveQueue(workspaceId: string): CanvasSaveQueue {
        const existing = this.canvasSaveQueues.get(workspaceId)
        if (existing) return existing

        const queue = { inFlight: false, pendingCanvasState: null }
        this.canvasSaveQueues.set(workspaceId, queue)
        return queue
    }

    private async flushCanvasStateSaveQueue(workspaceId: string, queue: CanvasSaveQueue): Promise<void> {
        queue.inFlight = true

        try {
            while (queue.pendingCanvasState) {
                const canvasState = queue.pendingCanvasState
                queue.pendingCanvasState = null
                const storedCanvasStateUpdatedAt = workspaceStore.getData('canvasStateUpdatedAt')
                const expectedCanvasStateUpdatedAt = Number.isFinite(storedCanvasStateUpdatedAt)
                    ? storedCanvasStateUpdatedAt
                    : workspaceStore.getData('updatedAt')

                const result: CanvasStateUpdateResponse = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE, {
                    token: await AuthService.getTokenSilently(),
                    workspaceId,
                    canvasState,
                    ...(Number.isFinite(expectedCanvasStateUpdatedAt) ? { expectedCanvasStateUpdatedAt } : {}),
                })

                if (result.error === 'STALE_CANVAS_STATE') {
                    queue.pendingCanvasState = null
                    workspaceStore.setMetaValues({ requiresSave: false })
                    if (RouterService.getRouteParams().workspaceId === workspaceId) {
                        await this.getWorkspace({ workspaceId })
                    }
                    queue.pendingCanvasState = null
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

                if (!queue.pendingCanvasState) {
                    workspaceStore.setMetaValues({ requiresSave: false })
                }
            }
        } catch (error) {
            console.error('Failed to update canvas state:', error)
            workspaceStore.setMetaValues({ requiresSave: true })
        } finally {
            queue.inFlight = false
            if (queue.pendingCanvasState) {
                void this.flushCanvasStateSaveQueue(workspaceId, queue)
            } else {
                this.canvasSaveQueues.delete(workspaceId)
            }
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
