import {
    type RouteViewContext,
    type RouteViewDefinition,
} from '@lixpi/web-client-service-factory'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'

import { createIntroPage } from '$src/components/introPage/introPage.ts'
import { createWorkspaceCanvasView } from '$src/components/workspaceCanvasView/workspaceCanvasView.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { measureWorkspaceOpenAsync } from '$src/services/workspace-open-timing.ts'
import {
    type AssetService,
} from '$src/services/asset-service.ts'

export const INTRO_ROUTE_PATH = '/'
export const WORKSPACE_ROUTE_PATH = '/workspace/:workspaceId'

export type WebUiRouteContext = RouteViewContext & {
    assetService: AssetService
    auth: AuthClientInstance
}

// The asset requests start as soon as the workspace arrives, before the
// canvas renders it, so assets load while the canvas draws. An aborted load
// stops waiting at once and never applies its results.
export const loadWorkspaceRouteData = async (
    workspaceId: string,
    signal?: AbortSignal,
): Promise<void> => {
    let assets: Promise<unknown> | undefined

    await servicesStore.getData('workspaceService').getWorkspace({
        workspaceId,
        signal,
        beforePublish: ({ canvasState }) => {
            // A failure after the load was abandoned has no one to report to.
            assets = (async () => {
                try {
                    await measureWorkspaceOpenAsync(
                        'assets',
                        workspaceId,
                        async () => await servicesStore.getData('assetService').loadWorkspaceAssets(
                            workspaceId,
                            () => !signal?.aborted,
                            canvasState,
                        ),
                    )
                } catch (error) {
                    if (!signal?.aborted)
                        throw error
                }
            })()
        },
    })

    // An abandoned asset load stops at its next step, so waiting for it is
    // brief, and waiting keeps any earlier failure from going unobserved.
    await assets
}

export const routes: RouteViewDefinition<WebUiRouteContext>[] = [
    {
        path: INTRO_ROUTE_PATH,
        createView: () => createIntroPage(),
    },
    {
        path: WORKSPACE_ROUTE_PATH,
        createView: ({
            assetService,
            auth,
            router,
        }) => createWorkspaceCanvasView({
            assetService,
            auth,
            router,
        }),
        load: async (
            params,
            _query,
            signal,
        ) => void (await loadWorkspaceRouteData(
            String(params.workspaceId),
            signal,
        )),
    },
]

export const workspaceRouting = {
    routes,
    fallbackPath: INTRO_ROUTE_PATH,
}
