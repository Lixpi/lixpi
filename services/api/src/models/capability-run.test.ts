import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { cancelCapabilityRun, updateCapabilityRunStatus } from './capability-run.ts'

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
            key: {
                runId: 'run-1',
                workspaceId: 'workspace-1',
            },
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

    it('cancels only a matching owner and unfinished run without replacing existing output', async () => {
        await expect(cancelCapabilityRun({
            runId: 'run-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'owner',
        })).resolves.toBe(true)
        expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
            conditionExpression: '#owner = :owner AND #status IN (:pending, :running, :cancelled)',
            expressionAttributeValues: expect.objectContaining({ ':owner': 'owner' }),
            updates: {
                status: 'cancelled',
                currentStepIds: [],
                updatedAt: expect.any(Number),
            },
        }))
        updateItem.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
        await expect(cancelCapabilityRun({
            runId: 'run-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'owner',
        })).resolves.toBe(false)
        updateItem.mockRejectedValueOnce(new Error('database unavailable'))
        await expect(cancelCapabilityRun({
            runId: 'run-1',
            workspaceId: 'workspace-1',
            ownerUserId: 'owner',
        })).rejects.toThrow('database unavailable')
    })
})
