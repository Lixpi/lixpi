import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    type DocumentAuthorityTransport,
} from '@lixpi/prosemirror/frontend/document-authority'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'

import {
    type AssetService,
} from '$src/services/asset-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'

// The asset document authority over NATS and the asset service, signed with
// the user's token.
export const createDocumentAuthorityTransport = (
    assetService: AssetService,
    auth: Pick<AuthClientInstance, 'getTokenSilently' | 'userStore'>,
): DocumentAuthorityTransport => {
    const nats = () => servicesStore.getData('nats')

    return {
        isReady: () => Boolean(
            nats(),
        ),
        userId: () => auth.userStore.getData('userId') as string | undefined,
        subscribe: (subject, handler) => nats()!.subscribe(subject, handler),
        resume: async (request, timeoutMs) => await nats()!.request(
            NATS_SUBJECTS.ASSET_SUBJECTS.DOCUMENT_RESUME,
            {
                token: await auth.getTokenSilently(),
                ...request,
            },
            timeoutMs,
        ),
        submitSteps: async request => await nats()!.request(
            NATS_SUBJECTS.ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS,
            {
                token: await auth.getTokenSilently(),
                ...request,
            },
        ),
        fetchSnapshot: reference => assetService.fetchDocumentSnapshot(reference),
        acquireLease: (
            assetId,
            workspaceId,
            holderId,
        ) => assetService.acquireLease(
            assetId,
            workspaceId,
            holderId,
        ),
        renewLease: (
            assetId,
            workspaceId,
            leaseId,
            holderId,
        ) => assetService.renewLease(
            assetId,
            workspaceId,
            leaseId,
            holderId,
        ),
        releaseLease: (
            assetId,
            workspaceId,
            leaseId,
            holderId,
        ) => assetService.releaseLease(
            assetId,
            workspaceId,
            leaseId,
            holderId,
        ),
        readEditLease: async (assetId, workspaceId) => {
            const asset = await assetService.get(assetId, workspaceId)

            return 'error' in asset ? undefined : asset.editLease
        },
    }
}
