'use strict'

import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import {
    getAiInteractionCanonicalResponseSubject,
    getAiInteractionResponseSubject,
    type AssetRequesterContext,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import { getAssetRequesterContext } from './asset-requester-context.ts'

type ActiveRelay = {
    authorized: boolean
    requester: AssetRequesterContext
    authorizationRefreshedAt: number
    targetSubject: string
}

const activeRelays = new Map<string, ActiveRelay>()
const REQUESTER_REFRESH_INTERVAL_MS = 5_000

const refreshRelayAuthorization = async ({
    relay,
    userId,
    scopeId,
    pipelineId,
}: {
    relay: ActiveRelay
    userId: string
    scopeId: string
    pipelineId: string
}): Promise<void> => {
    relay.authorized = false
    relay.requester = await getAssetRequesterContext(userId)
    relay.authorizationRefreshedAt = Date.now()
    if (relay.requester.workspaceIds.includes(scopeId)) {
        relay.authorized = true
        return
    }
    if (!relay.requester.organizationIds.includes(scopeId)) {
        relay.authorized = false
        return
    }

    const conversation = await AssetModel.get({ assetId: pipelineId, requester: relay.requester })
    relay.authorized = !('error' in conversation)
        && conversation.organizationId === scopeId
        && Boolean(conversation.documents.conversation)
}

export const ensureAiInteractionEventRelay = ({
    userId,
    scopeId,
    pipelineId,
}: {
    userId: string
    scopeId: string
    pipelineId: string
}): string => {
    const connection = NATS_Service.getInstance()?.getConnection()
    if (!connection) throw new Error('NATS service unavailable')
    const sourceSubject = getAiInteractionCanonicalResponseSubject(scopeId, pipelineId)
    const targetSubject = getAiInteractionResponseSubject(userId, scopeId, pipelineId)
    const relayKey = `${userId}#${sourceSubject}`
    if (activeRelays.has(relayKey)) return targetSubject

    const queue = `ai-event-relay-${createHash('sha256').update(relayKey).digest('hex').slice(0, 32)}`
    const subscription = connection.subscribe(sourceSubject, { queue })
    const relay: ActiveRelay = {
        authorized: false,
        requester: { userId, workspaceIds: [], editableWorkspaceIds: [], organizationIds: [] },
        authorizationRefreshedAt: 0,
        targetSubject,
    }
    activeRelays.set(relayKey, relay)
    void (async () => {
        try {
            for await (const message of subscription) {
                try {
                    if (Date.now() - relay.authorizationRefreshedAt >= REQUESTER_REFRESH_INTERVAL_MS) {
                        await refreshRelayAuthorization({ relay, userId, scopeId, pipelineId })
                    }
                    if (relay.authorized) connection.publish(targetSubject, message.data)
                } catch (error) {
                    console.error('AI interaction event authorization failed:', { userId, scopeId, pipelineId, error })
                }
            }
        } finally {
            if (activeRelays.get(relayKey) === relay) activeRelays.delete(relayKey)
        }
    })()
    return targetSubject
}
