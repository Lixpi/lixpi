import {
    CapabilityActionRegistry,
    CapabilityDispatcher,
} from '@lixpi/capability-system/backend'

import { listAuthorizedCapabilities } from '../models/capability.ts'
import { getCapabilityRunEventStreamName } from '../services/capability-run-event-log.ts'
import { AccountRequestContext } from '../services/account-request-context.ts'
import { ProviderCallAccounting } from '../services/provider-call-accounting.ts'
import {
    CapabilityModelResolverStore,
    createCapabilityModelRunPersistence,
    mirrorCapabilityRunEventToChat,
} from './capability-runtime-adapters.ts'

export const capabilityActionRegistry = new CapabilityActionRegistry()

let defaultDispatcher: CapabilityDispatcher | undefined

export const getCapabilityDispatcher = (): CapabilityDispatcher => {
    defaultDispatcher ??= new CapabilityDispatcher({
        store: new CapabilityModelResolverStore(),
        registry: capabilityActionRegistry,
        runInContext: async (requester, operation) => await ProviderCallAccounting.inScope(
            {
                organizationId: requester.organizationId ?? '',
                userId: requester.userId,
                workspaceId: requester.workspaceId,
            },
            operation,
        ),
        createPersistence: createCapabilityModelRunPersistence,
        runDetached: async operation => await AccountRequestContext.detach(async () => await operation(AccountRequestContext.current()?.signal)),
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

            if (
                request.origin === 'panel'
                || !conversationAssetId
            )
                return undefined

            return async event => {
                if (AccountRequestContext.current()?.signal.aborted)
                    return

                await mirrorCapabilityRunEventToChat({
                    event,
                    workspaceId: request.requester.workspaceId,
                    organizationId: request.requester.organizationId,
                    conversationAssetId,
                })
            }
        },
    })

    return defaultDispatcher
}
