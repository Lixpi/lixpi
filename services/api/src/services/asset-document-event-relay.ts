'use strict'

import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import type { AssetRequesterContext } from '@lixpi/constants'
import {
    getAssetDocumentEventSubject,
    getAssetStepSubject,
    type AssetDocCoordinate,
} from '@lixpi/prosemirror'

import AssetModel from '../models/asset.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { createAssetRequesterForWorkspaceUser } from './workspace-reference-scope.ts'

type ActiveDocumentEventRelay = {
    requester: AssetRequesterContext
    requesterRefreshedAt: number
    targetSubject: string
    workspaceId: string
}

const activeRelays = new Map<string, ActiveDocumentEventRelay>()
const REQUESTER_REFRESH_INTERVAL_MS = 5_000

export const ensureAssetDocumentEventRelay = ({
    coordinate,
    requester,
    workspaceId,
}: {
    coordinate: AssetDocCoordinate
    requester: AssetRequesterContext
    workspaceId: string
}): string => {
    const { userId } = requester
    const natsService = NATS_Service.getInstance()
    const connection = natsService?.getConnection()
    if (!connection) throw new Error('NATS service unavailable')

    const sourceSubject = getAssetStepSubject(coordinate)
    const targetSubject = getAssetDocumentEventSubject(userId, coordinate)
    const relayKey = `${userId}#${sourceSubject}`
    const existing = activeRelays.get(relayKey)
    if (existing) {
        existing.requester = requester
        existing.requesterRefreshedAt = Date.now()
        existing.workspaceId = workspaceId
        return targetSubject
    }

    const queue = `asset-doc-relay-${createHash('sha256').update(relayKey).digest('hex').slice(0, 32)}`
    const subscription = connection.subscribe(sourceSubject, { queue })
    const relay: ActiveDocumentEventRelay = {
        requester,
        requesterRefreshedAt: Date.now(),
        targetSubject,
        workspaceId,
    }
    activeRelays.set(relayKey, relay)
    void (async () => {
        try {
            for await (const message of subscription) {
                try {
                    if (Date.now() - relay.requesterRefreshedAt >= REQUESTER_REFRESH_INTERVAL_MS) {
                        const workspace = await Workspace.getWorkspace({ workspaceId: relay.workspaceId, userId })
                        const organization = 'error' in workspace
                            ? workspace
                            : await Organization.getOrganization({ organizationId: workspace.organizationId, userId })
                        relay.requester = 'error' in workspace || workspace.deletingAt || 'error' in organization
                            ? { userId, workspaceIds: [], editableWorkspaceIds: [], organizationIds: [] }
                            : createAssetRequesterForWorkspaceUser(workspace, userId, true)
                        relay.requesterRefreshedAt = Date.now()
                    }
                    const authorized = await AssetModel.get({
                        assetId: coordinate.assetId,
                        requester: relay.requester,
                    })
                    if ('error' in authorized || !authorized.documents[coordinate.role]) continue
                    connection.publish(targetSubject, message.data)
                } catch (error) {
                    console.error('Asset document event authorization failed:', {
                        assetId: coordinate.assetId,
                        role: coordinate.role,
                        error,
                    })
                }
            }
        } finally {
            if (activeRelays.get(relayKey) === relay) activeRelays.delete(relayKey)
        }
    })()
    return targetSubject
}
