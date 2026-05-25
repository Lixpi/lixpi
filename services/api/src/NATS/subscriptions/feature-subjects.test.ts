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
    },
    feature: {
        createFeature: vi.fn(),
        getFeature: vi.fn(),
        getOwnedFeature: vi.fn(),
        listByScope: vi.fn(),
        updateFeature: vi.fn(),
        deleteFeature: vi.fn(),
        changeScope: vi.fn(),
        incrementReportCount: vi.fn(),
    },
    ensureFeatureSamplesForScope: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ publish: mocks.publish }),
    },
}))

vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../models/feature.ts', () => ({ default: mocks.feature }))
vi.mock('../../services/feature-sample-storage.ts', () => ({
    ensureFeatureSamplesForScope: mocks.ensureFeatureSamplesForScope,
}))

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
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
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

describe('Feature NATS authorization and sample durability', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.organization.getOrganization.mockResolvedValue({ organizationId: 'organization-1' })
        mocks.feature.getOwnedFeature.mockResolvedValue(feature)
        mocks.feature.changeScope.mockResolvedValue({ ...feature, scope: 'user', scopeOwnerId: 'user-1' })
        mocks.ensureFeatureSamplesForScope.mockResolvedValue(undefined)
    })

    it('derives promoted ownership from the authenticated user and copies samples before metadata', async () => {
        const result = await getHandler(SUBJECTS.CHANGE_SCOPE)({
            user: { userId: 'user-1' },
            featureId: feature.featureId,
            workspaceId: 'workspace-1',
            newScope: 'user',
            newScopeOwnerId: 'attacker-owner',
        })

        expect(mocks.ensureFeatureSamplesForScope).toHaveBeenCalledWith({
            feature,
            newScope: 'user',
            newScopeOwnerId: 'user-1',
        })
        expect(mocks.feature.changeScope).toHaveBeenCalledWith({
            feature,
            newScope: 'user',
            newScopeOwnerId: 'user-1',
        })
        expect(mocks.ensureFeatureSamplesForScope.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.feature.changeScope.mock.invocationCallOrder[0])
        expect(result).toEqual(expect.objectContaining({ success: true, newScopeOwnerId: 'user-1' }))
    })

    it('does not delete a feature unless the authenticated user owns it', async () => {
        mocks.feature.getOwnedFeature.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-2' },
            featureId: feature.featureId,
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.feature.deleteFeature).not.toHaveBeenCalled()
    })

    it('does not list workspace features when workspace membership validation fails', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(SUBJECTS.LIST_BY_SCOPE)({
            user: { userId: 'user-2' },
            workspaceId: 'workspace-1',
            scope: 'workspace',
        })

        expect(result).toEqual({ items: [] })
        expect(mocks.feature.listByScope).not.toHaveBeenCalled()
    })

    it('reports only accessible public features', async () => {
        mocks.feature.getFeature.mockResolvedValueOnce(feature)

        const result = await getHandler(SUBJECTS.REPORT_ABUSE)({
            user: { userId: 'user-2' },
            featureId: feature.featureId,
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.feature.incrementReportCount).not.toHaveBeenCalled()
    })
})
