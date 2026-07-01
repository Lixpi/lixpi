'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => {
    const workspaceData: { updatedAt: number; canvasStateUpdatedAt?: number } = { updatedAt: 10, canvasStateUpdatedAt: 5 }

    return {
        workspaceData,
        request: vi.fn(),
        getTokenSilently: vi.fn(),
        setDataValues: vi.fn((values: { updatedAt?: number; canvasStateUpdatedAt?: number }) => {
            if (typeof values.updatedAt === 'number') {
                workspaceData.updatedAt = values.updatedAt
            }
            if (typeof values.canvasStateUpdatedAt === 'number') {
                workspaceData.canvasStateUpdatedAt = values.canvasStateUpdatedAt
            }
        }),
        setMetaValues: vi.fn(),
        updateWorkspace: vi.fn(),
    }
})

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: mocks.getTokenSilently,
    },
}))

vi.mock('$src/services/router-service.ts', () => ({
    default: {
        getRouteParams: vi.fn(() => ({ workspaceId: 'workspace-1' })),
    },
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: vi.fn((key: string) => {
            if (key === 'nats') return { request: mocks.request }
            return null
        }),
    },
}))

vi.mock('$src/stores/workspaceStore.ts', () => ({
    workspaceStore: {
        getData: vi.fn((key: string) => {
            if (key === 'updatedAt') return mocks.workspaceData.updatedAt
            if (key === 'canvasStateUpdatedAt') return mocks.workspaceData.canvasStateUpdatedAt
            return undefined
        }),
        setDataValues: mocks.setDataValues,
        setMetaValues: mocks.setMetaValues,
    },
}))

vi.mock('$src/stores/workspacesStore.ts', () => ({
    workspacesStore: {
        updateWorkspace: mocks.updateWorkspace,
    },
}))

import WorkspaceService from './workspace-service.ts'

const makeCanvasState = (nodeId: string) => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ nodeId, type: 'image', fileId: `${nodeId}-file` }],
    edges: [],
} as any)

// =============================================================================
// CANVAS SAVE QUEUE
// =============================================================================

describe('WorkspaceService canvas save queue', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspaceData.updatedAt = 10
        mocks.workspaceData.canvasStateUpdatedAt = 5
        mocks.getTokenSilently.mockResolvedValue('token-1')
    })

    it('serializes canvas saves and sends the latest pending state with the acknowledged canvas save token', async () => {
        let resolveFirstSave: ((value: unknown) => void) | null = null
        mocks.request
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSave = resolve }))
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 12, canvasStateUpdatedAt: 7 })

        const service = new WorkspaceService()
        const firstState = makeCanvasState('first-node')
        const secondState = makeCanvasState('second-node')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: firstState })
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: secondState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        expect(mocks.request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            canvasState: firstState,
            expectedCanvasStateUpdatedAt: 5,
        }))

        resolveFirstSave?.({ success: true, workspaceId: 'workspace-1', updatedAt: 11, canvasStateUpdatedAt: 6 })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(2)
        })

        expect(mocks.request.mock.calls[1]?.[0]).toBe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)
        expect(mocks.request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            canvasState: secondState,
            expectedCanvasStateUpdatedAt: 6,
        }))
        await vi.waitFor(() => {
            expect(mocks.setDataValues).toHaveBeenCalledWith({ updatedAt: 12 })
        })
        await vi.waitFor(() => {
            expect(mocks.setDataValues).toHaveBeenCalledWith({ canvasStateUpdatedAt: 7 })
        })
    })

    it('does not use workspace updatedAt as the canvas save token after file upload changes metadata', async () => {
        mocks.workspaceData.updatedAt = 99
        mocks.workspaceData.canvasStateUpdatedAt = 5
        mocks.request.mockResolvedValueOnce({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: 100,
            canvasStateUpdatedAt: 6,
        })

        const service = new WorkspaceService()
        const uploadedImageState = makeCanvasState('uploaded-image')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: uploadedImageState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })

        expect(mocks.request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            canvasState: uploadedImageState,
            expectedCanvasStateUpdatedAt: 5,
        }))
        expect(mocks.request.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({
            expectedUpdatedAt: 99,
        }))
    })

    it('falls back to legacy updatedAt when the loaded workspace has no canvas save token', async () => {
        mocks.workspaceData.updatedAt = 10
        mocks.workspaceData.canvasStateUpdatedAt = undefined
        mocks.request.mockResolvedValueOnce({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: 12,
            canvasStateUpdatedAt: 11,
        })

        const service = new WorkspaceService()
        const firstLegacyState = makeCanvasState('legacy-upload-image')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: firstLegacyState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })

        expect(mocks.request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            canvasState: firstLegacyState,
            expectedCanvasStateUpdatedAt: 10,
        }))
        expect(mocks.request.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({
            expectedUpdatedAt: 10,
        }))
    })
})
