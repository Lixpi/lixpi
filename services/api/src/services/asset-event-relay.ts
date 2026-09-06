import { err as debugError } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import {
    getAssetEventSubject,
    NATS_SUBJECTS,
    type AssetRequesterContext,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { createAssetRequesterForWorkspaceUser } from './workspace-reference-scope.ts'

type ActiveAssetEventRelay = {
    authorizedAssetIds: Set<string>
    subscriptionsRemaining: number
}

const activeRelays = new Map<string, ActiveAssetEventRelay>()
const canonicalSubjects = Object.values(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS)

const getEventRequester = async ({
    assetId,
    organizationId,
    userId,
}: {
    assetId: string
    organizationId: string
    userId: string
}): Promise<AssetRequesterContext> => {
    const organization = await Organization.getOrganization({
        organizationId,
        userId,
    })

    if ('error' in organization)
        return {
            userId,
            workspaceIds: [],
            editableWorkspaceIds: [],
            organizationIds: [],
        }

    const references = await AssetModel.listReferences(assetId)
    const referencedWorkspaceIds = [
        ...new Set(
            references.flatMap(reference => {
                if (
                    reference.type === 'workspace'
                    && reference.workspaceId
                )
                    return [reference.workspaceId]

                if (
                    reference.type === 'catalog'
                    && reference.scope === 'workspace'
                    && reference.scopeOwnerId
                )
                    return [reference.scopeOwnerId]

                return []
            }),
        ),
    ]
    const workspaces = await Promise.all(
        referencedWorkspaceIds.map(
            async workspaceId => await Workspace.getWorkspace({
                workspaceId,
                userId,
            }),
        ),
    )

    return workspaces.reduce<AssetRequesterContext>(
        (requester, workspace) => {
            if (
                'error' in workspace
                || workspace.deletingAt
                || workspace.organizationId !== organizationId
            )
                return requester

            const scoped = createAssetRequesterForWorkspaceUser(
                workspace,
                userId,
                true,
            )
            requester.workspaceIds.push(...scoped.workspaceIds)
            requester.editableWorkspaceIds.push(...scoped.editableWorkspaceIds)

            return requester
        },
        {
            userId,
            workspaceIds: [],
            editableWorkspaceIds: [],
            organizationIds: [organizationId],
        },
    )
}

export const ensureAssetEventRelay = ({
    requester,
}: {
    requester: AssetRequesterContext
}): void => {
    const { userId } = requester
    const existing = activeRelays.get(userId)

    if (existing)
        return

    const connection = NATS_Service.getInstance()?.getConnection()

    if (!connection)
        throw new Error('NATS service unavailable')

    const relay: ActiveAssetEventRelay = {
        authorizedAssetIds: new Set(),
        subscriptionsRemaining: canonicalSubjects.length,
    }
    activeRelays.set(userId, relay)

    for (const sourceSubject of canonicalSubjects) {
        const subscription = connection.subscribe(sourceSubject)
        void (async () => {
            try {
                for await (const message of subscription) {
                    let payload: {
                        organizationId?: unknown
                        assetId?: unknown
                    }

                    try {
                        payload = JSON.parse(
                            message.string(),
                        ) as {
                            organizationId?: unknown
                            assetId?: unknown
                        }
                    } catch {
                        continue
                    }

                    if (
                        typeof payload.organizationId !== 'string'
                        || typeof payload.assetId !== 'string'
                    )
                        continue

                    const wasAuthorized = relay.authorizedAssetIds.has(payload.assetId)
                    let eventRequester: AssetRequesterContext

                    try {
                        eventRequester = await getEventRequester({
                            assetId: payload.assetId,
                            organizationId: payload.organizationId,
                            userId,
                        })
                    } catch (error) {
                        debugError(
                            'Asset event requester refresh failed:',
                            {
                                userId,
                                assetId: payload.assetId,
                                error,
                            },
                        )

                        continue
                    }

                    if (!eventRequester.organizationIds.includes(payload.organizationId))
                        continue

                    if (sourceSubject === NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.DELETED) {
                        if (!wasAuthorized)
                            continue

                        relay.authorizedAssetIds.delete(payload.assetId)
                    } else {
                        let authorized: Awaited<ReturnType<typeof AssetModel.get>>

                        try {
                            authorized = await AssetModel.get({
                                assetId: payload.assetId,
                                requester: eventRequester,
                            })
                        } catch (error) {
                            debugError(
                                'Asset event authorization failed:',
                                {
                                    assetId: payload.assetId,
                                    error,
                                },
                            )

                            continue
                        }

                        if ('error' in authorized) {
                            if (!wasAuthorized)
                                continue

                            relay.authorizedAssetIds.delete(payload.assetId)
                        } else
                            relay.authorizedAssetIds.add(payload.assetId)
                    }

                    connection.publish(
                        getAssetEventSubject(userId, sourceSubject),
                        message.data,
                    )
                }
            } finally {
                relay.subscriptionsRemaining -= 1

                if (
                    relay.subscriptionsRemaining === 0
                    && activeRelays.get(userId) === relay
                )
                    activeRelays.delete(userId)
            }
        })()
    }
}

export const rememberAuthorizedAssetEvent = (
    userId: string,
    assetId: string,
): void => void activeRelays.get(userId)?.authorizedAssetIds.add(assetId)
