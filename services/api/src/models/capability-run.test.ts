'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { updateCapabilityRunStatus } from './capability-run.ts'

describe('Capability run persistence', () => {
    const updateItem = vi.fn()

    beforeEach(() => {
        updateItem.mockReset()
        updateItem.mockResolvedValue(undefined)
        ;(globalThis as any).dynamoDBService = { updateItem }
    })

    it('passes every expected status placeholder into the conditional update', async () => {
        await updateCapabilityRunStatus({
            runId: 'run-1',
            workspaceId: 'workspace-1',
            expectedStatuses: ['pending', 'running'],
            status: 'running',
            currentStepIds: ['validate-request'],
        })

        expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { runId: 'run-1', workspaceId: 'workspace-1' },
            conditionExpression: '#status IN (:expectedStatus0, :expectedStatus1)',
            expressionAttributeNames: { '#status': 'status' },
            expressionAttributeValues: {
                ':expectedStatus0': 'pending',
                ':expectedStatus1': 'running',
            },
            updates: expect.objectContaining({
                status: 'running',
                currentStepIds: ['validate-request'],
            }),
        }))
    })

    it('rejects an update without an expected status guard', async () => {
        await expect(updateCapabilityRunStatus({
            runId: 'run-1',
            workspaceId: 'workspace-1',
            expectedStatuses: [],
            status: 'failed',
        })).rejects.toThrow('EXPECTED_RUN_STATUS_REQUIRED')

        expect(updateItem).not.toHaveBeenCalled()
    })
})
