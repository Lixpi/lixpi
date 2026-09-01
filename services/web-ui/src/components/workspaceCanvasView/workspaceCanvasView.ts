import {
    WorkspaceCanvasSurface,
    createWorkspaceCanvas,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    uploadCanvasAsset,
    importCanvasAssetUrl,
} from '$src/canvas-adapters/asset-ingest.ts'
import { createWorkspaceCanvasHost } from '$src/canvas-adapters/workspace-canvas-host.ts'
import AssetService from '$src/services/asset-service.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { routerStore } from '$src/stores/routerStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import {
    settings,
    colorPalette,
} from '$src/settings.ts'
import '@lixpi/canvas-components-lixpi-specific/styles/workspace'
import '$src/canvas-adapters/workspace-theme.scss'
import '@lixpi/canvas-components-lixpi-specific/styles/library-panels'

export type WorkspaceCanvasViewInstance = { el: HTMLElement; destroy: () => void }

export function createWorkspaceCanvasView(): WorkspaceCanvasViewInstance {
    const assets = new AssetService()
    return new WorkspaceCanvasSurface({
        panel: settings.rightSidePanel,
        modelMenuHoverBackground: settings.aiPromptInput.modelMenu.styles.triggerActiveBackground,
        palette: colorPalette,
        insertionWidth: settings.mediaNode.image.defaultInsertionWidth,
    }, {
        document,
        readSnapshot: () => ({
            workspaceId: String(routerStore.getData('currentRoute').routeParams.workspaceId ?? ''),
            loadedWorkspaceId: workspaceStore.getData('workspaceId'),
            organizationId: String(workspaceStore.getData('organizationId') ?? ''),
            loadingStatus: workspaceStore.getMeta('loadingStatus'),
            canvasState: workspaceStore.getData('canvasState'),
            assets: assetsStore.getAll(),
        }),
        readDocument: (assetId, role) => assetDocumentsStore.get(assetId, role)?.doc,
        subscriptions: [
            changed => routerStore.subscribe(changed),
            changed => workspaceStore.subscribe(changed),
            changed => assetsStore.subscribe(changed),
            changed => assetDocumentsStore.subscribe(changed),
        ],
        session: workspaceId => {
            const sessions = servicesStore.getData('workspaceService')?.canvasSessions
            if (!sessions) throw new Error('CANVAS_WRITE_COORDINATOR_UNAVAILABLE')
            return sessions.get(workspaceId)
        },
        membership: {
            attach: request => assets.attach(request),
            detach: request => assets.detach(request),
            now: Date.now,
        },
        ingest: {
            createDocument: request => assets.create({ ...request, primaryCategory: 'document' }),
            uploadFile: uploadCanvasAsset,
            importUrl: importCanvasAssetUrl,
            refreshAsset: async (assetId, workspaceId) => {
                const result = await assets.refresh(assetId, workspaceId)
                return 'error' in result ? result : {}
            },
        },
        createId: () => crypto.randomUUID(),
        now: Date.now,
        publishTransient: (workspaceId, state) => {
            if (routerStore.getData('currentRoute').routeParams.workspaceId !== workspaceId || workspaceStore.getData('workspaceId') !== workspaceId) return
            workspaceStore.updateCanvasState(state)
        },
        synchronizeAssets: workspaceId => assets.startWorkspaceSynchronization(workspaceId),
        storage: {
            get: key => localStorage.getItem(key),
            set: (key, value) => localStorage.setItem(key, value),
            remove: key => localStorage.removeItem(key),
        },
        setTimer: (callback, delay) => {
            const timer = setTimeout(callback, delay)
            return () => clearTimeout(timer)
        },
        onPageHide: callback => {
            window.addEventListener('pagehide', callback)
            return () => window.removeEventListener('pagehide', callback)
        },
        createRenderer: options => createWorkspaceCanvas(options, createWorkspaceCanvasHost()),
        reportError: (message, error) => console.error(message, error),
    })
}
