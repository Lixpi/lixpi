'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
        deleteContextRegion: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({ default: { getInstance: vi.fn() } }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/document.ts', () => ({ default: {} }))
vi.mock('../../models/feature.ts', () => ({ default: {} }))
vi.mock('../../models/media-library-item.ts', () => ({ default: {} }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: {} }))
vi.mock('../../models/extraction-run.ts', () => ({ default: {} }))
vi.mock('../../services/media-library-storage.ts', () => ({
    deleteLibraryImageObject: vi.fn(),
    deleteMediaLibraryWorkspaceBucket: vi.fn(),
}))
vi.mock('../../services/feature-sample-storage.ts', () => ({
    ensureFeatureSamplesForScope: vi.fn(),
}))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) =>
    workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

describe('Context-region owned chat deletion', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            canvasState: { nodes: [], edges: [] },
        })
        mocks.workspace.deleteContextRegion.mockResolvedValue({ nodes: [], edges: [] })
    })

    it('delegates region deletion to the atomic canvas-and-history model operation', async () => {
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_CONTEXT_REGION)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            contextRegionNodeId: 'region-1',
        })

        expect(mocks.workspace.deleteContextRegion).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            contextRegionNodeId: 'region-1',
            canvasState: { nodes: [], edges: [] },
        })
        expect(result).toEqual({
            success: true,
            workspaceId: 'workspace-1',
            canvasState: { nodes: [], edges: [] },
        })
    })
})
