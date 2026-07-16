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
    requester: AssetRequesterContext
    requesterRefreshedAt: number
    targetSubject: string
}

const activeRelays = new Map<string, ActiveRelay>()
const REQUESTER_REFRESH_INTERVAL_MS = 5_000

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
        requester: { userId, workspaceIds: [], editableWorkspaceIds: [], organizationIds: [] },
        requesterRefreshedAt: 0,
        targetSubject,
    }
    activeRelays.set(relayKey, relay)
    void (async () => {
        try {
            for await (const message of subscription) {
                try {
                    if (Date.now() - relay.requesterRefreshedAt >= REQUESTER_REFRESH_INTERVAL_MS) {
                        relay.requester = await getAssetRequesterContext(userId)
                        relay.requesterRefreshedAt = Date.now()
                    }
                    if (relay.requester.workspaceIds.includes(scopeId)) {
                        connection.publish(targetSubject, message.data)
                        continue
                    }
                    if (!relay.requester.organizationIds.includes(scopeId)) continue
                    const conversation = await AssetModel.get({ assetId: pipelineId, requester: relay.requester })
                    if ('error' in conversation
                        || conversation.organizationId !== scopeId
                        || !conversation.documents.conversation) continue
                    connection.publish(targetSubject, message.data)
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
