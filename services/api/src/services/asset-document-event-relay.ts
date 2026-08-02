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
    authorization: AssetDocumentEventAuthorizationCache
    authorizationRefreshCount: number
    droppedEventCount: number
    forwardedEventCount: number
    openedAt: number
    receivedEventCount: number
    requester: AssetRequesterContext
    targetSubject: string
    workspaceId: string
}

const activeRelays = new Map<string, ActiveDocumentEventRelay>()
const REQUESTER_REFRESH_INTERVAL_MS = 5000

export class AssetDocumentEventAuthorizationCache {
    private authorized: boolean
    private refreshedAt: number

    constructor({
        authorized,
        refreshedAt,
    }: {
        authorized: boolean
        refreshedAt: number
    }) {
        this.authorized = authorized
        this.refreshedAt = refreshedAt
    }

    confirmAuthorized(now: number): void {
        this.authorized = true
        this.refreshedAt = now
    }

    async authorize({
        now,
        refresh,
    }: {
        now: number
        refresh: () => Promise<boolean>
    }): Promise<{ authorized: boolean; refreshed: boolean }> {
        if (now - this.refreshedAt < REQUESTER_REFRESH_INTERVAL_MS) {
            return { authorized: this.authorized, refreshed: false }
        }
        this.authorized = false
        this.refreshedAt = now
        this.authorized = await refresh()
        return { authorized: this.authorized, refreshed: true }
    }
}

const refreshRelayAuthorization = async ({
    relay,
    coordinate,
    userId,
}: {
    relay: ActiveDocumentEventRelay
    coordinate: AssetDocCoordinate
    userId: string
}): Promise<boolean> => {
    const startedAt = Date.now()
    relay.authorizationRefreshCount += 1
    let outcome = 'refresh-failed'
    try {
        const workspace = await Workspace.getWorkspace({ workspaceId: relay.workspaceId, userId })
        if ('error' in workspace || workspace.deletingAt) {
            outcome = 'workspace-denied'
            return false
        }
        const organization = await Organization.getOrganization({
            organizationId: workspace.organizationId,
            userId,
        })
        if ('error' in organization) {
            outcome = 'organization-denied'
            return false
        }
        relay.requester = createAssetRequesterForWorkspaceUser(workspace, userId, true)
        const authorized = await AssetModel.get({
            assetId: coordinate.assetId,
            requester: relay.requester,
            origin: 'AssetDocumentEventRelay.refreshAuthorization',
        })
        const allowed = !('error' in authorized) && Boolean(authorized.documents[coordinate.role])
        outcome = allowed ? 'authorized' : 'asset-denied'
        return allowed
    } catch (error) {
        console.error('[AssetDocumentEventRelay] authorization refresh failed', {
            userId,
            workspaceId: relay.workspaceId,
            assetId: coordinate.assetId,
            role: coordinate.role,
            refreshCount: relay.authorizationRefreshCount,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : String(error),
        })
        return false
    } finally {
        console.info('[AssetDocumentEventRelay] authorization refreshed', {
            userId,
            workspaceId: relay.workspaceId,
            assetId: coordinate.assetId,
            role: coordinate.role,
            outcome,
            refreshCount: relay.authorizationRefreshCount,
            receivedEventCount: relay.receivedEventCount,
            forwardedEventCount: relay.forwardedEventCount,
            droppedEventCount: relay.droppedEventCount,
            durationMs: Date.now() - startedAt,
        })
    }
}

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
        existing.workspaceId = workspaceId
        existing.authorization.confirmAuthorized(Date.now())
        return targetSubject
    }

    const queue = `asset-doc-relay-${createHash('sha256').update(relayKey).digest('hex').slice(0, 32)}`
    const subscription = connection.subscribe(sourceSubject, { queue })
    const openedAt = Date.now()
    const relay: ActiveDocumentEventRelay = {
        authorization: new AssetDocumentEventAuthorizationCache({
            authorized: true,
            refreshedAt: openedAt,
        }),
        authorizationRefreshCount: 0,
        droppedEventCount: 0,
        forwardedEventCount: 0,
        openedAt,
        receivedEventCount: 0,
        requester,
        targetSubject,
        workspaceId,
    }
    activeRelays.set(relayKey, relay)
    console.info('[AssetDocumentEventRelay] opened', {
        userId,
        workspaceId,
        assetId: coordinate.assetId,
        role: coordinate.role,
        sourceSubject,
        targetSubject,
    })
    void (async () => {
        try {
            for await (const message of subscription) {
                try {
                    relay.receivedEventCount += 1
                    const decision = await relay.authorization.authorize({
                        now: Date.now(),
                        refresh: async () => await refreshRelayAuthorization({ relay, coordinate, userId }),
                    })
                    if (!decision.authorized) {
                        relay.droppedEventCount += 1
                        continue
                    }
                    connection.publish(targetSubject, message.data)
                    relay.forwardedEventCount += 1
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
            console.info('[AssetDocumentEventRelay] closed', {
                userId,
                workspaceId: relay.workspaceId,
                assetId: coordinate.assetId,
                role: coordinate.role,
                authorizationRefreshCount: relay.authorizationRefreshCount,
                receivedEventCount: relay.receivedEventCount,
                forwardedEventCount: relay.forwardedEventCount,
                droppedEventCount: relay.droppedEventCount,
                durationMs: Date.now() - relay.openedAt,
            })
        }
    })()
    return targetSubject
}
