'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS, type Feature } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    publish: vi.fn(),
    workspace: {
        getWorkspace: vi.fn(),
    },
    organization: {
        getOrganization: vi.fn(),
        getUserOrganizations: vi.fn(),
    },
    feature: {
        createFeature: vi.fn(),
        getFeature: vi.fn(),
        getOwnedFeature: vi.fn(),
        listByScope: vi.fn(),
        updateFeature: vi.fn(),
        deleteFeature: vi.fn(),
    },
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ publish: mocks.publish }),
    },
}))

vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../models/feature.ts', () => ({ default: mocks.feature }))

import { featureSubjects } from './feature-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS

const getHandler = (subject: string) =>
    featureSubjects.find((subscription) => subscription.subject === subject)!.handler

const feature: Feature = {
    featureId: 'feature-1',
    version: 1,
    category: 'illustration-style',
    name: 'painted-light',
    summary: 'Soft painted illumination.',
    tags: ['painted'],
    instructions: 'Keep edges soft.',
    parameters: {},
    sampleImages: [{ idx: 0, subject: 'sample', ext: 'png', fileId: 'feature/sample.png' }],
    scope: 'organization',
    scopeOwnerId: 'organization-1',
    status: 'active',
    ownerUserId: 'user-1',
    workspaceId: 'workspace-1',
    sourceContext: {
        extractionRunId: 'run-1',
        sourceWorkspaceId: 'workspace-1',
    },
    reportCount: 0,
    createdAt: 1,
    updatedAt: 1,
}

describe('Feature NATS authorization', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.organization.getOrganization.mockResolvedValue({ organizationId: 'organization-1' })
        // Org is resolved server-side from the user, not taken from the client payload.
        mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.feature.getFeature.mockResolvedValue(feature)
    })

    it('lets any member of the owning organization delete a feature', async () => {
        // A different user (user-2) who belongs to the same org can delete.
        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-2' },
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            featureId: feature.featureId,
        })

        expect(mocks.feature.deleteFeature).toHaveBeenCalledWith({ featureId: feature.featureId })
        expect(mocks.publish).toHaveBeenCalledWith(SUBJECTS.EVENTS.DELETED, { type: 'deleted', featureId: feature.featureId })
        expect(result).toEqual({ success: true, featureId: feature.featureId })
    })

    it('does not delete a feature the requester cannot read (other org)', async () => {
        mocks.feature.getFeature.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-2' },
            workspaceId: 'workspace-1',
            organizationId: 'organization-2',
            featureId: feature.featureId,
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.feature.deleteFeature).not.toHaveBeenCalled()
    })

    it('does not list features for an unsupported scope', async () => {
        const result = await getHandler(SUBJECTS.LIST_BY_SCOPE)({
            user: { userId: 'user-2' },
            organizationId: 'organization-1',
            scope: 'workspace',
        })

        expect(result).toEqual({ items: [] })
        expect(mocks.feature.listByScope).not.toHaveBeenCalled()
    })

    it('does not list organization features when the user has no organization', async () => {
        mocks.organization.getUserOrganizations.mockResolvedValueOnce([])

        const result = await getHandler(SUBJECTS.LIST_BY_SCOPE)({
            user: { userId: 'user-2' },
            scope: 'organization',
        })

        expect(result).toEqual({ items: [] })
        expect(mocks.feature.listByScope).not.toHaveBeenCalled()
    })
})
