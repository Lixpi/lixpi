// NavigationSidePanel - the workspace tree in the shared ApplicationPanel.
//
// Renderer: TypeScript `html` DOM for the panel controls. The panel surface,
// toggle, resize handle and slide are the shared ApplicationPanel, so this
// panel looks like every other Lixpi application panel. It fills the body
// with the workspace tree and the footer with the account menu, and supplies
// the tree's ports (NATS requests, routing, confirmation, import and export,
// collapse persistence).

import {
    createWorkspaceNavigation,
    type WorkspaceNavigationHandle,
} from './workspace-navigation/create-workspace-navigation.ts'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import {
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'

import {
    type LoadingLease,
} from '@lixpi/canvas-components/loading'
import { html } from '@lixpi/ui-primitives/dom'
import {
    createApplicationPanel,
    type ApplicationPanelInstance,
} from '@lixpi/ui-kit/components/application-panel'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { bindCanvasTheme } from '@lixpi/canvas-components/theme'
import { canvasThemeStore } from '$src/canvas-adapters/canvas-theme.ts'

import { workspaceTreeStore } from '$src/stores/workspaceTreeStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { navigationSidePanelStore } from '$src/stores/navigationSidePanelStore.ts'

export type NavigationSidePanelConfig = {
    auth: Pick<AuthClientInstance, 'authStore' | 'getTokenSilently' | 'logout' | 'createSessionHandoffUrl'>
    // Content area beside the panel. The shared panel gives it
    // `--application-panel-left-inset` and
    // `--application-panel-left-dock-width` to make room.
    contentEl: HTMLElement
    // Positioned element the panel mounts into.
    containerEl: HTMLElement
    router: Pick<WebClientRouterService, 'cancelRouteLoad' | 'getCurrentRoute' | 'navigateTo' | 'subscribe'>
    userPortalUrl: string
    workspaceService: {
        getWorkspace: (input: { workspaceId: string }) => Promise<void>
    }
}

export type NavigationSidePanelInstance = {
    destroy: () => void
}

type PendingWorkspaceSwitch = {
    frame: number
    timer?: ReturnType<typeof setTimeout>
    lease?: LoadingLease
}

class NavigationSidePanel implements NavigationSidePanelInstance {
    private readonly unsubscribers: Array<() => void> = []
    private readonly navigation: WorkspaceNavigationHandle
    private readonly avatarEl: HTMLSpanElement
    private readonly accountDropdown: ReturnType<typeof createPureDropdown>
    private readonly importFileInput: HTMLInputElement
    private readonly panel: ApplicationPanelInstance
    private readonly auth: NavigationSidePanelConfig['auth']
    private readonly router: NavigationSidePanelConfig['router']
    private readonly workspaceService: NavigationSidePanelConfig['workspaceService']
    private importTargetWorkspaceId: string | null = null
    private pendingWorkspaceSwitch: PendingWorkspaceSwitch | null = null
    private signingOut = false
    private destroyed = false

    constructor(config: NavigationSidePanelConfig) {
        this.auth = config.auth
        this.router = config.router
        this.workspaceService = config.workspaceService
        this.panel = createApplicationPanel({
            container: config.containerEl,
            content: config.contentEl,
            side: 'left',
            label: 'Navigation',
            open: navigationSidePanelStore.getData().isOpen,
            loadState: () => ({ width: navigationSidePanelStore.getData().width }),
            persistState: state => navigationSidePanelStore.setValues({ width: state.width ?? null }),
            onOpenChange: open => void this.setOpen(open),
        })

        // The toggle is the same action panel as the controls beside the prompt
        // input. It mounts outside the canvas, so it takes the canvas theme's
        // paint here to look the same.
        if (this.panel.toggleElement)
            this.unsubscribers.push(
                bindCanvasTheme(this.panel.toggleElement, canvasThemeStore),
            )

        this.avatarEl = html`<span className="navigation-side-panel-avatar"></span>` as HTMLSpanElement
        this.accountDropdown = createPureDropdown({
            id: 'application-panel-account-menu',
            selectedValue: { title: '' },
            options: [
                {
                    title: 'Profile',
                    action: 'profile',
                },
                {
                    title: 'Sign out',
                    action: 'logout',
                },
            ],
            triggerContent: this.avatarEl,
            triggerLabel: 'Account',
            theme: 'dark',
            renderIconForOptions: false,
            mountToBody: true,
            onSelect: option => {
                if (option.action === 'profile')
                    window.open(
                        this.auth.createSessionHandoffUrl(config.userPortalUrl),
                        '_blank',
                        'noopener,noreferrer',
                    )
                else if (option.action === 'logout')
                    void this.signOut()
            },
        })
        this.accountDropdown.dom.classList.add('navigation-side-panel-account-menu')
        this.importFileInput = html`
            <input
                type="file"
                accept=".zip"
                className="navigation-side-panel-import-input"
            />
        ` as HTMLInputElement
        this.importFileInput.addEventListener('change', this.handleImportFileSelected)

        this.panel.footer.append(html`<div className="application-panel-footer-separator"></div>` as HTMLDivElement, this.accountDropdown.dom)
        this.panel.element.append(this.importFileInput)

        this.navigation = createWorkspaceNavigation({
            container: this.panel.body,
            store: workspaceTreeStore,
            scrollContainer: () => this.panel.body,
            ports: {
                request: async (subject, payload) => await servicesStore.getData('nats')!.request(
                    subject,
                    {
                        token: await this.auth.getTokenSilently(),
                        ...payload,
                    },
                ),
                navigate: workspaceId => this.handleWorkspaceClick(workspaceId),
                buildHref: workspaceId => `/workspace/${workspaceId}`,
                confirm: async message => window.confirm(message),
                reportError: (message, error) => console.error(message, error),
                importWorkspace: workspaceId => this.onWorkspaceImportHandler(workspaceId),
                exportWorkspace: workspaceId => void this.onWorkspaceExportHandler(workspaceId),
                collapsed: {
                    load: () => navigationSidePanelStore.getData().collapsedWorkspaceIds,
                    save: workspaceIds => navigationSidePanelStore.setValues({ collapsedWorkspaceIds: workspaceIds }),
                },
                onWorkspaceCreated: workspace => this.openWorkspace(workspace.workspaceId),
                onWorkspacesDeleted: this.handleWorkspacesDeleted,
            },
        })
        window.addEventListener('beforeunload', this.handleBeforeUnload)
        window.addEventListener('pagehide', this.handlePageHide)
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        this.reflectActiveWorkspace()
        this.unsubscribers.push(
            this.router.subscribe(this.reflectActiveWorkspace),
        )

        this.renderAvatar()
        this.unsubscribers.push(
            this.auth.authStore.subscribe(this.renderAvatar),
        )
    }

    private renderAvatar = (): void => {
        const user = this.auth.authStore.getData('user') as {
            picture?: string
            given_name?: string
            name?: string
        } | null
        this.avatarEl.replaceChildren()

        if (user?.picture) {
            this.avatarEl.appendChild(
                html`
                    <img
                        src=${user.picture}
                        alt=${user.given_name || 'User'}
                        referrerpolicy="no-referrer"
                    />
                ` as HTMLImageElement,
            )
        } else {
            const initial = (user?.given_name || user?.name || 'User').charAt(0).toUpperCase()
            this.avatarEl.appendChild(html`<span className="navigation-side-panel-avatar-initial">${initial}</span>` as HTMLSpanElement)
        }
    }

    private handleBeforeUnload = (event: BeforeUnloadEvent): void => {
        if (!this.navigation.hasPendingChanges())
            return

        void this.navigation.flushPendingChanges()
        event.preventDefault()
        event.returnValue = ''
    }

    private handlePageHide = (): void => {
        if (this.navigation.hasPendingChanges())
            void this.navigation.flushPendingChanges()
    }

    private handleVisibilityChange = (): void => {
        if (
            document.visibilityState === 'hidden'
            && this.navigation.hasPendingChanges()
        )
            void this.navigation.flushPendingChanges()
    }

    private signOut = async (): Promise<void> => {
        if (
            this.signingOut
            || this.destroyed
        )
            return

        this.signingOut = true
        this.accountDropdown.setErrorState()

        try {
            const saved = await this.navigation.flushPendingChanges()

            if (
                !saved
                || this.navigation.hasPendingChanges()
            ) {
                if (!this.destroyed)
                    this.accountDropdown.setErrorState({ title: 'Navigation changes were not saved. Resolve them and try signing out again.' })

                return
            }

            if (!this.destroyed)
                await this.auth.logout()
        } catch {
            if (!this.destroyed)
                this.accountDropdown.setErrorState({ title: 'Sign out failed. Try again.' })
        } finally {
            this.signingOut = false
        }
    }

    private setOpen = async (open: boolean): Promise<void> => {
        navigationSidePanelStore.setValues({ isOpen: open })
        await this.panel.setOpen(open)
    }

    private reflectActiveWorkspace = (): void => {
        const workspaceId = this.router.getCurrentRoute().routeParams.workspaceId

        this.navigation.setActive(typeof workspaceId === 'string' ? workspaceId : undefined)
    }

    // Switching workspaces tears the open canvas down synchronously, and
    // nothing paints until that finishes. The clicked row and the spinner
    // show first, and the route changes once the browser has painted them.
    // A click while another workspace is still loading abandons that load
    // and starts the spinner over.
    private handleWorkspaceClick(workspaceId: string): void {
        this.router.cancelRouteLoad()
        this.navigation.setActive(workspaceId)
        const loadingLayer = servicesStore.getData('loadingLayer')
        const lease = loadingLayer?.acquire({ visible: true })
        this.cancelPendingWorkspaceSwitch()
        loadingLayer?.restartSpin()
        const pending: PendingWorkspaceSwitch = {
            frame: requestAnimationFrame(() => {
                pending.timer = setTimeout(() => {
                    this.pendingWorkspaceSwitch = null
                    this.openWorkspace(workspaceId)
                    lease?.destroy()
                }, 0)
            }),
            lease,
        }
        this.pendingWorkspaceSwitch = pending
    }

    private cancelPendingWorkspaceSwitch(): void {
        const pending = this.pendingWorkspaceSwitch

        if (!pending)
            return

        this.pendingWorkspaceSwitch = null
        cancelAnimationFrame(pending.frame)
        clearTimeout(pending.timer)
        pending.lease?.destroy()
    }

    private openWorkspace(workspaceId: string): void {
        this.router.navigateTo(
            '/workspace/:workspaceId',
            {
                params: { workspaceId },
                shouldFetchData: true,
            },
        )
        workspaceStore.beginWorkspaceLoad(workspaceId)
    }

    // When the open workspace is deleted, opens the first remaining
    // workspace, or the start page when none is left.
    private handleWorkspacesDeleted = (workspaceIds: string[]): void => {
        const currentWorkspaceId = this.router.getCurrentRoute().routeParams.workspaceId

        if (!workspaceIds.includes(
            String(currentWorkspaceId),
        ))
            return

        const next = workspaceTreeStore.current.organizations.flatMap(tree => tree.roots).find(entry => entry.entryType === 'workspace')

        if (next?.entryType === 'workspace')
            this.openWorkspace(next.workspace.workspaceId)
        else
            this.router.navigateTo('/', { params: {} })
    }

    private onWorkspaceExportHandler = async (workspaceId: string): Promise<void> => {
        const token = await this.auth.getTokenSilently()

        if (!token)
            return

        const apiUrl = import.meta.env.VITE_API_URL
        window.open(`${apiUrl}/api/workspaces/${workspaceId}/export?token=${token}`, '_blank')
    }

    private onWorkspaceImportHandler = (workspaceId: string): void => {
        this.importTargetWorkspaceId = workspaceId
        this.importFileInput.value = ''
        this.importFileInput.click()
    }

    private handleImportFileSelected = async (event: Event): Promise<void> => {
        const input = event.target as HTMLInputElement
        const file = input.files?.[0]

        if (
            !file
            || !this.importTargetWorkspaceId
        )
            return

        const workspaceId = this.importTargetWorkspaceId
        this.importTargetWorkspaceId = null

        const token = await this.auth.getTokenSilently()

        if (!token)
            return

        const apiUrl = import.meta.env.VITE_API_URL
        const formData = new FormData()
        formData.append('file', file)

        try {
            const response = await fetch(
                `${apiUrl}/api/workspaces/${workspaceId}/import`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                },
            )

            if (!response.ok) {
                const error = await response.json()
                console.error('Workspace import failed:', error)

                return
            }

            const currentWorkspaceId = this.router.getCurrentRoute().routeParams.workspaceId

            if (currentWorkspaceId === workspaceId) {
                await this.workspaceService.getWorkspace({ workspaceId })
                await servicesStore.getData('assetService').loadWorkspaceAssets(workspaceId)
            }
        } catch (error) {
            console.error('Workspace import failed:', error)
        }
    }

    destroy = (): void => {
        this.destroyed = true
        this.cancelPendingWorkspaceSwitch()
        window.removeEventListener('beforeunload', this.handleBeforeUnload)
        window.removeEventListener('pagehide', this.handlePageHide)
        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
        this.accountDropdown.destroy()
        this.importFileInput.removeEventListener('change', this.handleImportFileSelected)

        for (const unsubscribe of this.unsubscribers)
            unsubscribe()

        this.navigation.destroy()
        this.panel.destroy()
    }
}

export const createNavigationSidePanel = (config: NavigationSidePanelConfig): NavigationSidePanelInstance => new NavigationSidePanel(config)
