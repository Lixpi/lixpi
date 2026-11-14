import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { LoadingStatus } from '@lixpi/constants'
import { readFileSync } from 'fs'
import { createRequire } from 'node:module'
import { withoutLayout } from '@lixpi/test-utils'
import {
    createRouterService,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'

// =============================================================================
// MOCKED COLLABORATORS
// =============================================================================
//
// NavigationSidePanel drives real navigation, workspace CRUD, auth, and file
// import/export side effects. Those collaborators are mocked so tests assert
// on *what NavigationSidePanel asked them to do*, not on their own internals
// (which have their own test suites). The nanostores-backed panel/workspace
// stores below are exercised for real — they are cheap, synchronous, and
// resettable, so mocking them would just hide real integration bugs.

const mocks = vi.hoisted(() => ({
    navigateTo: vi.fn(),
    navigationOptions: undefined as any,
    navigation: {
        setActive: vi.fn(),
        createWorkspace: vi.fn().mockResolvedValue(undefined),
        hasPendingChanges: vi.fn(() => false),
        flushPendingChanges: vi.fn(async () => true),
        destroy: vi.fn(),
    },
    getWorkspace: vi.fn().mockResolvedValue(undefined),
    getTokenSilently: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    loadWorkspaceAssets: vi.fn().mockResolvedValue(undefined),
    dropdownInstances: [] as Array<{
        dom: HTMLElement
        destroy: () => void
        setErrorState: ReturnType<typeof vi.fn>
        config: any
    }>,
}))

// The dropdown is a fully separate, already-tested component. NavigationSidePanel's
// own responsibility is *what it configures the dropdown with* (options, onSelect
// routing) — that's what these tests exercise, via the captured config.
vi.mock('@lixpi/ui-kit/components/dropdown', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/ui-kit/components/dropdown')>()

    return {
    createPureDropdown: vi.fn((config: any) => {
        if (config.id === 'navigation-side-panel-account-menu') {
            const dropdown = actual.createPureDropdown(config)
            const instance = {
                ...dropdown,
                destroy: vi.fn(dropdown.destroy),
                setErrorState: vi.fn(dropdown.setErrorState),
                config,
            }
            mocks.dropdownInstances.push(instance)

            return instance
        }

        const dom = document.createElement('div')
        dom.className = 'mock-dropdown'
        const instance = {
            dom,
            destroy: vi.fn(),
            setErrorState: vi.fn(),
            config,
        }
        mocks.dropdownInstances.push(instance)

        return instance
    }),
    }
})

// The workspace adapter has its own
// tests. The panel's responsibility is the ports it supplies, so the tests
// capture them.
vi.mock('./workspace-navigation/create-workspace-navigation.ts', async importOriginal => ({
    ...await importOriginal<typeof import('./workspace-navigation/create-workspace-navigation.ts')>(),
    createWorkspaceNavigation: vi.fn((options: any) => {
        mocks.navigationOptions = options

        return mocks.navigation
    }),
}))

import {
    createNavigationSidePanel,
    type NavigationSidePanelInstance,
} from '$src/components/navigationSidePanel/navigationSidePanel.ts'
import { workspaceTreeStore } from '$src/stores/workspaceTreeStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { createAuthStore } from '@lixpi/auth-client'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { navigationSidePanelStore } from '$src/stores/navigationSidePanelStore.ts'
import { settings } from '$src/settings.ts'

const USER_PORTAL_URL = 'https://user-portal.example.test'
const isPush = settings.navigationSidePanel.placement === 'push'

const setCurrentWorkspaceId = (workspaceId: string | undefined): void => {
    router.navigateTo('/workspace/:workspaceId', {
        params: workspaceId ? { workspaceId } : {},
        shouldFetchData: false,
    })
}

const authStore = createAuthStore()
const auth = {
    authStore,
    createSessionHandoffUrl: (destination: string) => `${destination}/?auth=continue&auth_account=prepared`,
    getTokenSilently: mocks.getTokenSilently,
    logout: mocks.logout,
}

const mountedPanels = new Set<NavigationSidePanelInstance>()

const mount = (): {
    contentEl: HTMLDivElement
    paneEl: HTMLDivElement
    instance: NavigationSidePanelInstance
} => {
    const paneEl = document.createElement('div')
    const contentEl = document.createElement('div')
    document.body.append(
        paneEl,
        contentEl,
    )
    const panel = createNavigationSidePanel({
        auth,
        contentEl,
        paneEl,
        router,
        userPortalUrl: USER_PORTAL_URL,
        workspaceService,
    })
    const instance: NavigationSidePanelInstance = {
        destroy: () => {
            if (mountedPanels.delete(instance))
                panel.destroy()
        },
    }
    mountedPanels.add(instance)

    return {
        contentEl,
        paneEl,
        instance,
    }
}

const ports = () => mocks.navigationOptions.ports

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null
let router: WebClientRouterService

const workspaceService = {
    getWorkspace: mocks.getWorkspace,
}

beforeEach(() => {
    mocks.dropdownInstances.length = 0
    mocks.navigateTo.mockClear()
    mocks.navigationOptions = undefined
    mocks.navigation.setActive.mockClear()
    mocks.navigation.createWorkspace.mockClear()
    mocks.navigation.hasPendingChanges.mockReset().mockReturnValue(false)
    mocks.navigation.flushPendingChanges.mockReset().mockResolvedValue(true)
    mocks.navigation.destroy.mockClear()
    mocks.getWorkspace.mockClear()
    mocks.getTokenSilently.mockReset()
    mocks.logout.mockReset().mockResolvedValue(undefined)
    mocks.loadWorkspaceAssets.mockClear()

    workspaceTreeStore.replaceAll({ organizations: [] })
    workspaceStore.resetStore()
    servicesStore.resetStore()
    authStore.resetStore()
    navigationSidePanelStore.resetStore()

    servicesStore.setDataValues({
        assetService: { loadWorkspaceAssets: mocks.loadWorkspaceAssets },
    })

    router = createRouterService({
        routes: [
            { path: '/' },
            { path: '/workspace/:workspaceId' },
        ],
    })
    const navigateTo = router.navigateTo.bind(router)
    vi.spyOn(router, 'navigateTo').mockImplementation((path, options) => {
        mocks.navigateTo(path, options)
        navigateTo(path, options)
    })

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
    for (const instance of mountedPanels)
        instance.destroy()

    document.body.innerHTML = ''
    router.destroy()
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
})

afterAll(() => {
    // Unmount the persistent store before the test environment removes window.
    vi.useFakeTimers()

    try {
        navigationSidePanelStore.get()
        vi.runOnlyPendingTimers()
    } finally {
        vi.useRealTimers()
    }
})

// =============================================================================
// MOUNTING AND STRUCTURE
// =============================================================================

describe('NavigationSidePanel — mounting', () => {
    it('mounts the panel, enabled side-panel surfaces, and the new-workspace button into the host pane', () => {
        const {
            paneEl,
            instance,
        } = mount()

        expect(paneEl.querySelector('.navigation-side-panel')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-header')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-list')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-footer')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-new-workspace-button')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-resize-handle')).not.toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-toggle')).not.toBeNull()
        expect(paneEl.querySelector('.side-panel-overlay')).toBeNull()
        expect(paneEl.querySelector('.side-panel-backdrop')).not.toBeNull()

        instance.destroy()
    })

    it('reflects the resolved panel width onto both the pane and panel elements as CSS custom properties', () => {
        const {
            paneEl,
            instance,
        } = mount()

        // Never resized -> falls back to settings.navigationSidePanel.defaultDimensions.width (280).
        expect(paneEl.style.getPropertyValue('--workspace-navigation-side-panel-width')).toBe('280px')
        expect(paneEl.style.getPropertyValue('--side-panel-backdrop-width')).toBe('280px')
        const panelEl = paneEl.querySelector<HTMLDivElement>('.navigation-side-panel')
        expect(panelEl?.style.getPropertyValue('--side-panel-backdrop-width')).toBe('280px')

        instance.destroy()
    })

    it('applies visual style tokens from app settings to the host pane', () => {
        const {
            paneEl,
            instance,
        } = mount()

        expect(paneEl.style.getPropertyValue('--side-panel-backdrop-fill')).toBe(settings.navigationSidePanel.styles.backdropFill)
        expect(paneEl.style.getPropertyValue('--side-panel-backdrop-fill-opaque')).toBe(settings.navigationSidePanel.styles.backdropFillOpaque)
        expect(paneEl.style.getPropertyValue('--side-panel-toggle-color')).toBe(settings.navigationSidePanel.styles.toggleColor)
        expect(paneEl.style.getPropertyValue('--side-panel-toggle-hover-color')).toBe(settings.navigationSidePanel.styles.toggleHoverColor)

        instance.destroy()
    })

    it('starts open by default and renders the panel at rest, matching the store default', () => {
        const {
            paneEl,
            instance,
        } = mount()

        expect(navigationSidePanelStore.getData('isOpen')).toBe(true)
        const panelEl = paneEl.querySelector<HTMLDivElement>('.navigation-side-panel')
        expect(panelEl?.style.transform).not.toBe('translate3d(-100%, 0, 0)')

        instance.destroy()
    })

    it('mounts closed at rest when the persisted store state says closed', () => {
        navigationSidePanelStore.setValues({ isOpen: false })
        const {
            paneEl,
            instance,
        } = mount()

        const panelEl = paneEl.querySelector<HTMLDivElement>('.navigation-side-panel')
        expect(panelEl?.style.transform).toBe('translate3d(-100%, 0, 0)')
        const backdropEl = paneEl.querySelector<HTMLDivElement>('.side-panel-backdrop')
        expect(backdropEl?.style.transform).toBe('translate3d(-100%, 0, 0)')

        instance.destroy()
    })
})

// =============================================================================
// AVATAR RENDERING
// =============================================================================

describe('NavigationSidePanel — avatar', () => {
    it('renders an initial letter fallback when there is no signed-in user', () => {
        const {
            paneEl,
            instance,
        } = mount()

        const avatar = paneEl.querySelector('.navigation-side-panel-avatar')
        expect(avatar?.querySelector('img')).toBeNull()
        expect(avatar?.querySelector('.navigation-side-panel-avatar-initial')?.textContent).toBe('U')

        instance.destroy()
    })

    it('renders an <img> from the user picture when available', () => {
        const {
            paneEl,
            instance,
        } = mount()
        authStore.setDataValues({ user: {
            userId: 'u1',
            name: 'Ada Lovelace',
            email: 'a@example.com',
            picture: 'https://example.com/a.png',
            given_name: 'Ada',
        } as any })

        const avatar = paneEl.querySelector('.navigation-side-panel-avatar')
        const img = avatar?.querySelector('img')
        expect(img?.getAttribute('src')).toBe('https://example.com/a.png')
        expect(img?.getAttribute('alt')).toBe('Ada')

        instance.destroy()
    })

    it('falls back to the given_name initial when there is no picture', () => {
        const {
            paneEl,
            instance,
        } = mount()
        authStore.setDataValues({ user: {
            userId: 'u1',
            name: 'Grace Hopper',
            email: 'g@example.com',
            given_name: 'Grace',
        } as any })

        const avatar = paneEl.querySelector('.navigation-side-panel-avatar')
        expect(avatar?.querySelector('.navigation-side-panel-avatar-initial')?.textContent).toBe('G')

        instance.destroy()
    })

    it('re-renders the avatar reactively when the auth store changes after mount', () => {
        const {
            paneEl,
            instance,
        } = mount()
        expect(paneEl.querySelector('.navigation-side-panel-avatar-initial')?.textContent).toBe('U')

        authStore.setDataValues({ user: {
            userId: 'u1',
            name: 'Zoe',
            email: 'z@example.com',
            given_name: 'Zoe',
        } as any })
        expect(paneEl.querySelector('.navigation-side-panel-avatar-initial')?.textContent).toBe('Z')

        instance.destroy()
    })

    it('opens the account menu from the avatar and opens Profile in the configured portal', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null)
        const {
            paneEl,
            instance,
        } = mount()
        const avatar = paneEl.querySelector<HTMLElement>('.navigation-side-panel-avatar')!
        avatar.click()

        expect(open).not.toHaveBeenCalled()
        expect(avatar.closest('button')?.getAttribute('aria-expanded')).toBe('true')
        const menu = document.querySelector('#dropdown-menu-navigation-side-panel-account-menu')!
        const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
        expect(Array.from(items, item => item.textContent?.trim())).toEqual(['Profile', 'Sign out'])
        items[0].click()
        expect(open).toHaveBeenCalledWith(`${USER_PORTAL_URL}/?auth=continue&auth_account=prepared`, '_blank', 'noopener,noreferrer')
        expect(mocks.logout).not.toHaveBeenCalled()

        instance.destroy()
        open.mockRestore()
    })

    it('signs out through Auth0 when the menu item is activated with the keyboard', async () => {
        const {
            paneEl,
            instance,
        } = mount()
        const trigger = paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-account-menu button')!
        trigger.focus()
        trigger.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
        }))
        expect(document.activeElement?.textContent?.trim()).toBe('Sign out')
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
        }))
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
        expect(trigger.getAttribute('aria-expanded')).toBe('false')
        instance.destroy()
        expect(document.querySelector('#dropdown-menu-navigation-side-panel-account-menu')).toBeNull()
    })

    it('prevents duplicate sign-out requests and lets the user retry a failed logout', async () => {
        const pending = Promise.withResolvers<void>()
        mocks.logout.mockReturnValueOnce(pending.promise)
        const {
            paneEl,
            instance,
        } = mount()
        const trigger = paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-account-menu button')!
        const signOut = document.querySelectorAll<HTMLElement>('#dropdown-menu-navigation-side-panel-account-menu [role="menuitem"]')[1]
        trigger.click()
        signOut.click()
        trigger.click()
        signOut.click()
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
        pending.reject(new Error('logout unavailable'))
        await pending.promise.catch(() => undefined)
        expect(paneEl.querySelector('[role="status"]')?.textContent).toBe('Sign out failed. Try again.')
        trigger.click()
        signOut.click()
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(2))
        expect(paneEl.querySelector('[role="status"]')?.textContent).toBe('')
        instance.destroy()
    })

    it('waits for navigation acknowledgement before signing out', async () => {
        const pending = Promise.withResolvers<boolean>()
        mocks.navigation.hasPendingChanges.mockReturnValue(true)
        mocks.navigation.flushPendingChanges.mockReturnValueOnce(pending.promise)
        const { instance } = mount()
        const menu = mocks.dropdownInstances.find(entry => entry.config.id === 'navigation-side-panel-account-menu')!
        menu.config.onSelect({ action: 'logout' })
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledOnce()
        expect(mocks.logout).not.toHaveBeenCalled()
        mocks.navigation.hasPendingChanges.mockReturnValue(false)
        pending.resolve(true)
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
        instance.destroy()
    })

    it('keeps the session when navigation cannot be saved', async () => {
        mocks.navigation.hasPendingChanges.mockReturnValue(true)
        mocks.navigation.flushPendingChanges.mockResolvedValue(false)
        const { instance } = mount()
        const menu = mocks.dropdownInstances.find(entry => entry.config.id === 'navigation-side-panel-account-menu')!
        menu.config.onSelect({ action: 'logout' })
        await vi.waitFor(() => expect(menu.setErrorState).toHaveBeenCalledWith({
            title: 'Navigation changes were not saved. Resolve them and try signing out again.',
        }))
        expect(mocks.logout).not.toHaveBeenCalled()
        instance.destroy()
    })

    it('flushes and warns only while navigation changes remain unacknowledged', () => {
        mocks.navigation.hasPendingChanges.mockReturnValue(true)
        const { instance } = mount()
        const leaving = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(leaving)
        expect(leaving.defaultPrevented).toBe(true)
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledOnce()

        mocks.navigation.hasPendingChanges.mockReturnValue(false)
        const clean = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(clean)
        expect(clean.defaultPrevented).toBe(false)
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledOnce()
        instance.destroy()
    })

    it('flushes on pagehide and hidden visibility, then removes leave listeners', () => {
        mocks.navigation.hasPendingChanges.mockReturnValue(true)
        const { instance } = mount()
        window.dispatchEvent(new Event('pagehide'))
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledOnce()

        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledTimes(2)
        instance.destroy()
        window.dispatchEvent(new Event('pagehide'))
        window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
        document.dispatchEvent(new Event('visibilitychange'))
        expect(mocks.navigation.flushPendingChanges).toHaveBeenCalledTimes(2)
        visibility.mockRestore()
    })

    it('does not update a disposed account menu after logout fails', async () => {
        const pending = Promise.withResolvers<void>()
        mocks.logout.mockReturnValueOnce(pending.promise)
        const { instance } = mount()
        const menu = mocks.dropdownInstances.find(entry => entry.config.id === 'navigation-side-panel-account-menu')!
        menu.config.onSelect({ action: 'logout' })
        await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
        instance.destroy()
        menu.setErrorState.mockClear()
        pending.reject(new Error('logout unavailable'))
        await pending.promise.catch(() => undefined)
        expect(menu.setErrorState).not.toHaveBeenCalled()
        expect(menu.destroy).toHaveBeenCalledOnce()
    })
})

// =============================================================================
// WORKSPACE TREE NAVIGATION
// =============================================================================

describe('NavigationSidePanel — workspace tree navigation', () => {
    it('mounts the workspace navigation into the list with the shared tree store', () => {
        const {
            paneEl,
            instance,
        } = mount()

        expect(mocks.navigationOptions.container).toBe(paneEl.querySelector('.navigation-side-panel-list'))
        expect(mocks.navigationOptions.store).toBe(workspaceTreeStore)
        expect(ports().buildHref('ws-1')).toBe('/workspace/ws-1')

        instance.destroy()
    })

    it('sends tree requests over NATS with a fresh token', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-1')
        const request = vi.fn().mockResolvedValue({ organizations: [] })
        servicesStore.setDataValues({ nats: { request } } as never)
        const { instance } = mount()

        await ports().request('workspace.move', { workspaceId: 'ws-1' })

        expect(request).toHaveBeenCalledWith('workspace.move', {
            token: 'token-1',
            workspaceId: 'ws-1',
        })

        instance.destroy()
    })

    it('marks the routed workspace as active and follows route changes', () => {
        setCurrentWorkspaceId('ws-1')
        const { instance } = mount()

        expect(mocks.navigation.setActive).toHaveBeenLastCalledWith('ws-1')

        setCurrentWorkspaceId('ws-2')
        expect(mocks.navigation.setActive).toHaveBeenLastCalledWith('ws-2')

        instance.destroy()
    })

    it('keeps collapsed workspaces in the panel store', () => {
        navigationSidePanelStore.setValues({ collapsedWorkspaceIds: ['ws-1'] })
        const { instance } = mount()

        expect(ports().collapsed.load()).toEqual(['ws-1'])
        ports().collapsed.save(['ws-2', 'ws-3'])
        expect(navigationSidePanelStore.getData().collapsedWorkspaceIds).toEqual(['ws-2', 'ws-3'])

        instance.destroy()
    })

    it('opens the next workspace when the open one is deleted and the start page when none remains', () => {
        setCurrentWorkspaceId('ws-1')
        const { instance } = mount()
        workspaceTreeStore.replaceAll({ organizations: [{
            organizationId: 'org-1',
            organizationName: 'Studio',
            tags: {},
            roots: [{
                entryType: 'workspace',
                workspace: {
                    workspaceId: 'ws-2',
                    organizationId: 'org-1',
                    name: 'Beta',
                    tagIds: [],
                    ancestorIds: [],
                    position: 'V',
                    createdAt: 0,
                    updatedAt: 0,
                },
                accessLevel: 'owner',
                children: [],
            }],
        }] })
        mocks.navigateTo.mockClear()

        ports().onWorkspacesDeleted(['ws-3'])
        expect(mocks.navigateTo).not.toHaveBeenCalled()

        ports().onWorkspacesDeleted(['ws-1'])
        expect(mocks.navigateTo).toHaveBeenLastCalledWith('/workspace/:workspaceId', {
            params: { workspaceId: 'ws-2' },
            shouldFetchData: true,
        })

        workspaceTreeStore.replaceAll({ organizations: [] })
        setCurrentWorkspaceId('ws-2')
        ports().onWorkspacesDeleted(['ws-2'])
        expect(mocks.navigateTo).toHaveBeenLastCalledWith('/', { params: {} })

        instance.destroy()
    })
})

// =============================================================================
// NAVIGATION AND WORKSPACE CREATION
// =============================================================================

describe('NavigationSidePanel — navigation and creation', () => {
    it('shows the clicked row and the spinner at once, then switches after the browser paints', () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] })
        const lease = {
            setVisible: vi.fn(),
            setErrorMessage: vi.fn(),
            destroy: vi.fn(),
        }
        const acquire = vi.fn(() => lease)
        servicesStore.setDataValues({ loadingLayer: {
            acquire,
            restartSpin: vi.fn(),
        } as any })
        workspaceStore.setDataValues({
            workspaceId: 'old-workspace',
            canvasState: {
                viewport: {
                    x: 1,
                    y: 2,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'old-node',
                    type: 'image',
                } as any],
                edges: [],
            },
        })
        workspaceStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        const { instance } = mount()
        mocks.navigation.setActive.mockClear()

        ports().navigate('ws-1')

        expect(mocks.navigation.setActive).toHaveBeenLastCalledWith('ws-1')
        expect(acquire).toHaveBeenCalledExactlyOnceWith({ visible: true })
        expect(mocks.navigateTo).not.toHaveBeenCalled()
        expect(workspaceStore.getData('workspaceId')).toBe('old-workspace')

        vi.runAllTimers()

        expect(lease.destroy).toHaveBeenCalledOnce()
        expect(workspaceStore.getData('workspaceId')).toBe('ws-1')
        expect(workspaceStore.getData('canvasState')).toEqual({
            viewport: {
                x: 0,
                y: 0,
                zoom: 1,
            },
            nodes: [],
            edges: [],
        })
        expect(workspaceStore.getMeta('loadingStatus')).toBe(LoadingStatus.loading)
        expect(mocks.navigateTo).toHaveBeenCalledExactlyOnceWith('/workspace/:workspaceId', {
            params: { workspaceId: 'ws-1' },
            shouldFetchData: true,
        })

        instance.destroy()
        vi.useRealTimers()
    })

    it('opens only the last workspace clicked before the switch runs', () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] })
        const leases = [vi.fn(), vi.fn()]
        const acquire = vi.fn(() => ({
            setVisible: vi.fn(),
            setErrorMessage: vi.fn(),
            destroy: leases[acquire.mock.calls.length - 1],
        }))
        const restartSpin = vi.fn()
        servicesStore.setDataValues({ loadingLayer: {
            acquire,
            restartSpin,
        } as any })
        const { instance } = mount()
        const cancelRouteLoad = vi.spyOn(router, 'cancelRouteLoad')

        ports().navigate('ws-1')
        ports().navigate('ws-2')
        expect(leases[0]).toHaveBeenCalledOnce()
        expect(cancelRouteLoad).toHaveBeenCalledTimes(2)
        expect(restartSpin).toHaveBeenCalledTimes(2)

        vi.runAllTimers()

        expect(mocks.navigateTo).toHaveBeenCalledExactlyOnceWith('/workspace/:workspaceId', {
            params: { workspaceId: 'ws-2' },
            shouldFetchData: true,
        })
        expect(leases[1]).toHaveBeenCalledOnce()

        instance.destroy()
        vi.useRealTimers()
    })

    it('creates a root workspace from the header button and opens a created workspace', async () => {
        const {
            paneEl,
            instance,
        } = mount()

        paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-new-workspace-button')?.click()
        await Promise.resolve()
        ports().onWorkspaceCreated({ workspaceId: 'ws-new' })

        expect(mocks.navigation.createWorkspace).toHaveBeenCalledExactlyOnceWith({})
        expect(mocks.navigateTo).toHaveBeenLastCalledWith('/workspace/:workspaceId', {
            params: { workspaceId: 'ws-new' },
            shouldFetchData: true,
        })

        instance.destroy()
    })
})

// =============================================================================
// ROW ACTIONS — import / export
// =============================================================================

describe('NavigationSidePanel — row import and export', () => {
    it('arms the hidden file input for an import, not a service call', () => {
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement
        const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => undefined)

        ports().importWorkspace('ws-1')

        expect(clickSpy).toHaveBeenCalledTimes(1)
        expect(mocks.getWorkspace).not.toHaveBeenCalled()

        instance.destroy()
    })

    it('opens the export URL with a fresh auth token', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-123')
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        const { instance } = mount()

        ports().exportWorkspace('ws-1')
        await Promise.resolve()
        await Promise.resolve()

        expect(openSpy).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(/\/api\/workspaces\/ws-1\/export\?token=token-123$/),
            '_blank',
        )

        openSpy.mockRestore()
        instance.destroy()
    })

    it('does not open the export URL when no auth token is available', async () => {
        mocks.getTokenSilently.mockResolvedValue(null)
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        const { instance } = mount()

        ports().exportWorkspace('ws-1')
        await Promise.resolve()
        await Promise.resolve()

        expect(openSpy).not.toHaveBeenCalled()

        openSpy.mockRestore()
        instance.destroy()
    })
})

// =============================================================================
// WORKSPACE IMPORT FLOW (hidden file input)
// =============================================================================

describe('NavigationSidePanel — workspace import flow', () => {
    const selectFile = (input: HTMLInputElement, file: File): void => {
        Object.defineProperty(input, 'files', {
            value: [file],
            configurable: true,
        })
        input.dispatchEvent(new Event('change'))
    }

    let fetchSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => void (fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<typeof vi.spyOn>))

    afterEach(() => {
        fetchSpy?.mockRestore()
        fetchSpy = null
    })

    it('does nothing when a file is chosen without first arming an import target', async () => {
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()

        expect(fetchSpy).not.toHaveBeenCalled()

        instance.destroy()
    })

    it('uploads the selected file with an auth bearer token to the target workspace', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-abc')
        fetchSpy?.mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response)
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(/\/api\/workspaces\/ws-1\/import$/),
            expect.objectContaining({
                method: 'POST',
                headers: { Authorization: 'Bearer token-abc' },
            }),
        )
        const requestInit = fetchSpy?.mock.calls[0]?.[1] as RequestInit
        const body = requestInit?.body
        expect(body).toBeInstanceOf(FormData)
        expect(body?.get('file')).toBeInstanceOf(File)
        expect(body?.get('file')?.name).toBe('workspace.zip')

        instance.destroy()
    })

    it('does not upload when no auth token is available', async () => {
        mocks.getTokenSilently.mockResolvedValue(null)
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()

        expect(fetchSpy).not.toHaveBeenCalled()

        instance.destroy()
    })

    it('refreshes workspace metadata and assets only when the import target is the currently open workspace', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-abc')
        fetchSpy?.mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response)
        setCurrentWorkspaceId('ws-1')
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(mocks.getWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws-1' })
        expect(mocks.loadWorkspaceAssets).toHaveBeenCalledExactlyOnceWith('ws-1')

        instance.destroy()
    })

    it('does not refresh the open workspace when the import target is a different workspace', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-abc')
        fetchSpy?.mockResolvedValue({
            ok: true,
            json: async () => ({}),
        } as Response)
        setCurrentWorkspaceId('ws-2')
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(mocks.getWorkspace).not.toHaveBeenCalled()
        expect(mocks.loadWorkspaceAssets).not.toHaveBeenCalled()

        instance.destroy()
    })

    it('logs and does not attempt a refresh when the backend reports an import failure', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-abc')
        fetchSpy?.mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'bad zip' }),
        } as Response)
        setCurrentWorkspaceId('ws-1')
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(consoleErrorSpy).toHaveBeenCalledWith('Workspace import failed:', { error: 'bad zip' })
        expect(mocks.getWorkspace).not.toHaveBeenCalled()

        instance.destroy()
    })

    it('logs and swallows a network failure during upload instead of throwing', async () => {
        mocks.getTokenSilently.mockResolvedValue('token-abc')
        fetchSpy?.mockRejectedValue(new Error('network down'))
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')
        selectFile(input, new File(['zip'], 'workspace.zip'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        expect(consoleErrorSpy).toHaveBeenCalledWith('Workspace import failed:', expect.any(Error))

        instance.destroy()
    })

    it('clears the file input value and the import target before reading the next selection', () => {
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement

        ports().importWorkspace('ws-1')

        expect(input.value).toBe('')

        instance.destroy()
    })
})

// =============================================================================
// TOGGLE OPEN/CLOSE
// =============================================================================

describe('NavigationSidePanel — open/close toggle', () => {
    it('flips the persisted isOpen state when the toggle button is clicked', () => {
        const {
            paneEl,
            instance,
        } = mount()
        expect(navigationSidePanelStore.getData('isOpen')).toBe(true)

        paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-toggle')?.click()

        expect(navigationSidePanelStore.getData('isOpen')).toBe(false)

        paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-toggle')?.click()

        expect(navigationSidePanelStore.getData('isOpen')).toBe(true)

        instance.destroy()
    })

    it.runIf(isPush)('pushes the content aside while open and releases the space only after the close slide', async () => {
        vi.useFakeTimers()

        try {
            const {
                contentEl,
                paneEl,
                instance,
            } = mount()
            const toggle = paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-toggle')
            const openWidth = `${settings.navigationSidePanel.defaultDimensions.width}px`
            expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe(openWidth)
            expect(contentEl.style.getPropertyValue('--navigation-side-panel-inset')).toBe('0px')

            toggle?.click()

            expect(navigationSidePanelStore.getData('isOpen')).toBe(false)
            expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe(openWidth)

            await vi.runAllTimersAsync()

            expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe('0px')

            toggle?.click()

            expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe(openWidth)
            expect(contentEl.style.getPropertyValue('--navigation-side-panel-inset')).toBe('0px')

            instance.destroy()
        } finally {
            vi.useRealTimers()
        }
    })

    it.runIf(isPush)('keeps the content docked when the panel reopens before its close slide settles', async () => {
        vi.useFakeTimers()

        try {
            const {
                contentEl,
                paneEl,
                instance,
            } = mount()
            const toggle = paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-toggle')

            toggle?.click()
            toggle?.click()
            await vi.runAllTimersAsync()

            expect(navigationSidePanelStore.getData('isOpen')).toBe(true)
            expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe(`${settings.navigationSidePanel.defaultDimensions.width}px`)

            instance.destroy()
        } finally {
            vi.useRealTimers()
        }
    })

    it.runIf(!isPush)('tells the content area how much of it the open overlay panel covers', () => {
        const {
            contentEl,
            paneEl,
            instance,
        } = mount()
        const openInset = `${settings.navigationSidePanel.defaultDimensions.width}px`
        expect(contentEl.style.getPropertyValue('--navigation-side-panel-inset')).toBe(openInset)
        expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe('0px')

        paneEl.querySelector<HTMLButtonElement>('.navigation-side-panel-toggle')?.click()

        expect(contentEl.style.getPropertyValue('--navigation-side-panel-inset')).toBe('0px')

        instance.destroy()
    })

    it('starts undocked when the persisted state says closed', () => {
        navigationSidePanelStore.setValues({ isOpen: false })
        const {
            contentEl,
            instance,
        } = mount()

        expect(contentEl.style.getPropertyValue('--navigation-side-panel-dock-width')).toBe('0px')
        expect(contentEl.style.getPropertyValue('--navigation-side-panel-inset')).toBe('0px')

        instance.destroy()
    })

    it('closes on a click beside the panel only when outside close is configured', () => {
        const {
            contentEl,
            instance,
        } = mount()
        const pointerDown = new PointerEvent('pointerdown', {
            clientX: 600,
            clientY: 300,
            bubbles: true,
            cancelable: true,
        })
        Object.defineProperty(pointerDown, 'isPrimary', { value: true })

        contentEl.dispatchEvent(pointerDown)
        contentEl.dispatchEvent(new MouseEvent('click', {
            clientX: 600,
            clientY: 300,
            bubbles: true,
            cancelable: true,
        }))

        expect(navigationSidePanelStore.getData('isOpen')).toBe(!settings.navigationSidePanel.overlay.closeOnPointerDown)

        instance.destroy()
    })
})

// =============================================================================
// DESTROY / CLEANUP
// =============================================================================

describe('NavigationSidePanel — destroy', () => {
    it('removes the panel and its side-panel surfaces from the host pane', () => {
        const {
            paneEl,
            instance,
        } = mount()

        instance.destroy()

        expect(paneEl.querySelector('.navigation-side-panel')).toBeNull()
        expect(paneEl.querySelector('.navigation-side-panel-toggle')).toBeNull()
        expect(paneEl.querySelector('.side-panel-overlay')).toBeNull()
        expect(paneEl.querySelector('.side-panel-backdrop')).toBeNull()
    })

    it('destroys the workspace navigation', () => {
        const { instance } = mount()

        instance.destroy()

        expect(mocks.navigation.destroy).toHaveBeenCalledTimes(1)
    })

    it('stops listening for the import input change event after destroy', () => {
        const {
            paneEl,
            instance,
        } = mount()
        const input = paneEl.querySelector<HTMLInputElement>('.navigation-side-panel-import-input') as HTMLInputElement
        ports().importWorkspace('ws-1')

        instance.destroy()
        Object.defineProperty(input, 'files', {
            value: [new File(['zip'], 'w.zip')],
            configurable: true,
        })
        input.dispatchEvent(new Event('change'))

        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
    })
})

describe(
    'NavigationSidePanel row menu styles',
    () => {
        const stylesheetPath = createRequire(import.meta.url).resolve('@lixpi/ui-kit/styles/navigation-side-panel')
        const readStyles = (): string => withoutLayout(
            readFileSync(
                stylesheetPath,
                'utf-8',
            ),
        )

        it(
            'reveals the row menu only on row hover, keyboard focus, or while its menu is open',
            () => {
                const source = readStyles()
                const hiddenMenu = withoutLayout(`
                    .navigation-side-panel-row-menu {
                        flex: 0 0 auto;
                        margin-left: auto;
                        opacity: 0;
                        transition: hoverTransition(opacity, $defaultHoverTransitionDuration);
                    }
                `)
                const visibleMenu = withoutLayout(`
                    .navigation-side-panel-row:hover .navigation-side-panel-row-menu,
                    .navigation-side-panel-row-menu:focus-within,
                    .navigation-side-panel-row-menu:has(.dots-dropdown-menu.is-active) {
                        opacity: 1;
                    }
                `)

                expect(
                    source.includes(hiddenMenu),
                    'The shared navigation stylesheet should hide idle row menus and retain their hover transition.',
                ).toBe(true)
                expect(
                    source.includes(visibleMenu),
                    'The shared navigation stylesheet should reveal row menus on hover, keyboard focus, or an open menu.',
                ).toBe(true)
            },
        )

        it(
            'turns the open row menu dots horizontal instead of flipping them',
            () => {
                const source = readStyles()
                const horizontalDots = withoutLayout(`
                    .navigation-side-panel-row-menu .dropdown-menu-tag-pill-wrapper.theme-dark .dots-dropdown-menu.is-active button span.state-indicator svg {
                        transform: rotate(90deg);
                    }
                `)

                expect(
                    source.includes(horizontalDots),
                    'The shared navigation stylesheet should rotate open row-menu dots by a quarter turn.',
                ).toBe(true)
            },
        )
    },
)
