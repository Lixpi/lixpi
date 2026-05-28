'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExtractionRun from './extraction-run.ts'

// The model references a global `dynamoDBService` (set on the server at boot).
// Tests inject a mock so the scan/filter/sort/delete logic can be exercised in isolation.
const dynamo = {
    putItem: vi.fn(),
    getItem: vi.fn(),
    scanItems: vi.fn(),
    deleteItems: vi.fn(),
    updateItem: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
})

// =============================================================================
// createRun — pre-submit snapshot persistence
// =============================================================================

describe('ExtractionRun.createRun', () => {
    it('persists the provided id, status pending, and the source-context snapshot', async () => {
        dynamo.putItem.mockResolvedValue(undefined)
        const snapshot = { imageNatsUrl: 'nats-obj://ws/file', contextMessages: [] }

        const run = await ExtractionRun.createRun({
            extractionRunId: 'run-1',
            workspaceId: 'ws-1',
            userId: 'user-1',
            sourceContextSnapshot: snapshot,
        })

        expect(run).toMatchObject({
            extractionRunId: 'run-1',
            workspaceId: 'ws-1',
            userId: 'user-1',
            status: 'pending',
            sourceContextSnapshot: snapshot,
        })
        expect(run?.createdAt).toEqual(expect.any(Number))
        expect(dynamo.putItem).toHaveBeenCalledWith(expect.objectContaining({
            item: expect.objectContaining({ extractionRunId: 'run-1', sourceContextSnapshot: snapshot }),
            origin: 'ExtractionRun.createRun',
        }))
    })

    it('omits the snapshot key entirely when none is provided', async () => {
        dynamo.putItem.mockResolvedValue(undefined)

        const run = await ExtractionRun.createRun({ extractionRunId: 'run-2', workspaceId: 'ws-1', userId: 'user-1' })

        expect(run).toBeDefined()
        expect(Object.hasOwn(run as object, 'sourceContextSnapshot')).toBe(false)
    })
})

// =============================================================================
// listWorkspaceRuns / deleteWorkspaceRuns — scan + filter + sort
// =============================================================================

describe('ExtractionRun workspace listing and cleanup', () => {
    const runs = [
        { extractionRunId: 'a', workspaceId: 'ws-1', updatedAt: 200 },
        { extractionRunId: 'b', workspaceId: 'ws-2', updatedAt: 999 },
        { extractionRunId: 'c', workspaceId: 'ws-1', updatedAt: 500 },
    ]

    it('lists only the workspace runs, most-recent first', async () => {
        dynamo.scanItems.mockResolvedValue({ items: runs })

        const result = await ExtractionRun.listWorkspaceRuns({ workspaceId: 'ws-1' })

        expect(result.map((r) => r.extractionRunId)).toEqual(['c', 'a'])
    })

    it('returns an empty list when the scan yields nothing', async () => {
        dynamo.scanItems.mockResolvedValue({ items: [] })
        expect(await ExtractionRun.listWorkspaceRuns({ workspaceId: 'ws-1' })).toEqual([])
    })

    it('deletes only the matching-workspace runs and returns the count', async () => {
        dynamo.scanItems.mockResolvedValue({ items: runs })
        dynamo.deleteItems.mockResolvedValue(undefined)

        const deleted = await ExtractionRun.deleteWorkspaceRuns({ workspaceId: 'ws-1' })

        expect(deleted).toBe(2)
        expect(dynamo.deleteItems).toHaveBeenCalledTimes(2)
        expect(dynamo.deleteItems).toHaveBeenCalledWith(expect.objectContaining({
            key: { extractionRunId: 'a', workspaceId: 'ws-1' },
        }))
        expect(dynamo.deleteItems).toHaveBeenCalledWith(expect.objectContaining({
            key: { extractionRunId: 'c', workspaceId: 'ws-1' },
        }))
    })
})

// =============================================================================
// deleteRun — single record, composite key
// =============================================================================

describe('ExtractionRun.deleteRun', () => {
    it('deletes a single run by composite key', async () => {
        dynamo.deleteItems.mockResolvedValue(undefined)

        await ExtractionRun.deleteRun({ extractionRunId: 'run-1', workspaceId: 'ws-1' })

        expect(dynamo.deleteItems).toHaveBeenCalledWith(expect.objectContaining({
            key: { extractionRunId: 'run-1', workspaceId: 'ws-1' },
            origin: 'ExtractionRun.deleteRun',
        }))
    })
})

// =============================================================================
// markComplete — featureId reference without cascade
// =============================================================================

describe('ExtractionRun.markComplete', () => {
    it('records the resulting featureId as a one-way reference', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await ExtractionRun.markComplete({ extractionRunId: 'run-1', workspaceId: 'ws-1', featureId: 'feature-7' })

        expect(dynamo.updateItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { extractionRunId: 'run-1', workspaceId: 'ws-1' },
            updates: expect.objectContaining({ status: 'completed', featureId: 'feature-7' }),
        }))
    })
})
