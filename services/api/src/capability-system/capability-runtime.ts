import {
    CapabilityActionRegistry,
    CapabilityDispatcher,
} from '@lixpi/capability-system/backend'

import { listAuthorizedCapabilities } from '../models/capability.ts'
import { getCapabilityRunEventStreamName } from '../services/capability-run-event-log.ts'
import {
    CapabilityModelResolverStore,
    createCapabilityModelRunPersistence,
    mirrorCapabilityRunEventToChat,
} from './capability-runtime-adapters.ts'

export const capabilityActionRegistry = new CapabilityActionRegistry()

let defaultDispatcher: CapabilityDispatcher | undefined

export function getCapabilityDispatcher(): CapabilityDispatcher {
    defaultDispatcher ??= new CapabilityDispatcher({
        store: new CapabilityModelResolverStore(),
        registry: capabilityActionRegistry,
        createPersistence: createCapabilityModelRunPersistence,
        createEventStreamName: run => getCapabilityRunEventStreamName(run.workspaceId),
        search: async (request, requester) =>
            await listAuthorizedCapabilities({
                requester: {
                    userId: requester.userId,
                    organizationIds: requester.organizationId ? [requester.organizationId] : [],
                },
                query: request.query,
                kinds: request.kinds,
                limit: request.limit,
                cursor: request.cursor,
            }),
        createEventHandler: request => {
            const conversationAssetId = request.conversationAssetId
            if (request.origin === 'panel' || !conversationAssetId) return undefined
            return async event =>
                await mirrorCapabilityRunEventToChat({
                    event,
                    workspaceId: request.requester.workspaceId,
                    organizationId: request.requester.organizationId,
                    conversationAssetId,
                })
        },
    })
    return defaultDispatcher
}
