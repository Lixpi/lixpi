import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => {
    const state: {
        portalConfig?: unknown
        started: boolean
    } = { started: false }
    const session = {
        accessToken: 'access-token',
        getToken: vi.fn(),
        refreshToken: vi.fn(),
        userId: 'user-123',
    }
    const auth = {
        features: { currentUser: true },
        initializeSession: vi.fn(async () => session),
        userStore: {},
    }
    const nats = {}
    const application = {
        destroy: vi.fn(async () => undefined),
        start: vi.fn(async () => void (state.started = true)),
    }

    return {
        accountPortalModule: { id: 'account' },
        application,
        auth,
        createAuthClient: vi.fn(() => auth),
        createUserPortal: vi.fn((config: unknown) => {
            state.portalConfig = config

            return application
        }),
        getNatsUserInboxPrefix: vi.fn(() => '_INBOX.757365722d313233'),
        nats,
        natsInit: vi.fn(async () => nats),
        session,
        state,
    }
})

vi.mock('@lixpi/auth-client', () => ({
    createAuthClient: mocks.createAuthClient,
}))

vi.mock('@lixpi/constants', () => ({
    getNatsUserInboxPrefix: mocks.getNatsUserInboxPrefix,
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { init: mocks.natsInit },
}))

vi.mock('@lixpi/user-portal', () => ({
    accountPortalModule: mocks.accountPortalModule,
    createUserPortal: mocks.createUserPortal,
}))

vi.mock('@lixpi/web-client-service-factory/styles/foundation', () => ({}))
vi.mock('@lixpi/user-portal/styles', () => ({}))

import { shutdownApplication } from './main.ts'

describe('user portal application composition', () => {
    it('starts the account portal with a user-scoped NATS inbox', async () => {
        const config = mocks.state.portalConfig as {
            modules: unknown[]
            createDependencies: () => Promise<unknown>
        }

        expect(config.modules).toEqual([mocks.accountPortalModule])
        await expect(config.createDependencies()).resolves.toEqual({
            auth: mocks.auth,
            nats: mocks.nats,
        })
        expect(mocks.getNatsUserInboxPrefix).toHaveBeenCalledWith('user-123')
        expect(mocks.natsInit).toHaveBeenCalledWith(expect.objectContaining({
            inboxPrefix: '_INBOX.757365722d313233',
            token: 'access-token',
            webSocket: true,
        }))
        expect(mocks.state.started).toBe(true)

        await shutdownApplication()

        expect(mocks.application.destroy).toHaveBeenCalledOnce()
    })
})
