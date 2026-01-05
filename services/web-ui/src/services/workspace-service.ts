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

class WorkspaceService {
    constructor() {}

    public async getWorkspace({ workspaceId }: { workspaceId: string }): Promise<void> {
        workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const workspace: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                token: await AuthService.getTokenSilently(),
                workspaceId
            })

            if (workspace.error) {
                workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.error })
                workspaceStore.setDataValues({ error: workspace.error })
                return
            }

            const normalizedWorkspace = {
                ...workspace,
                canvasState: {
                    ...workspace.canvasState,
                    edges: workspace.canvasState?.edges ?? []
                }
            }

            workspaceStore.setDataValues(normalizedWorkspace)
            workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.success })

        } catch (error) {
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

    public async updateCanvasState({ workspaceId, canvasState }: { workspaceId: string; canvasState: CanvasState }): Promise<void> {
        try {
            const result: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE, {
                token: await AuthService.getTokenSilently(),
                workspaceId,
                canvasState
            })

            if (!result.error) {
                workspaceStore.setMetaValues({ requiresSave: false })
            }
        } catch (error) {
            console.error('Failed to update canvas state:', error)
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
