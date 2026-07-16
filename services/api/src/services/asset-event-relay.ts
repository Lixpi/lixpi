'use strict'

import NATS_Service from '@lixpi/nats-service'
import {
    getAssetEventSubject,
    NATS_SUBJECTS,
    type AssetRequesterContext,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import { getAssetRequesterContext } from './asset-requester-context.ts'

type ActiveAssetEventRelay = {
    requester: AssetRequesterContext
    authorizedAssetIds: Set<string>
    subscriptionsRemaining: number
}

const activeRelays = new Map<string, ActiveAssetEventRelay>()
const canonicalSubjects = Object.values(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS)

export const ensureAssetEventRelay = ({
    requester,
}: {
    requester: AssetRequesterContext
}): void => {
    const { userId } = requester
    const existing = activeRelays.get(userId)
    if (existing) {
        existing.requester = requester
        return
    }

    const connection = NATS_Service.getInstance()?.getConnection()
    if (!connection) throw new Error('NATS service unavailable')
    const relay: ActiveAssetEventRelay = {
        requester,
        authorizedAssetIds: new Set(),
        subscriptionsRemaining: canonicalSubjects.length,
    }
    activeRelays.set(userId, relay)

    for (const sourceSubject of canonicalSubjects) {
        const subscription = connection.subscribe(sourceSubject)
        void (async () => {
            try {
                for await (const message of subscription) {
                    let payload: { organizationId?: unknown; assetId?: unknown }
                    try {
                        payload = JSON.parse(message.string()) as { organizationId?: unknown; assetId?: unknown }
                    } catch {
                        continue
                    }
                    try {
                        relay.requester = await getAssetRequesterContext(userId)
                    } catch (error) {
                        console.error('Asset event requester refresh failed:', { userId, error })
                        continue
                    }
                    if (typeof payload.organizationId !== 'string'
                        || typeof payload.assetId !== 'string'
                        || !relay.requester.organizationIds.includes(payload.organizationId)) continue

                    const wasAuthorized = relay.authorizedAssetIds.has(payload.assetId)
                    if (sourceSubject === NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.DELETED) {
                        if (!wasAuthorized) continue
                        relay.authorizedAssetIds.delete(payload.assetId)
                    } else {
                        let authorized: Awaited<ReturnType<typeof AssetModel.get>>
                        try {
                            authorized = await AssetModel.get({
                                assetId: payload.assetId,
                                requester: relay.requester,
                            })
                        } catch (error) {
                            console.error('Asset event authorization failed:', { assetId: payload.assetId, error })
                            continue
                        }
                        if ('error' in authorized) {
                            if (!wasAuthorized) continue
                            relay.authorizedAssetIds.delete(payload.assetId)
                        } else {
                            relay.authorizedAssetIds.add(payload.assetId)
                        }
                    }
                    connection.publish(getAssetEventSubject(userId, sourceSubject), message.data)
                }
            } finally {
                relay.subscriptionsRemaining -= 1
                if (relay.subscriptionsRemaining === 0 && activeRelays.get(userId) === relay) {
                    activeRelays.delete(userId)
                }
            }
        })()
    }
}

export const rememberAuthorizedAssetEvent = (userId: string, assetId: string): void => {
    activeRelays.get(userId)?.authorizedAssetIds.add(assetId)
}
