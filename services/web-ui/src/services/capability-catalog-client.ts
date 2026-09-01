import { CapabilityCatalogClient } from '@lixpi/capability-system/frontend'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'

export * from '@lixpi/capability-system/frontend'

export function createDefaultCapabilityCatalogClient(
    workspaceId: string,
    organizationId: string,
): CapabilityCatalogClient {
    return new CapabilityCatalogClient({
        transport: {
            request: async <T>(subject: string, payload: Record<string, unknown>): Promise<T> => {
                const nats = servicesStore.getData('nats')
                if (!nats) throw new Error('Capability catalog requires an active NATS connection')
                return await nats.request(subject, payload) as T
            },
            subscribe: (subject, listener) => {
                const nats = servicesStore.getData('nats')
                if (!nats) throw new Error('Capability run events require an active NATS connection')
                return nats.subscribe(subject, listener)
            },
        },
        getToken: () => AuthService.getTokenSilently(),
        workspaceId,
        organizationId,
        getUserId: () => userStore.getData('userId') as string,
    })
}
