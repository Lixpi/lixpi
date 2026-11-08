import { lixpiPalette as colorPalette } from '@lixpi/themes'
import {
    WorkspaceCanvasSurface,
    createWorkspaceCanvas,
} from '@lixpi/canvas-components/workspace'
import {
    uploadCanvasAsset,
    importCanvasAssetUrl,
} from '$src/canvas-adapters/asset-ingest.ts'
import {
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import { createWorkspaceCanvasHost } from '$src/canvas-adapters/workspace-canvas-host.ts'
import {
    type AssetService,
} from '$src/services/asset-service.ts'
import {
    bindCanvasTheme,
    type CanvasThemeSource,
} from '@lixpi/canvas-components/theme'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { initializeCanvasThemeStore } from '$src/canvas-adapters/canvas-theme.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { settings } from '@lixpi/canvas-components/workspace/settings'
import '@lixpi/canvas-components/styles/workspace'
import '$src/canvas-adapters/workspace-theme.scss'
import '@lixpi/canvas-components/styles/workspace/library-panels'

export type WorkspaceCanvasViewInstance = {
    el: HTMLElement
    destroy: () => void
}

export type WorkspaceCanvasViewConfig = {
    assetService: AssetService
    auth: AuthClientInstance
    router: WebClientRouterService
    theme?: CanvasThemeSource
}

class WorkspaceCanvasView implements WorkspaceCanvasViewInstance {
    readonly el: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private readonly connectionObserver: MutationObserver
    private mounted = false

    constructor(private readonly config: WorkspaceCanvasViewConfig) {
        const html = createDocumentHtml(document)
        this.el = html`<div className="workspace-canvas-host"></div>` as HTMLDivElement

        this.lifetime.own(() => this.el.remove())
        this.connectionObserver = new MutationObserver(this.mountWhenConnected)
        this.lifetime.own(() => this.connectionObserver.disconnect())
        this.connectionObserver.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,
            },
        )
        this.mountWhenConnected()
    }

    private mountWhenConnected = (): void => {
        if (
            this.mounted
            || this.lifetime.signal.aborted
            || !this.el.isConnected
        )
            return

        this.mounted = true
        this.connectionObserver.disconnect()

        try {
            const theme = this.config.theme ?? initializeCanvasThemeStore(this.el)
            this.lifetime.own(
                bindCanvasTheme(this.el, theme),
            )
            const surface = this.createSurface(theme)
            this.lifetime.own(() => surface.destroy())
            this.el.append(surface.el)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private createSurface(theme: CanvasThemeSource): WorkspaceCanvasSurface {
        const {
            assetService,
            auth,
            router,
        } = this.config

        return new WorkspaceCanvasSurface(
            {
                panel: settings.rightSidePanel,
                modelMenuHoverBackground: settings.aiPromptInput.modelMenu.styles.triggerActiveBackground,
                palette: colorPalette,
                insertionWidth: settings.mediaNode.image.defaultInsertionWidth,
            },
            {
                document,
                readSnapshot: () => ({
                    workspaceId: String(router.getCurrentRoute().routeParams.workspaceId ?? ''),
                    loadedWorkspaceId: workspaceStore.getData('workspaceId'),
                    organizationId: String(workspaceStore.getData('organizationId') ?? ''),
                    loadingStatus: workspaceStore.getMeta('loadingStatus'),
                    canvasState: workspaceStore.getData('canvasState'),
                    assets: assetsStore.getAll(),
                }),
                readDocument: (assetId, role) => assetDocumentsStore.get(assetId, role)?.doc,
                subscriptions: [
                    changed => router.subscribe(changed),
                    changed => workspaceStore.subscribe(changed),
                    changed => assetsStore.subscribe(changed),
                    changed => assetDocumentsStore.subscribe(changed),
                ],
                session: workspaceId => {
                    const sessions = servicesStore.getData('workspaceService')?.canvasSessions

                    if (!sessions)
                        throw new Error('CANVAS_WRITE_COORDINATOR_UNAVAILABLE')

                    return sessions.get(workspaceId)
                },
                membership: {
                    attach: request => assetService.attach(request),
                    detach: request => assetService.detach(request),
                    now: Date.now,
                },
                ingest: {
                    createDocument: request => assetService.create({
                        ...request,
                        primaryCategory: 'document',
                    }),
                    uploadFile: request => uploadCanvasAsset(auth, request),
                    importUrl: request => importCanvasAssetUrl(auth, request),
                    refreshAsset: async (assetId, workspaceId) => {
                        const result = await assetService.refresh(assetId, workspaceId)

                        return 'error' in result ? result : {}
                    },
                },
                createId: () => crypto.randomUUID(),
                now: Date.now,
                publishTransient: (workspaceId, state) => {
                    if (
                        router.getCurrentRoute().routeParams.workspaceId !== workspaceId
                        || workspaceStore.getData('workspaceId') !== workspaceId
                    )
                        return

                    workspaceStore.updateCanvasState(state)
                },
                synchronizeAssets: workspaceId => assetService.startWorkspaceSynchronization(workspaceId),
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
                createRenderer: options => createWorkspaceCanvas(
                    options,
                    createWorkspaceCanvasHost({
                        assetService,
                        auth,
                        theme,
                    }),
                ),
                reportError: (message, error) => console.error(message, error),
            },
        )
    }

    destroy = (): void => void this.lifetime.destroy()
}

export const createWorkspaceCanvasView = (config: WorkspaceCanvasViewConfig): WorkspaceCanvasViewInstance => new WorkspaceCanvasView(config)
