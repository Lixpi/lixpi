import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import {
    getAiInteractionCanonicalResponseSubject,
    getAiInteractionResponseSubject,
} from '@lixpi/constants'

import AssetModel from '../models/asset.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { createAssetRequesterForWorkspaceUser } from './workspace-reference-scope.ts'

type ActiveRelay = {
    authorized: boolean
    authorizationRefreshedAt: number
    targetSubject: string
}

const activeRelays = new Map<string, ActiveRelay>()
const REQUESTER_REFRESH_INTERVAL_MS = 5000

const refreshRelayAuthorization = async ({
    relay,
    userId,
    scopeId,
    pipelineId,
    workspaceId,
}: {
    relay: ActiveRelay
    userId: string
    scopeId: string
    pipelineId: string
    workspaceId: string
}): Promise<void> => {
    relay.authorized = false
    relay.authorizationRefreshedAt = Date.now()
    const workspace = await Workspace.getWorkspace({ workspaceId, userId })
    if ('error' in workspace || workspace.deletingAt) return
    if (scopeId !== workspace.workspaceId && scopeId !== workspace.organizationId) return

    const organization = await Organization.getOrganization({ organizationId: workspace.organizationId, userId })
    const requester = createAssetRequesterForWorkspaceUser(workspace, userId, !('error' in organization))
    if (requester.workspaceIds.length === 0) return

    const conversation = await AssetModel.get({ assetId: pipelineId, requester })
    relay.authorized = !('error' in conversation)
        && conversation.organizationId === workspace.organizationId
        && Boolean(conversation.documents.conversation)
}

export const ensureAiInteractionEventRelay = ({
    userId,
    scopeId,
    pipelineId,
    workspaceId,
}: {
    userId: string
    scopeId: string
    pipelineId: string
    workspaceId: string
}): string => {
    const connection = NATS_Service.getInstance()?.getConnection()
    if (!connection) throw new Error('NATS service unavailable')
    const sourceSubject = getAiInteractionCanonicalResponseSubject(scopeId, pipelineId)
    const targetSubject = getAiInteractionResponseSubject(userId, scopeId, pipelineId)
    const relayKey = `${userId}#${workspaceId}#${sourceSubject}`
    if (activeRelays.has(relayKey)) return targetSubject

    const queue = `ai-event-relay-${createHash('sha256').update(relayKey).digest('hex').slice(0, 32)}`
    const subscription = connection.subscribe(sourceSubject, { queue })
    const relay: ActiveRelay = {
        authorized: false,
        authorizationRefreshedAt: 0,
        targetSubject,
    }
    activeRelays.set(relayKey, relay)
    void (async () => {
        try {
            for await (const message of subscription) {
                try {
                    if (Date.now() - relay.authorizationRefreshedAt >= REQUESTER_REFRESH_INTERVAL_MS) {
                        await refreshRelayAuthorization({ relay, userId, scopeId, pipelineId, workspaceId })
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
