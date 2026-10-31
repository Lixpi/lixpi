import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createUserStore } from '@lixpi/auth-client'
import { createWorkspaceApplication } from './workspaceApplication.ts'

const mocks = vi.hoisted(() => ({
    layout: vi.fn(() => ({
        el: document.createElement('div'),
        destroy: vi.fn(),
    })),
    disconnect: vi.fn(async () => {}),
    loadRoute: vi.fn(async () => {}),
}))
vi.mock('@lixpi/nats-service', () => ({ default: { init: async () => ({
    onReconnect: vi.fn(),
    request: vi.fn(),
    disconnect: mocks.disconnect,
}) } }))
vi.mock('$src/views/layouts/layout.ts', () => ({ createLayout: mocks.layout }))
vi.mock('$src/routes.ts', () => ({ workspaceRouting: {
    routes: [{
        path: '/',
        load: mocks.loadRoute,
    }],
    fallbackPath: '/',
} }))
vi.mock('$src/services/organization-service.ts', () => ({ default: class { getOrganization() {} } }))
vi.mock('$src/services/ai-model-service.ts', () => ({ default: class { getAvailableAiModels() {} } }))
vi.mock('$src/services/workspace-service.ts', () => ({ default: class {
    canvasSessions = { close: async () => {} }
    getUserWorkspaces() {}
} }))
vi.mock('$src/services/asset-service.ts', () => ({ default: class {} }))

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    document.body.replaceChildren()
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
            userStore,
            loadCurrentUser: vi.fn(async () => {
                await pendingUser

                if (rejected)
                    throw new Error('CURRENT_USER_UNAVAILABLE')

                userStore.setDataValues({
                    userId: 'authenticated-user',
                    organizations: ['organization'],
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
            }
        } finally {
            finishUser()
            await starting
            await application.destroy()
        }
    })
})
