import {
    AuthenticationFailure,
    type AuthClientInstance,
    type AuthClientSession,
} from '@lixpi/auth-client'
import { AuthPanel } from '@lixpi/ui-kit/components/auth-panel'
import { createWorkspaceLoadingLayer } from '@lixpi/canvas-components-lixpi-specific/frontend/loading'
import {
    type LoadingLayer,
    type LoadingLease,
} from '@lixpi/canvas-components/loading'
import { lixpiLogo } from '@lixpi/ui-kit/svg'
import {
    type WebClientServiceInstance,
} from '@lixpi/web-client-service-factory'
import { settings } from './settings.ts'

type WorkspaceConfig = {
    loadingLayer: LoadingLayer
    auth: AuthClientInstance
    session: AuthClientSession
    onAuthRequired: () => void
    onReady: () => void
    onError: (error: unknown) => void
}

type StartupConfig = {
    auth: AuthClientInstance
    target: HTMLElement
    loadWorkspace: (config: WorkspaceConfig) => Promise<WebClientServiceInstance>
}

// Keep the public entry responsive while authentication and private workspace
// modules load. Neither a token request nor editor imports gate the first view.
export class WebUiStartup {
    private readonly signIn: AuthenticationFailure
    private panel?: AuthPanel
    private loading?: LoadingLease
    private loadingLayer?: LoadingLayer
    private application?: WebClientServiceInstance
    private startup?: Promise<void>
    private destroyed = false

    constructor(private readonly config: StartupConfig) {
        this.signIn = new AuthenticationFailure(() => config.auth.login(true))
    }

    start(): Promise<void> {
        this.startup ??= this.initialize()

        return this.startup
    }

    private async initialize(): Promise<void> {
        this.loadingLayer = createWorkspaceLoadingLayer({
            paneEl: this.config.target,
            settings,
        })
        this.loading = this.loadingLayer.acquire({
            label: 'Loading Lixpi',
            visible: true,
        })
        let session: AuthClientSession | null

        try {
            session = await this.config.auth.initializeSession()
        } catch {
            this.showSignIn(true)

            return
        }

        if (this.destroyed)
            return

        if (!session) {
            this.showSignIn()

            return
        }

        try {
            const application = await this.config.loadWorkspace({
                loadingLayer: this.loadingLayer,
                auth: this.config.auth,
                session,
                onAuthRequired: () => this.showSignIn(true),
                onReady: () => this.clearView(),
                onError: error => this.showWorkspaceError(error),
            })

            if (this.destroyed) {
                await application.destroy()

                return
            }

            this.application = application
            await application.start()
        } catch (error) {
            this.showWorkspaceError(error)
        }
    }

    private clearView(): void {
        this.signIn.destroy()
        this.loading?.destroy()
        this.loading = undefined
        this.panel?.destroy()
        this.panel = undefined
    }

    private showSignIn(failed = false): void {
        if (
            this.destroyed
            || this.config.auth.authStore.getMeta('isRedirecting')
        )
            return

        this.clearView()
        this.signIn.show(this.config.target, failed)
    }

    private showWorkspaceError(error: unknown): void {
        if (this.destroyed)
            return

        console.error('Workspace startup failed:', error instanceof Error ? error.message : 'Unknown startup error')
        this.clearView()
        this.panel = new AuthPanel({
            brand: 'Lixpi',
            logo: lixpiLogo,
            title: 'Your workspace could not load',
            description: 'Please try loading your workspace again.',
            actions: [{
                label: 'Try again',
                onClick: () => window.location.reload(),
            }],
        })
        this.config.target.replaceChildren(this.panel.dom)
    }

    async destroy(): Promise<void> {
        this.destroyed = true
        this.clearView()
        await this.application?.destroy()
        this.loadingLayer?.destroy()
    }
}
