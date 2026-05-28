'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
    },
    extractionRun: {
        listWorkspaceRuns: vi.fn(),
        deleteRun: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn() }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/extraction-run.ts', () => ({ default: mocks.extractionRun }))
vi.mock('../../models/ai-model.ts', () => ({ default: {} }))

import { extractionSubjects } from './extraction-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT
const getHandler = (subject: string) =>
    extractionSubjects.find((subscription) => subscription.subject === subject)!.handler

describe('Feature extraction session history', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
    })

    it('lists persisted extraction runs for a workspace member', async () => {
        const runs = [{ extractionRunId: 'run-1', workspaceId: 'workspace-1' }]
        mocks.extractionRun.listWorkspaceRuns.mockResolvedValueOnce(runs)

        const result = await getHandler(SUBJECTS.LIST_BY_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
        })

        expect(result).toEqual(runs)
    })

    it('deletes only the extraction run record', async () => {
        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })

        expect(mocks.extractionRun.deleteRun).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            extractionRunId: 'run-1',
        })
        expect(result).toEqual({ success: true, extractionRunId: 'run-1' })
    })
})
