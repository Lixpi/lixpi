type OrganizationIdentity = {
    organizationId: string
}

type CreateOrganizationInput = {
    name: string
    availableModels: unknown[]
}

type UpdateOrganizationInput = OrganizationIdentity & {
    name: string
}

type OrganizationTagInput = OrganizationIdentity & {
    name: string
    color: string
}

type ExistingOrganizationTagInput = OrganizationTagInput & {
    tagId: string
}

type DeleteOrganizationTagInput = OrganizationIdentity & {
    tagId: string
}

class OrganizationService {
    private static readonly instances = new Map<string, OrganizationService>()

    static getInstance(instanceId: string): OrganizationService {
        const existingInstance = OrganizationService.instances.get(instanceId)

        if (existingInstance)
            return existingInstance

        const instance = new OrganizationService()
        OrganizationService.instances.set(instanceId, instance)

        return instance
    }

    static removeInstance(instanceId: string): void {
        OrganizationService.instances.delete(instanceId)
    }

    getOrganization(input: OrganizationIdentity): void {
        void input
    }

    _getOrganizationResponse(response: unknown): void {
        void response
    }

    createOrganization(input: CreateOrganizationInput): void {
        void input
    }

    _createOrganizationResponse(response: unknown): void {
        void response
    }

    updateOrganization(input: UpdateOrganizationInput): void {
        void input
    }

    _updateOrganizationResponse(response: unknown): void {
        void response
    }

    createOrganizationTag(input: OrganizationTagInput): void {
        void input
    }

    _createOrganizationTagResponse(response: unknown): void {
        void response
    }

    updateOrgTag(input: ExistingOrganizationTagInput): void {
        void input
    }

    _updateOrgTagResponse(response: unknown): void {
        void response
    }

    deleteOrgTag(input: DeleteOrganizationTagInput): void {
        void input
    }

    _deleteOrgTagResponse(response: unknown): void {
        void response
    }
}

export default OrganizationService
