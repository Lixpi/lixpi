'use strict'

// import SocketService from '$src/services/socket.io-service.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'

class OrganizationService {
    static instances = new Map()

    static getInstance(instanceId) {
        if (!OrganizationService.instances.has(instanceId)) {
            OrganizationService.instances.set(instanceId, new OrganizationService(instanceId))
        }
        return OrganizationService.instances.get(instanceId)
    }

    static removeInstance(instanceId) {
        if (OrganizationService.instances.has(instanceId)) {
            OrganizationService.instances.delete(instanceId)
        }
    }

    constructor() {}

    getOrganization({ organizationId }) {
        // organizationStore.setMetaValues({ isLoading: true, isLoaded: false, errorLoading: false })
        // SocketService.emit({
        //     event: 'get->organization',
        //     data: {
        //         organizationId,
        //         room: this.instanceId
        //     }
        // })
    }
    _getOrganizationResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoading: false, isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.setDataValues(response)
        //     organizationStore.setMetaValues({ isLoading: false, isLoaded: true, errorLoading: false })
        // }
    }

    createOrganization({ name, availableModels }) {
        // organizationStore.setMetaValues({ isLoading: true, isLoaded: false, errorLoading: false })
        // SocketService.emit({
        //     event: 'create->organization',
        //     data: {
        //         name,
        //         availableModels,
        //         room: this.instanceId
        //     },
        //     shouldAcknowledge: true,
        //     ack: (response) => {
        //     }
        // })
    }
    _createOrganizationResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoading: false, isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.setDataValues(response)
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: false })
        // }
    }

    updateOrganization({ organizationId, name }) {
        // organizationStore.setMetaValues({ isLoading: true, isLoaded: false, errorLoading: false })
        // SocketService.emit({
        //     event: 'update->organization',
        //     data: {
        //         organizationId,
        //         name,
        //         room: this.instanceId
        //     }
        // })
    }
    _updateOrganizationResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoading: false, isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.setDataValues(response)
        //     organizationStore.setMetaValues({ isLoading: false, isLoaded: true, errorLoading: false })
        // }
    }

    createOrganizationTag({ organizationId, name, color }) {
        // return new Promise((resolve, reject) => {
        //     organizationStore.setMetaValues({ isLoaded: false, errorLoading: false })
        //     SocketService.emit({
        //         event: 'create->organization-tag',
        //         data: {
        //             organizationId,
        //             name,
        //             color,
        //             room: this.instanceId
        //         },
        //         shouldAcknowledge: true,
        //         ack: (response) => {
        //             if (response.success) {
        //                 resolve(response.tags)
        //             } else {
        //                 reject(new Error(response.error))
        //             }
        //         }
        //     })
        // })
    }
    _createOrganizationTagResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.addTag(response.tags)
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: false })
        // }
    }

    updateOrgTag({ organizationId, tagId, name, color }) {
        // organizationStore.setMetaValues({ isLoaded: false, errorLoading: false })
        // SocketService.emit({
        //     event: 'update->organization-tag',
        //     data: {
        //         organizationId,
        //         tagId,
        //         name,
        //         color,
        //         room: this.instanceId
        //     }
        // })
    }
    _updateOrgTagResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.updateTag(response.tags.find(tag => tag.tagId === response.updatedTagId))
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: false })
        // }
    }

    deleteOrgTag({ organizationId, tagId }) {
        // organizationStore.setMetaValues({ isLoaded: false, errorLoading: false })
        // SocketService.emit({
        //     event: 'delete->organization-tag',
        //     data: {
        //         organizationId,
        //         tagId,
        //         room: this.instanceId
        //     }
        // })
    }
    _deleteOrgTagResponse(response) {
        // if (response.error) {
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: response.error })
        // } else {
        //     organizationStore.removeTag(response.deletedTagId)
        //     organizationStore.setMetaValues({ isLoaded: true, errorLoading: false })
        // }
    }
}

export default OrganizationService
