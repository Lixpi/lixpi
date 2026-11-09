// NavigationSidePanel - workspace-list side panel built on the shared SidePanel component.
//
// Renderer: TypeScript `html` DOM. Store access stays behind small store APIs
// so the panel remains a framework-agnostic DOM component.

import {
    type WorkspaceMeta,
} from '@lixpi/constants'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import {
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'

import { html } from '@lixpi/ui-primitives/dom'
import {
    createSidePanel,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { settings } from '$src/settings.ts'
import {
    createNewFileIcon,
    navigationSidePanelToggleIcon,
    verticalTrippleDots,
} from '@lixpi/ui-kit/svg'

import { workspacesStore } from '$src/stores/workspacesStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { navigationSidePanelStore } from '$src/stores/navigationSidePanelStore.ts'

const NAVIGATION_SIDE_PANEL_SETTINGS = settings.navigationSidePanel

export type NavigationSidePanelConfig = {
    // Host element the panel/backdrop/overlay/toggle/resize-handle mount into.
    auth: Pick<AuthClientInstance, 'authStore' | 'getTokenSilently' | 'logout' | 'createSessionHandoffUrl'>
    // Content area the panel floats over. It receives
    // `--navigation-side-panel-inset`, the width the open panel covers, so
    // content can keep its own overlays clear of the panel.
    contentEl: HTMLElement
    paneEl: HTMLElement
    router: Pick<WebClientRouterService, 'getCurrentRoute' | 'navigateTo' | 'subscribe'>
    userPortalUrl: string
    workspaceService: {
        createWorkspace: (input: { name: string }) => Promise<void>
        deleteWorkspace: (input: { workspaceId: string }) => Promise<void>
        getWorkspace: (input: { workspaceId: string }) => Promise<void>
    }
}

export type NavigationSidePanelInstance = {
    destroy: () => void
}

type WorkspaceRow = {
    el: HTMLButtonElement
    dropdown: ReturnType<typeof createPureDropdown>
    signature: string
}

// Name and tags are everything a row shows, so a row whose signature is
// unchanged is kept as it is.
const getWorkspaceRowSignature = (workspace: WorkspaceMeta): string => JSON.stringify([
    workspace.name,
    workspace.tags ?? [],
])

class NavigationSidePanel implements NavigationSidePanelInstance {
    private readonly contentEl: HTMLElement
    private readonly paneEl: HTMLElement
    private readonly unsubscribers: Array<() => void> = []
    private readonly workspaceRows = new Map<string, WorkspaceRow>()
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

        this.headerEl.appendChild(
            this.createNewWorkspaceButton(),
        )
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

        this.renderWorkspaceList()
        this.unsubscribers.push(
            workspacesStore.subscribe(this.renderWorkspaceList),
        )
        this.unsubscribers.push(
            this.router.subscribe(this.reflectActiveWorkspace),
        )

        this.renderAvatar()
        this.unsubscribers.push(
            this.auth.authStore.subscribe(this.renderAvatar),
        )
    }

    private createNewWorkspaceButton(): HTMLButtonElement {
        return html`
            <button
                type="button"
                className="navigation-side-panel-new-workspace-button"
                aria-label="New workspace"
                innerHTML=${createNewFileIcon}
                onclick=${this.handleCreateNewWorkspaceClick}
            ></button>
        ` as HTMLButtonElement
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

    private signOut = async (): Promise<void> => {
        if (
            this.signingOut
            || this.destroyed
        )
            return

        this.signingOut = true
        this.accountDropdown.setErrorState()

        try {
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
        const inset = navigationSidePanelStore.getData().isOpen ? this.width : 0
        this.contentEl.style.setProperty('--navigation-side-panel-inset', `${inset}px`)
    }

    private reflectStyleSettings = (): void => {
        this.paneEl.style.setProperty('--side-panel-backdrop-fill', NAVIGATION_SIDE_PANEL_SETTINGS.styles.backdropFill)
        this.paneEl.style.setProperty('--side-panel-backdrop-fill-opaque', NAVIGATION_SIDE_PANEL_SETTINGS.styles.backdropFillOpaque)
        this.paneEl.style.setProperty('--side-panel-toggle-color', NAVIGATION_SIDE_PANEL_SETTINGS.styles.toggleColor)
        this.paneEl.style.setProperty('--side-panel-toggle-hover-color', NAVIGATION_SIDE_PANEL_SETTINGS.styles.toggleHoverColor)
    }

    private reflectInitialOpenState(): void {
        if (navigationSidePanelStore.getData().isOpen)
            this.sidePanel.mountOpen(this.panelEl)
        else
            this.sidePanel.mountClosed(this.panelEl)

        this.reflectInset()
    }

    private handleOpenChange = (open: boolean): void => {
        navigationSidePanelStore.setValues({ isOpen: open })
        this.reflectInset()
        void this.runSlide(open)
    }

    private runSlide = async (open: boolean): Promise<void> => {
        if (open)
            await this.sidePanel.playOpen(this.panelEl)
        else
            await this.sidePanel.playClose()
    }

    private toggleVisibility = (): void => {
        const isOpen = navigationSidePanelStore.getData().isOpen
        navigationSidePanelStore.setValues({ isOpen: !isOpen })
        this.reflectInset()
        void this.runSlide(!isOpen)
    }

    // --- Workspace list rendering -------------------------------------------------

    // Rows stay in the DOM across renders, and only a row whose name or tags
    // changed is rebuilt. Switching workspaces only moves the active class, so
    // the row under the pointer keeps its hover and pressed state.
    private renderWorkspaceList = (): void => {
        const workspaces = workspacesStore.getData()
        const workspaceIds = new Set(
            workspaces.map(workspace => workspace.workspaceId),
        )

        for (const [workspaceId, row] of this.workspaceRows) {
            if (workspaceIds.has(workspaceId))
                continue

            this.destroyWorkspaceRow(row)
            this.workspaceRows.delete(workspaceId)
        }

        const rowEls = workspaces.map(workspace => this.syncWorkspaceRow(workspace))
        const inOrder = rowEls.length === this.listEl.children.length
            && rowEls.every((rowEl, index) => this.listEl.children[index] === rowEl)

        if (!inOrder)
            this.listEl.replaceChildren(...rowEls)

        this.reflectActiveWorkspace()
    }

    private syncWorkspaceRow(workspace: WorkspaceMeta): HTMLButtonElement {
        const signature = getWorkspaceRowSignature(workspace)
        const existing = this.workspaceRows.get(workspace.workspaceId)

        if (existing?.signature === signature)
            return existing.el

        const row = this.renderWorkspaceRow(workspace)
        const next = {
            ...row,
            signature,
        }

        if (existing) {
            existing.el.replaceWith(next.el)
            this.destroyWorkspaceRow(existing)
        }

        this.workspaceRows.set(workspace.workspaceId, next)

        return next.el
    }

    private destroyWorkspaceRow(row: WorkspaceRow): void {
        row.dropdown.destroy()
        row.el.remove()
    }

    private reflectActiveWorkspace = (): void => {
        const currentWorkspaceId = this.router.getCurrentRoute().routeParams.workspaceId

        for (const [workspaceId, row] of this.workspaceRows)
            row.el.classList.toggle('navigation-side-panel-row-active', workspaceId === currentWorkspaceId)
    }

    private renderWorkspaceRow(workspace: WorkspaceMeta): Omit<WorkspaceRow, 'signature'> {
        const menuAnchor = html`<div className="navigation-side-panel-row-menu"></div>` as HTMLDivElement
        const dropdown = createPureDropdown({
            id: `navigation-side-panel-workspace-menu-${workspace.workspaceId}`,
            selectedValue: { title: '' },
            options: [
                { title: 'Import' },
                { title: 'Export' },
                { title: 'Delete' },
            ],
            theme: 'dark',
            buttonIcon: verticalTrippleDots,
            disableTriggerHover: true,
            renderTitleForSelectedValue: false,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: true,
            onSelect: option => {
                if (option.title === 'Import')
                    this.onWorkspaceImportHandler(workspace.workspaceId)
                else if (option.title === 'Export')
                    void this.onWorkspaceExportHandler(workspace.workspaceId)
                else if (option.title === 'Delete')
                    void this.onWorkspaceDeleteHandler(workspace.workspaceId)
            },
        })
        menuAnchor.appendChild(dropdown.dom)
        menuAnchor.addEventListener('click', event => event.stopPropagation())

        const tagsEl = html`<div className="navigation-side-panel-row-tags"></div>` as HTMLDivElement

        if (workspace.tags?.length) {
            for (const tag of workspace.tags) {
                tagsEl.appendChild(html`<span className="navigation-side-panel-row-tag">${tag}</span>` as HTMLElement)
            }
        }

        const row = html`
            <button
                type="button"
                className="navigation-side-panel-row"
                onclick=${() => this.handleWorkspaceClick(workspace.workspaceId)}
            >
                <div className="navigation-side-panel-row-top">
                    <div className="navigation-side-panel-row-title">${workspace.name}</div>
                </div>
            </button>
        ` as HTMLButtonElement

        row.querySelector<HTMLDivElement>('.navigation-side-panel-row-top')?.appendChild(menuAnchor)

        if (workspace.tags?.length)
            row.appendChild(tagsEl)

        return {
            el: row,
            dropdown,
        }
    }

    private handleWorkspaceClick(workspaceId: string): void {
        this.router.navigateTo(
            '/workspace/:workspaceId',
            {
                params: { workspaceId },
                shouldFetchData: true,
            },
        )
        workspaceStore.beginWorkspaceLoad(workspaceId)
    }

    private handleCreateNewWorkspaceClick = async (): Promise<void> => await this.workspaceService.createWorkspace({ name: 'New Workspace' })

    private onWorkspaceDeleteHandler = async (workspaceId: string): Promise<void> => await this.workspaceService.deleteWorkspace({ workspaceId })

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
        this.accountDropdown.destroy()
        this.importFileInput.removeEventListener('change', this.handleImportFileSelected)

        for (const unsubscribe of this.unsubscribers)
            unsubscribe()

        for (const row of this.workspaceRows.values())
            this.destroyWorkspaceRow(row)

        this.workspaceRows.clear()
        this.sidePanel.destroy()
        this.panelEl.remove()
    }
}

export const createNavigationSidePanel = (config: NavigationSidePanelConfig): NavigationSidePanelInstance => new NavigationSidePanel(config)
