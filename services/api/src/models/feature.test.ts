'use strict'

import { describe, it, expect } from 'vitest'

import type { Feature } from '@lixpi/constants'
import { canRead } from './feature.ts'

const makeFeature = (overrides: Partial<Feature> = {}): Feature => ({
    featureId: 'feature-1',
    version: 1,
    category: 'illustration-style',
    name: 'painted-light',
    summary: 'Soft painted illumination.',
    tags: [],
    instructions: '',
    parameters: {},
    sampleImages: [],
    scope: 'organization',
    scopeOwnerId: 'org-1',
    status: 'active',
    ownerUserId: 'owner-user',
    workspaceId: 'workspace-1',
    sourceContext: { extractionRunId: 'run-1', sourceWorkspaceId: 'workspace-1' },
    reportCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

// =============================================================================
// canRead — org-wide access rule (the only two scopes are organization + shared)
// =============================================================================

describe('canRead', () => {
    it('grants access to a member of the owning organization', () => {
        const feature = makeFeature({ scope: 'organization', scopeOwnerId: 'org-1' })
        // A different user than the owner, but same org, can read it.
        expect(canRead('some-other-user', feature, 'workspace-1', 'org-1')).toBe(true)
    })

    it('denies access when the requester belongs to a different organization', () => {
        const feature = makeFeature({ scope: 'organization', scopeOwnerId: 'org-1' })
        expect(canRead('owner-user', feature, 'workspace-1', 'org-2')).toBe(false)
    })

    it('denies access when no organization context is supplied', () => {
        const feature = makeFeature({ scope: 'organization', scopeOwnerId: 'org-1' })
        expect(canRead('owner-user', feature, 'workspace-1', undefined)).toBe(false)
    })

    it('does not grant the owner access purely by ownership', () => {
        // Ownership alone is not a read grant — access is gated on org membership.
        const feature = makeFeature({ scope: 'organization', scopeOwnerId: 'org-1', ownerUserId: 'owner-user' })
        expect(canRead('owner-user', feature, 'workspace-1', undefined)).toBe(false)
    })

    it('denies access to shared-scoped features (deferred to a future release)', () => {
        const feature = makeFeature({ scope: 'shared', scopeOwnerId: 'org-1' })
        expect(canRead('owner-user', feature, 'workspace-1', 'org-1')).toBe(false)
    })
})
