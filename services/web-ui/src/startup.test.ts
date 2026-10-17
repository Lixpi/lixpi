import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    AuthenticationFailure,
    createAuthClient,
    type AuthClientSession,
} from '@lixpi/auth-client'
import {
    type WebClientServiceInstance,
} from '@lixpi/web-client-service-factory'
import { WebUiStartup } from './startup.ts'

vi.mock('@lixpi/ui-primitives/gradients', () => ({
    createShiftingGradientBackground: () => ({ destroy: vi.fn() }),
}))

const startups: WebUiStartup[] = []
const session: AuthClientSession = {
    accessToken: 'test-token',
    userId: 'test-user',
    getToken: async () => 'test-token',
    refreshToken: async () => 'test-token',
}

const harness = () => {
    const pending = Promise.withResolvers<AuthClientSession | null>()
    const auth = createAuthClient({ features: {
        auth: false,
        currentUser: false,
    } })
    vi.spyOn(auth, 'initializeSession').mockReturnValue(pending.promise)
    vi.spyOn(auth, 'login').mockResolvedValue()
    const application = {
        start: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
    }
    const loadWorkspace = vi.fn<ConstructorParameters<typeof WebUiStartup>[0]['loadWorkspace']>().mockResolvedValue(application)
    const startup = new WebUiStartup({
        auth,
        target: document.body,
        loadWorkspace,
    })
    startups.push(startup)

    return {
        startup,
        auth,
        pending,
        application,
        loadWorkspace,
    }
}

afterEach(async () => {
    for (const startup of startups.splice(0))
        await startup.destroy()

    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('public web UI startup', () => {
    it('keeps a neutral loader throughout authenticated startup without ever showing sign-in', async () => {
        const showSignIn = vi.spyOn(AuthenticationFailure.prototype, 'show')
        const {
            startup,
            auth,
            pending,
            loadWorkspace,
            application,
        } = harness()
        const modules = Promise.withResolvers<WebClientServiceInstance>()
        loadWorkspace.mockReturnValue(modules.promise)
        const started = startup.start()
        const loading = document.querySelector('[role="status"]')!
        expect(loading.getAttribute('aria-label')).toBe('Loading Lixpi')
        expect(document.querySelector('button')).toBeNull()
        expect(document.querySelector('h1')).toBeNull()
        expect(loadWorkspace).not.toHaveBeenCalled()
        pending.resolve(session)
        await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce())
        expect(document.querySelector('[role="status"]')).toBe(loading)
        application.start.mockImplementation(async () => loadWorkspace.mock.calls[0][0].onReady())
        modules.resolve(application)
        await started
        expect(showSignIn).not.toHaveBeenCalled()
        expect(auth.login).not.toHaveBeenCalled()
        expect(document.body.children).toHaveLength(0)
    })

    it('offers sign-in and signup only after the session check confirms no session', async () => {
        const {
            startup,
            auth,
            pending,
            loadWorkspace,
        } = harness()
        const started = startup.start()
        pending.resolve(null)
        await started
        expect(document.querySelector('[role="status"]')).toBeNull()
        expect(document.querySelector('h1')?.textContent).toBe('Welcome to Lixpi')
        const buttons = document.querySelectorAll('button')
        expect(Array.from(buttons, button => button.textContent)).toEqual(['Sign in', 'Create an account'])
        buttons[0].click()
        await vi.waitFor(() => expect(buttons[0].disabled).toBe(false))
        expect(auth.login).toHaveBeenCalledWith(true)
        buttons[1].click()
        expect(auth.login).toHaveBeenCalledWith(true, 'signup')
        expect(loadWorkspace).not.toHaveBeenCalled()
    })

    it('does not flash sign-in when a cached session resolves immediately', async () => {
        const showSignIn = vi.spyOn(AuthenticationFailure.prototype, 'show')
        const {
            startup,
            pending,
        } = harness()
        pending.resolve(session)
        await startup.start()
        expect(showSignIn).not.toHaveBeenCalled()
        expect(document.querySelector('button')).toBeNull()
    })

    it('loads the private workspace only after a session and releases the startup view before mounting', async () => {
        const {
            startup,
            pending,
            loadWorkspace,
            application,
        } = harness()
        const modules = Promise.withResolvers<WebClientServiceInstance>()
        loadWorkspace.mockReturnValue(modules.promise)
        const started = startup.start()
        pending.resolve(session)
        await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce())
        expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading Lixpi')
        expect(application.start).not.toHaveBeenCalled()
        const config = loadWorkspace.mock.calls[0][0]
        application.start.mockImplementation(async () => config.onReady())
        modules.resolve(application)
        await started
        expect(application.start).toHaveBeenCalledOnce()
        expect(document.body.children).toHaveLength(0)
        config.onAuthRequired()
        expect(document.querySelector('button')?.textContent).toBe('Sign in')
    })

    it('leaves sign-in available when authentication fails without importing the workspace', async () => {
        const {
            startup,
            pending,
            loadWorkspace,
        } = harness()
        const started = startup.start()
        pending.reject(new Error('access_denied'))
        await started
        expect(document.querySelector('[role="status"]')).toBeNull()
        expect(document.querySelector('button')?.textContent).toBe('Sign in')
        expect(loadWorkspace).not.toHaveBeenCalled()
    })

    it('does not show sign-in when a session check fails after shutdown', async () => {
        const showSignIn = vi.spyOn(AuthenticationFailure.prototype, 'show')
        const {
            startup,
            pending,
        } = harness()
        const started = startup.start()
        await startup.destroy()
        pending.reject(new Error('access_denied'))
        await started
        expect(showSignIn).not.toHaveBeenCalled()
        expect(document.body.children).toHaveLength(0)
    })

    it('shows a workspace retry rather than signing the user out after a module or service failure', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        const {
            startup,
            pending,
            loadWorkspace,
            auth,
        } = harness()
        loadWorkspace.mockRejectedValue(new Error('module unavailable'))
        const started = startup.start()
        pending.resolve(session)
        await started
        expect(document.querySelector('h1')?.textContent).toBe('Your workspace could not load')
        expect(document.querySelector('button')?.textContent).toBe('Try again')
        expect(auth.login).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith('Workspace startup failed:', 'module unavailable')
    })

    it('does not revive a destroyed view when authentication finishes late', async () => {
        const {
            startup,
            pending,
            loadWorkspace,
        } = harness()
        const started = startup.start()
        await startup.destroy()
        pending.resolve(session)
        await started
        expect(document.body.children).toHaveLength(0)
        expect(loadWorkspace).not.toHaveBeenCalled()
    })

    it('disposes a late-loaded application without starting it after shutdown', async () => {
        const {
            startup,
            pending,
            loadWorkspace,
            application,
        } = harness()
        const modules = Promise.withResolvers<WebClientServiceInstance>()
        loadWorkspace.mockReturnValue(modules.promise)
        const started = startup.start()
        pending.resolve(session)
        await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce())
        await startup.destroy()
        modules.resolve(application)
        await started
        expect(application.start).not.toHaveBeenCalled()
        expect(application.destroy).toHaveBeenCalledOnce()
        expect(document.body.children).toHaveLength(0)
    })
})
