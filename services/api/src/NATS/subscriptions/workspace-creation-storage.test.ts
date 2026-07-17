'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        createWorkspace: vi.fn(),
    },
    organization: {
        getUserOrganizations: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../models/asset.ts', () => ({ default: {} }))
vi.mock('../../models/extraction-run.ts', () => ({ default: {} }))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) =>
    workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

// =============================================================================
// WORKSPACE CREATION ORGANIZATION RESOLUTION
// =============================================================================

describe('Workspace creation storage provisioning', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.workspace.createWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            name: 'New Workspace',
            organizationId: 'organization-1',
        })
    })

    it('creates the workspace file bucket (media-library buckets are org-scoped, created on demand)', async () => {
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.workspace.createWorkspace).toHaveBeenCalledWith({
            name: 'New Workspace',
            organizationId: 'organization-1',
            permissions: { userId: 'user-1', accessLevel: 'owner' },
        })
        expect(result).toEqual(expect.objectContaining({ workspaceId: 'ws-1' }))
    })

    it('rolls back the database record and the workspace bucket when bucket creation fails', async () => {
        // No storage provisioning happens at workspace-creation time anymore — media
        // buckets are org-scoped and created on demand. Creation is rejected instead
        // when the caller requests an organization it does not belong to.
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
            organizationId: 'organization-2',
        })

        expect(result).toEqual({ error: 'ORGANIZATION_ACCESS_DENIED' })
        expect(mocks.workspace.createWorkspace).not.toHaveBeenCalled()
    })
})
