'use strict'

import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

import type { CapabilityRequesterContext } from '../models/capability.ts'

export type CapabilityCatalogInvalidation = {
    capabilityId: string
    scope: 'user' | 'organization' | 'global'
    scopeOwnerId: string
    audienceUserIds?: string[]
}

export function shouldRelayCapabilityCatalogInvalidation(
    payload: CapabilityCatalogInvalidation,
    requester: CapabilityRequesterContext,
): boolean {
    if (payload.scope === 'global') return true
    if (payload.scope === 'user' && payload.scopeOwnerId === requester.userId) return true
    if (payload.scope === 'organization' && requester.organizationIds.includes(payload.scopeOwnerId)) return true
    return payload.audienceUserIds?.includes(requester.userId) === true
}

const activeRelays = new Map<string, CapabilityRequesterContext>()

export function ensureCapabilityCatalogEventRelay(requester: CapabilityRequesterContext): void {
    const existing = activeRelays.get(requester.userId)
    if (existing) {
        activeRelays.set(requester.userId, requester)
        return
    }
    const connection = NATS_Service.getInstance()?.getConnection()
    if (!connection) throw new Error('NATS service unavailable')
    activeRelays.set(requester.userId, requester)
    const subscription = connection.subscribe(NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.EVENTS)
    void (async () => {
        try {
            for await (const message of subscription) {
                let payload: Partial<CapabilityCatalogInvalidation>
                try {
                    payload = JSON.parse(message.string()) as Partial<CapabilityCatalogInvalidation>
                } catch {
                    continue
                }
                if (
                    typeof payload.capabilityId !== 'string'
                    || !['user', 'organization', 'global'].includes(payload.scope ?? '')
                    || typeof payload.scopeOwnerId !== 'string'
                    || (payload.audienceUserIds !== undefined
                        && (!Array.isArray(payload.audienceUserIds)
                            || payload.audienceUserIds.some((item) => typeof item !== 'string')))
                ) continue
                const currentRequester = activeRelays.get(requester.userId)
                if (!currentRequester) continue
                if (
                    !shouldRelayCapabilityCatalogInvalidation(
                        payload as CapabilityCatalogInvalidation,
                        currentRequester,
                    )
                ) continue
                connection.publish(
                    getCapabilityUserEventSubject(
                        requester.userId,
                        NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.CATALOG_CHANGED,
                    ),
                    message.data,
                )
            }
        } finally {
            activeRelays.delete(requester.userId)
        }
    })()
}
