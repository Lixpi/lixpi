'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingStatus, NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => {
    const workspaceData: { updatedAt: number; canvasStateUpdatedAt?: number } = { updatedAt: 10, canvasStateUpdatedAt: 5 }
    let routeWorkspaceId = 'workspace-1'

    return {
        workspaceData,
        routeWorkspaceId,
        request: vi.fn(),
        getTokenSilently: vi.fn(),
        setDataValues: vi.fn((values: Record<string, any>) => {
            if (typeof values.updatedAt === 'number') {
                workspaceData.updatedAt = values.updatedAt
            }
            if (typeof values.canvasStateUpdatedAt === 'number') {
                workspaceData.canvasStateUpdatedAt = values.canvasStateUpdatedAt
            }
        }),
        setMetaValues: vi.fn(),
        beginWorkspaceLoad: vi.fn(),
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
        getRouteParams: vi.fn(() => ({ workspaceId: mocks.routeWorkspaceId })),
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
        beginWorkspaceLoad: mocks.beginWorkspaceLoad,
    },
}))

vi.mock('$src/stores/workspacesStore.ts', () => ({
    workspacesStore: {
        updateWorkspace: mocks.updateWorkspace,
    },
}))

import WorkspaceService from './workspace-service.ts'
import { WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS } from './requestTimeouts.ts'

const makeCanvasState = (nodeId: string) => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ nodeId, type: 'image', fileId: `${nodeId}-file` }],
    edges: [],
} as any)

// =============================================================================
// CANVAS SAVE QUEUE
// =============================================================================

describe('WorkspaceService canvas save queue', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.request.mockReset()
        mocks.getTokenSilently.mockReset()
        mocks.workspaceData.updatedAt = 10
        mocks.workspaceData.canvasStateUpdatedAt = 5
        mocks.routeWorkspaceId = 'workspace-1'
        mocks.getTokenSilently.mockResolvedValue('token-1')
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
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

        resolveFirstSave?.({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })

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

    it('forwards persistViewport across stale retry and preserves it on queued follow-up saves', async () => {
        let resolveFirstSave: ((value: unknown) => void) | null = null
        mocks.request
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSave = resolve }))
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 12, canvasStateUpdatedAt: 7 })

        const service = new WorkspaceService()
        const firstState = makeCanvasState('persisted-node')
        const secondState = makeCanvasState('queued-node')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: firstState, persistViewport: true })
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: secondState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        expect(mocks.request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            canvasState: firstState,
            persistViewport: true,
            expectedCanvasStateUpdatedAt: 5,
        }))

        resolveFirstSave?.({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(3)
        })
        expect(mocks.request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            canvasState: secondState,
            persistViewport: true,
            expectedCanvasStateUpdatedAt: 6,
        }))
        expect(mocks.request.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
            canvasState: secondState,
            persistViewport: true,
            expectedCanvasStateUpdatedAt: 6,
        }))
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

    it('refreshes the current workspace when the server reports stale canvas state', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE' })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('stale-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        await vi.waitFor(() => {
            expect(getWorkspaceSpy).toHaveBeenCalledTimes(1)
        })
        expect(getWorkspaceSpy).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
    })

    it('does not refetch the workspace when stale canvas state belongs to a different route', async () => {
        mocks.routeWorkspaceId = 'workspace-2'
        mocks.request.mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE' })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('stale-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        expect(getWorkspaceSpy).not.toHaveBeenCalled()
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
    })

    it('does not include an optimistic canvas save token when none is available', async () => {
        mocks.workspaceData.updatedAt = Number.NaN
        mocks.workspaceData.canvasStateUpdatedAt = undefined
        mocks.request.mockResolvedValueOnce({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: 12,
            canvasStateUpdatedAt: 13,
        })

        const service = new WorkspaceService()
        const staleState = makeCanvasState('no-token')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: staleState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        expect(mocks.request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
            canvasState: staleState,
            token: 'token-1',
        }))
        expect(mocks.request.mock.calls[0]?.[1]).not.toHaveProperty('expectedCanvasStateUpdatedAt')
    })

    it('retries queued canvas updates after a non-stale error, then marks save complete on success', async () => {
        mocks.request
            .mockResolvedValueOnce({ error: 'UNAVAILABLE' })
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 20, canvasStateUpdatedAt: 19 })

        const service = new WorkspaceService()
        const stateA = makeCanvasState('state-a')
        const stateB = makeCanvasState('state-b')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: stateA })
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: stateB })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(2)
        })

        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: true })
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
        expect(mocks.setDataValues).toHaveBeenCalledWith({ updatedAt: 20 })
        expect(mocks.setDataValues).toHaveBeenCalledWith({ canvasStateUpdatedAt: 19 })
        expect(mocks.request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            canvasState: stateB,
            expectedCanvasStateUpdatedAt: 5,
        }))
    })

    // =========================================================================
    // STALE_CANVAS_STATE RETRY WITH REFRESHED TOKEN
    // =========================================================================

    it('retries a stale save with the server-supplied token instead of refetching the whole workspace', async () => {
        mocks.request
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 12, canvasStateUpdatedAt: 7 })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)
        const staleState = makeCanvasState('stale-node')

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: staleState })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(2)
        })

        expect(getWorkspaceSpy).not.toHaveBeenCalled()
        expect(mocks.request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            canvasState: staleState,
            expectedCanvasStateUpdatedAt: 6,
        }))
        expect(mocks.updateWorkspace).toHaveBeenCalledWith('workspace-1', { updatedAt: 11 })
        expect(mocks.setDataValues).toHaveBeenCalledWith({ updatedAt: 11 })
        expect(mocks.setDataValues).toHaveBeenCalledWith({ canvasStateUpdatedAt: 6 })
        await vi.waitFor(() => {
            expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
        })
    })

    it('does not retry a stale save with a refreshed token when the route no longer owns the workspace', async () => {
        mocks.routeWorkspaceId = 'workspace-2'
        mocks.request.mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('stale-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        expect(getWorkspaceSpy).not.toHaveBeenCalled()
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
    })

    it('falls back to a full workspace refetch after exhausting the stale-retry budget', async () => {
        mocks.request
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 12, currentCanvasStateUpdatedAt: 7 })
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 13, currentCanvasStateUpdatedAt: 8 })
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 14, currentCanvasStateUpdatedAt: 9 })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('stale-node') })

        await vi.waitFor(() => {
            // 1 initial attempt + 3 retries (MAX_CANVAS_SAVE_STALE_RETRIES) = 4 requests
            expect(mocks.request).toHaveBeenCalledTimes(4)
        })
        await vi.waitFor(() => {
            expect(getWorkspaceSpy).toHaveBeenCalledTimes(1)
        })
        expect(getWorkspaceSpy).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
    })

    it('does not retry with a refreshed token when the server omits currentCanvasStateUpdatedAt', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11 })

        const service = new WorkspaceService()
        const getWorkspaceSpy = vi.spyOn(service as unknown as { getWorkspace: (args: { workspaceId: string }) => Promise<void> }, 'getWorkspace')
            .mockResolvedValue(undefined)

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('stale-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(1)
        })
        await vi.waitFor(() => {
            expect(getWorkspaceSpy).toHaveBeenCalledTimes(1)
        })
    })

    it('resets the stale-retry budget once a subsequent save succeeds', async () => {
        mocks.request
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 11, currentCanvasStateUpdatedAt: 6 })
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 12, canvasStateUpdatedAt: 7 })

        const service = new WorkspaceService()
        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('first-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(2)
        })
        await vi.waitFor(() => {
            expect(mocks.setMetaValues).toHaveBeenCalledWith({ requiresSave: false })
        })

        mocks.request.mockClear()
        mocks.request
            .mockResolvedValueOnce({ error: 'STALE_CANVAS_STATE', currentUpdatedAt: 21, currentCanvasStateUpdatedAt: 20 })
            .mockResolvedValueOnce({ success: true, workspaceId: 'workspace-1', updatedAt: 22, canvasStateUpdatedAt: 21 })

        service.updateCanvasState({ workspaceId: 'workspace-1', canvasState: makeCanvasState('second-node') })

        await vi.waitFor(() => {
            expect(mocks.request).toHaveBeenCalledTimes(2)
        })
        expect(mocks.request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            expectedCanvasStateUpdatedAt: 20,
        }))
    })
})

describe('WorkspaceService state loading', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.request.mockReset()
        mocks.getTokenSilently.mockReset()
        mocks.workspaceData.updatedAt = 10
        mocks.workspaceData.canvasStateUpdatedAt = 5
        mocks.routeWorkspaceId = 'workspace-1'
        mocks.getTokenSilently.mockResolvedValue('token-1')
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('loads workspace data and normalizes missing canvas state edges', async () => {
        const service = new WorkspaceService()
        mocks.request.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            name: 'Project',
            updatedAt: 10,
            canvasState: {
                nodes: [{ nodeId: 'n1', type: 'image' }],
                dimensions: { width: 100, height: 100 },
            },
        })

        await service.getWorkspace({ workspaceId: 'workspace-1' })

        expect(mocks.beginWorkspaceLoad).toHaveBeenCalledWith('workspace-1')
        expect(mocks.request).toHaveBeenCalledWith(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, {
            token: 'token-1',
            workspaceId: 'workspace-1',
        }, WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS)
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })
        expect(mocks.setDataValues).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: expect.objectContaining({
                edges: [],
            }),
        }))
    })

    it('does nothing with workspace payload when the active route changed', async () => {
        mocks.routeWorkspaceId = 'other-workspace'
        const service = new WorkspaceService()
        mocks.request.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            updatedAt: 10,
            canvasState: { nodes: [], edges: [] },
        })

        await service.getWorkspace({ workspaceId: 'workspace-1' })

        expect(mocks.beginWorkspaceLoad).not.toHaveBeenCalled()
        expect(mocks.setMetaValues).not.toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })
        expect(mocks.setDataValues).not.toHaveBeenCalled()
    })

    it('keeps stale canvas cleared when the active workspace load times out', async () => {
        const timeout = new Error('timeout')
        const service = new WorkspaceService()
        mocks.request.mockRejectedValueOnce(timeout)

        await service.getWorkspace({ workspaceId: 'workspace-1' })

        expect(mocks.beginWorkspaceLoad).toHaveBeenCalledWith('workspace-1')
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.error })
        expect(mocks.setDataValues).toHaveBeenCalledWith({ error: timeout })
        expect(mocks.setDataValues).not.toHaveBeenCalledWith(expect.objectContaining({
            canvasState: expect.objectContaining({
                nodes: expect.arrayContaining([expect.anything()]),
            }),
        }))
    })
})
