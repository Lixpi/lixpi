import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import routerService from '$src/services/router-service.ts'
import { routerStore } from '$src/stores/routerStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'

type Deferred = {
    promise: Promise<void>
    resolve: () => void
}

function createDeferred(): Deferred {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve()
    }
}

// =============================================================================
// ROUTE DATA LOADER RACES
// =============================================================================

describe('RouterService — route data loader races', () => {
    const workspaceLoads = new Map<string, Deferred>()
    const getWorkspace = vi.fn(({ workspaceId }: { workspaceId: string }) => {
        const deferred = createDeferred()
        workspaceLoads.set(workspaceId, deferred)
        return deferred.promise
    })
    const loadWorkspaceAssets = vi.fn(async () => undefined)

    beforeEach(() => {
        workspaceLoads.clear()
        getWorkspace.mockClear()
        loadWorkspaceAssets.mockClear()
        routerStore.resetStore()
        servicesStore.resetStore()
        servicesStore.setDataValues({
            workspaceService: { getWorkspace },
            assetService: { loadWorkspaceAssets },
        })
    })

    afterEach(() => {
        routerService.destroy()
    })

    it('does not let a stale workspace load mark the active newer route as fetched', async () => {
        routerService.navigateTo('/workspace/:workspaceId', {
            params: { workspaceId: 'workspace-slow' },
            shouldFetchData: true,
        })
        routerService.navigateTo('/workspace/:workspaceId', {
            params: { workspaceId: 'workspace-active' },
            shouldFetchData: true,
        })

        workspaceLoads.get('workspace-slow')?.resolve()
        await flushMicrotasks()

        expect(routerStore.getData('currentRoute').routeParams.workspaceId).toBe('workspace-active')
        expect(routerStore.getData('currentRoute').shouldFetchData).toBe(true)

        workspaceLoads.get('workspace-active')?.resolve()
        await flushMicrotasks()

        expect(routerStore.getData('currentRoute').routeParams.workspaceId).toBe('workspace-active')
        expect(routerStore.getData('currentRoute').shouldFetchData).toBe(false)
    })

    it('loads workspace assets after the workspace itself resolves', async () => {
        routerService.navigateTo('/workspace/:workspaceId', {
            params: { workspaceId: 'workspace-slow' },
            shouldFetchData: true,
        })

        expect(getWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-slow' })
        expect(loadWorkspaceAssets).not.toHaveBeenCalled()

        workspaceLoads.get('workspace-slow')?.resolve()
        await flushMicrotasks()

        expect(loadWorkspaceAssets).toHaveBeenCalledExactlyOnceWith('workspace-slow')
    })
})
