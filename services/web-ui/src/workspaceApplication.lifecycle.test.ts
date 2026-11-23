import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createUserStore } from '@lixpi/auth-client'
import {
    lixpiLightTheme,
    oneDarkProMarianaTheme,
} from '@lixpi/themes'
import { uiKitSettings } from '@lixpi/ui-kit'
import { canvasThemeStore } from './canvas-adapters/canvas-theme.ts'
import { createWorkspaceApplication } from './workspaceApplication.ts'
import { beginWorkspaceConnection } from './workspaceConnection.ts'
import { workspaceStore } from './stores/workspaceStore.ts'

const mocks = vi.hoisted(() => ({
    layout: vi.fn(() => ({
        el: document.createElement('div'),
        destroy: vi.fn(),
    })),
    disconnect: vi.fn(async () => {}),
    loadRoute: vi.fn(async () => {}),
}))
vi.mock('@lixpi/nats-service', () => ({ default: { init: async () => ({
    onReconnect: vi.fn(() => vi.fn()),
    request: vi.fn(),
    disconnect: mocks.disconnect,
}) } }))
vi.mock('$src/views/layouts/layout.ts', () => ({ createLayout: mocks.layout }))
vi.mock('$src/routes.ts', () => ({
    WORKSPACE_ROUTE_PATH: '/workspace/:workspaceId',
    workspaceRouting: {
        routes: [
            {
                path: '/',
                load: mocks.loadRoute,
            },
            {
                path: '/workspace/:workspaceId',
                load: mocks.loadRoute,
            },
        ],
        fallbackPath: '/',
    },
}))
vi.mock('$src/services/organization-service.ts', () => ({ default: class { getOrganization() {} } }))
vi.mock('$src/services/ai-model-service.ts', () => ({ default: class { getAvailableAiModels() {} } }))
vi.mock('$src/services/workspace-service.ts', () => ({ default: class {
    canvasSessions = { close: async () => {} }
    getUserWorkspaceTree() {}
} }))
vi.mock('$src/services/asset-service.ts', () => ({ default: class {} }))

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    document.body.replaceChildren()
    window.history.replaceState({}, '', '/')
    workspaceStore.resetStore()
})

describe('workspace identity before private editor state', () => {
    it.each([false, true])('loads the authenticated user before mounting the layout or loading the workspace route (load rejected: %s)', async rejected => {
        vi.stubEnv('VITE_ACCOUNT_ONBOARDING_ENABLED', 'false')
        const target = document.createElement('div')
        target.id = 'app'
        document.body.append(target)
        const userStore = createUserStore()
        let finishUser = () => {}
        const pendingUser = new Promise<void>(resolve => void (finishUser = resolve))
        const auth = {
            features: { currentUser: true },
            getTokenSilently: async () => 'token',
            userStore,
            loadCurrentUser: vi.fn(async () => {
                await pendingUser

                if (rejected)
                    throw new Error('CURRENT_USER_UNAVAILABLE')

                userStore.setDataValues({
                    userId: 'authenticated-user',
                    organizations: ['organization'],
                    preferences: { appearance: oneDarkProMarianaTheme.name },
                })
            }),
        }
        mocks.layout.mockClear()
        mocks.loadRoute.mockClear()
        const onError = vi.fn()
        const mountedUserIds: string[] = []
        mocks.layout.mockImplementation(() => {
            mountedUserIds.push(userStore.getData('userId'))

            return {
                el: document.createElement('div'),
                destroy: vi.fn(),
            }
        })
        const application = createWorkspaceApplication({
            auth: auth as never,
            session: {
                accessToken: 'token',
                userId: 'authenticated-user',
                getToken: async () => 'token',
            } as never,
            loadingLayer: {} as never,
            onReady: vi.fn(),
            onAuthRequired: vi.fn(),
            onError,
        })
        const root = document.documentElement
        const previousTheme = root.dataset.colorTheme
        const previousScheme = root.dataset.theme
        const starting = application.start()

        try {
            await vi.waitFor(() => expect(auth.loadCurrentUser).toHaveBeenCalledOnce())
            expect(mocks.layout).not.toHaveBeenCalled()
            expect(mocks.loadRoute).not.toHaveBeenCalled()
            finishUser()
            await starting

            if (rejected) {
                expect(mountedUserIds).toEqual([])
                expect(mocks.loadRoute).not.toHaveBeenCalled()
                expect(onError).toHaveBeenCalledOnce()
            } else {
                expect(mountedUserIds).toEqual(['authenticated-user'])
                expect(mocks.loadRoute).toHaveBeenCalledOnce()
                expect(onError).not.toHaveBeenCalled()
                expect(root.dataset.colorTheme).toBe(oneDarkProMarianaTheme.name)
                expect(root.dataset.theme).toBe('dark')
                expect(canvasThemeStore.value.name).toBe(oneDarkProMarianaTheme.name)
                expect(uiKitSettings.dropdown.errorState.textColor).toBe(oneDarkProMarianaTheme.feedback.danger)

                userStore.setDataValues({ preferences: { appearance: lixpiLightTheme.name } })

                expect(root.dataset.colorTheme).toBe(lixpiLightTheme.name)
                expect(root.dataset.theme).toBe('light')
                expect(canvasThemeStore.value.name).toBe(lixpiLightTheme.name)
                expect(uiKitSettings.dropdown.errorState.textColor).toBe(lixpiLightTheme.feedback.danger)
            }
        } finally {
            finishUser()
            await starting
            await application.destroy()
        }

        expect(root.dataset.colorTheme).toBe(previousTheme)
        expect(root.dataset.theme).toBe(previousScheme)
    })
})


it.each([false, true])('keeps the startup loader through the first canvas load (failed: %s)', async failed => {
    vi.stubEnv('VITE_ACCOUNT_ONBOARDING_ENABLED', 'false')
    window.history.replaceState({}, '', '/workspace/initial')
    const target = document.createElement('div')
    target.id = 'app'
    document.body.append(target)
    const onReady = vi.fn()
    const application = createWorkspaceApplication({
        auth: {
            features: { currentUser: false },
            getTokenSilently: async () => 'token',
            userStore: createUserStore(),
        } as never,
        session: {
            accessToken: 'token',
            userId: 'authenticated-user',
            getToken: async () => 'token',
        } as never,
        loadingLayer: {} as never,
        onReady,
        onAuthRequired: vi.fn(),
        onError: vi.fn(),
    })

    try {
        await application.start()
        expect(target.children).toHaveLength(1)
        expect(onReady).not.toHaveBeenCalled()

        workspaceStore.completeWorkspaceLoad({ workspaceId: 'another' })
        workspaceStore.beginWorkspaceLoad('initial')
        await Promise.resolve()
        expect(onReady).not.toHaveBeenCalled()

        if (failed)
            workspaceStore.failWorkspaceLoad('WORKSPACE_UNAVAILABLE')
        else
            workspaceStore.completeWorkspaceLoad({ workspaceId: 'initial' })

        await Promise.resolve()
        expect(onReady).toHaveBeenCalledOnce()
        workspaceStore.completeWorkspaceLoad({ workspaceId: 'initial' })
        await Promise.resolve()
        expect(onReady).toHaveBeenCalledOnce()
    } finally {
        await application.destroy()
    }
})


it('connects and loads the user before private view construction and closes an abandoned connection', async () => {
    vi.stubEnv('VITE_ACCOUNT_ONBOARDING_ENABLED', 'false')
    const mount = document.createElement('div')
    mount.id = 'app'
    document.body.append(mount)
    mocks.layout.mockClear()
    mocks.disconnect.mockClear()
    const config = {
        auth: {
            features: { currentUser: true },
            getTokenSilently: async () => 'token',
            userStore: createUserStore(),
            loadCurrentUser: vi.fn(async () => {}),
        },
        session: {
            accessToken: 'token',
            userId: 'authenticated-user',
            getToken: async () => 'token',
        },
        loadingLayer: {},
        onReady: vi.fn(),
        onAuthRequired: vi.fn(),
        onError: vi.fn(),
    }
    const abandoned = beginWorkspaceConnection(config as never)
    await abandoned.destroy()
    await expect(abandoned.waitUntilReady()).rejects.toThrow('Workspace startup was stopped')
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(config.auth.loadCurrentUser).not.toHaveBeenCalled()

    const connection = beginWorkspaceConnection(config as never)
    await connection.waitUntilReady()
    expect(config.auth.loadCurrentUser).toHaveBeenCalledOnce()
    expect(mocks.layout).not.toHaveBeenCalled()

    const application = createWorkspaceApplication(config as never, connection)

    try {
        await application.start()
        expect(config.auth.loadCurrentUser).toHaveBeenCalledOnce()
        expect(mocks.layout).toHaveBeenCalledOnce()
    } finally {
        await application.destroy()
    }

    expect(mocks.disconnect).toHaveBeenCalledTimes(2)
})
