// NavigationSidePanel - the workspace tree side panel built on the shared
// SidePanel component.
//
// Renderer: TypeScript `html` DOM for the panel chrome. The workspace tree in
// the list uses the local workspace adapter; this panel supplies its
// ports (NATS requests, routing, confirmation, import and export, collapse
// persistence) and keeps the header, footer and SidePanel shell.

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
    createSidePanel,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { settings } from '$src/settings.ts'
import { navigationSidePanelToggleIcon } from '@lixpi/ui-kit/svg'

import { workspaceTreeStore } from '$src/stores/workspaceTreeStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { navigationSidePanelStore } from '$src/stores/navigationSidePanelStore.ts'

const NAVIGATION_SIDE_PANEL_SETTINGS = settings.navigationSidePanel

export type NavigationSidePanelConfig = {
    // Host element the panel/backdrop/overlay/toggle/resize-handle mount into.
    auth: Pick<AuthClientInstance, 'authStore' | 'getTokenSilently' | 'logout' | 'createSessionHandoffUrl'>
    // Content area beside the panel. It receives
    // `--navigation-side-panel-inset`, the width the open panel covers, so
    // content can keep its own overlays clear of the panel, and
    // `--navigation-side-panel-dock-width`, the space a `push` panel claims,
    // so content can shrink beside it.
    contentEl: HTMLElement
    paneEl: HTMLElement
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
    private readonly contentEl: HTMLElement
    private readonly paneEl: HTMLElement
    private readonly unsubscribers: Array<() => void> = []
    private readonly navigation: WorkspaceNavigationHandle
    private readonly panelEl: HTMLDivElement
    private readonly headerEl: HTMLDivElement
    private readonly listEl: HTMLDivElement
    private readonly footerEl: HTMLDivElement
    private readonly avatarEl: HTMLSpanElement
    private readonly accountDropdown: ReturnType<typeof createPureDropdown>
    private readonly importFileInput: HTMLInputElement
    private readonly sidePanel: SidePanelInstance
    private readonly auth: NavigationSidePanelConfig['auth']
    private readonly router: NavigationSidePanelConfig['router']
    private readonly workspaceService: NavigationSidePanelConfig['workspaceService']
    private importTargetWorkspaceId: string | null = null
    private width = 0
    // Whether a `push` panel currently claims its space beside the content.
    private docked = false
    // Bumped on every open or close so a superseded close does not undock a
    // panel the user reopened while it was still sliding out.
    private motionVersion = 0
    private pendingWorkspaceSwitch: PendingWorkspaceSwitch | null = null
    private signingOut = false
    private destroyed = false

    constructor(config: NavigationSidePanelConfig) {
        this.auth = config.auth
        this.contentEl = config.contentEl
        this.paneEl = config.paneEl
        this.router = config.router
        this.workspaceService = config.workspaceService
        this.panelEl = html`<div className="navigation-side-panel"></div>` as HTMLDivElement
        this.headerEl = html`<div className="navigation-side-panel-header"></div>` as HTMLDivElement
        this.listEl = html`<div className="navigation-side-panel-list"></div>` as HTMLDivElement
        this.footerEl = html`<div className="navigation-side-panel-footer"></div>` as HTMLDivElement
        this.avatarEl = html`<span className="navigation-side-panel-avatar"></span>` as HTMLSpanElement
        this.accountDropdown = createPureDropdown({
            id: 'navigation-side-panel-account-menu',
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

        this.footerEl.append(html`<div className="navigation-side-panel-footer-separator"></div>` as HTMLDivElement, this.accountDropdown.dom)
        this.panelEl.append(
            this.headerEl,
            this.listEl,
            this.footerEl,
            this.importFileInput,
        )
        this.paneEl.appendChild(this.panelEl)

        this.sidePanel = createSidePanel({
            root: this.paneEl,
            side: 'left',
            offset: NAVIGATION_SIDE_PANEL_SETTINGS.resizeHandle.offset,
            grabWidth: NAVIGATION_SIDE_PANEL_SETTINGS.resizeHandle.grabWidth,
            className: 'navigation-side-panel-resize-handle',
            styles: NAVIGATION_SIDE_PANEL_SETTINGS.resizeHandle.styles,
            overlay: NAVIGATION_SIDE_PANEL_SETTINGS.overlay,
            drag: NAVIGATION_SIDE_PANEL_SETTINGS.drag,
            toggle: {
                iconSvg: navigationSidePanelToggleIcon,
                className: 'navigation-side-panel-toggle',
                motion: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.motion,
                openAriaLabel: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.openAriaLabel,
                closedAriaLabel: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.closedAriaLabel,
                openOffset: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.openOffset,
                closedTravel: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.closedTravel,
                top: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.top,
                size: NAVIGATION_SIDE_PANEL_SETTINGS.toggle.size,
                onToggle: this.toggleVisibility,
            },
            minWidth: NAVIGATION_SIDE_PANEL_SETTINGS.dimensions.minWidth,
            defaultWidth: NAVIGATION_SIDE_PANEL_SETTINGS.defaultDimensions.width,
            getMaxWidth: this.getMaxWidth,
            measureWidth: () => this.panelEl.getBoundingClientRect().width || NAVIGATION_SIDE_PANEL_SETTINGS.defaultDimensions.width,
            loadState: () => ({ width: navigationSidePanelStore.getData().width }),
            persistState: state => navigationSidePanelStore.setValues({ width: state.width ?? null }),
            onResize: this.reflectWidth,
            onResizeEnd: this.reflectWidth,
            onOpenChange: this.handleOpenChange,
        })

        this.reflectStyleSettings()

        if (this.sidePanel.toggleElement)
            this.paneEl.appendChild(this.sidePanel.toggleElement)

        if (this.sidePanel.overlayElement)
            this.paneEl.appendChild(this.sidePanel.overlayElement)

        this.paneEl.appendChild(this.sidePanel.backdropElement)
        this.panelEl.appendChild(this.sidePanel.element)

        this.reflectWidth(
            this.sidePanel.getWidth(),
        )
        this.reflectInitialOpenState()

        this.navigation = createWorkspaceNavigation({
            container: this.listEl,
            store: workspaceTreeStore,
            scrollContainer: () => this.listEl,
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

    private getMaxWidth = (): number => {
        const paneWidth = this.paneEl.getBoundingClientRect().width || window.innerWidth

        return Math.max(NAVIGATION_SIDE_PANEL_SETTINGS.dimensions.minWidth, paneWidth - NAVIGATION_SIDE_PANEL_SETTINGS.dimensions.maxPaneMargin)
    }

    private reflectWidth = (width: number): void => {
        const widthValue = `${width}px`
        this.width = width
        this.paneEl.style.setProperty('--workspace-navigation-side-panel-width', widthValue)
        this.paneEl.style.setProperty('--side-panel-backdrop-width', widthValue)
        this.panelEl.style.setProperty('--side-panel-backdrop-width', widthValue)
        this.reflectInset()
    }

    private reflectInset = (): void => {
        const isPush = NAVIGATION_SIDE_PANEL_SETTINGS.placement === 'push'
        const coversContent = !isPush && navigationSidePanelStore.getData().isOpen
        const claimsSpace = isPush && this.docked
        this.contentEl.style.setProperty('--navigation-side-panel-inset', `${coversContent ? this.width : 0}px`)
        this.contentEl.style.setProperty('--navigation-side-panel-dock-width', `${claimsSpace ? this.width : 0}px`)
    }

    private reflectStyleSettings = (): void => {
        this.paneEl.style.setProperty('--side-panel-backdrop-fill', NAVIGATION_SIDE_PANEL_SETTINGS.styles.backdropFill)
        this.paneEl.style.setProperty('--side-panel-backdrop-fill-opaque', NAVIGATION_SIDE_PANEL_SETTINGS.styles.backdropFillOpaque)
        this.paneEl.style.setProperty('--side-panel-toggle-color', NAVIGATION_SIDE_PANEL_SETTINGS.styles.toggleColor)
        this.paneEl.style.setProperty('--side-panel-toggle-hover-color', NAVIGATION_SIDE_PANEL_SETTINGS.styles.toggleHoverColor)
    }

    private reflectInitialOpenState(): void {
        const isOpen = navigationSidePanelStore.getData().isOpen

        if (isOpen)
            this.sidePanel.mountOpen(this.panelEl)
        else
            this.sidePanel.mountClosed(this.panelEl)

        this.docked = isOpen
        this.reflectInset()
    }

    private handleOpenChange = (open: boolean): void => void this.setOpen(open)

    private toggleVisibility = (): void => void this.setOpen(!navigationSidePanelStore.getData().isOpen)

    // Opening docks first so a `push` panel slides into its own space.
    // Closing slides the panel out first and only then releases the space, so
    // the content does not jump before the panel has left.
    private setOpen = async (open: boolean): Promise<void> => {
        const version = ++this.motionVersion
        navigationSidePanelStore.setValues({ isOpen: open })

        if (open) {
            this.docked = true
            this.reflectInset()
            await this.sidePanel.playOpen(this.panelEl)

            return
        }

        this.reflectInset()
        await this.sidePanel.playClose()

        if (
            this.destroyed
            || this.motionVersion !== version
        )
            return

        this.docked = false
        this.reflectInset()
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
        this.sidePanel.destroy()
        this.panelEl.remove()
    }
}

export const createNavigationSidePanel = (config: NavigationSidePanelConfig): NavigationSidePanelInstance => new NavigationSidePanel(config)
