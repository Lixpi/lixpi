'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import { shouldRelayCapabilityCatalogInvalidation } from './capability-catalog-event-relay.ts'

const requester = {
    userId: 'user-1',
    organizationIds: ['org-1'],
}

describe('Capability catalog event authorization', () => {
    it('relays base-scope changes to users affected by global, organization, and user catalogs', () => {
        expect(shouldRelayCapabilityCatalogInvalidation({
            capabilityId: 'global-capability',
            scope: 'global',
            scopeOwnerId: 'system',
        }, requester)).toBe(true)
        expect(shouldRelayCapabilityCatalogInvalidation({
            capabilityId: 'org-capability',
            scope: 'organization',
            scopeOwnerId: 'org-1',
        }, requester)).toBe(true)
        expect(shouldRelayCapabilityCatalogInvalidation({
            capabilityId: 'user-capability',
            scope: 'user',
            scopeOwnerId: 'user-1',
        }, requester)).toBe(true)
    })

    it('relays delete and revoke invalidations to explicitly affected principals without a current record lookup', () => {
        expect(shouldRelayCapabilityCatalogInvalidation({
            capabilityId: 'deleted-capability',
            scope: 'organization',
            scopeOwnerId: 'other-org',
            audienceUserIds: ['user-1'],
        }, requester)).toBe(true)
    })

    it('does not leak unrelated scoped catalog changes', () => {
        expect(shouldRelayCapabilityCatalogInvalidation({
            capabilityId: 'private-capability',
            scope: 'user',
            scopeOwnerId: 'other-user',
            audienceUserIds: ['third-user'],
        }, requester)).toBe(false)
    })
})
