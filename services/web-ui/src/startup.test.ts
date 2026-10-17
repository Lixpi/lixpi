import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
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
    it('renders usable sign-in before authentication settles and does not load the editor', async () => {
        const {
            startup,
            auth,
            pending,
            loadWorkspace,
        } = harness()
        const started = startup.start()
        expect(document.querySelector('h1')?.textContent).toBe('Welcome to Lixpi')
        const button = document.querySelector('button')!
        expect(button.textContent).toBe('Sign in')
        expect(button.disabled).toBe(false)
        expect(loadWorkspace).not.toHaveBeenCalled()
        button.click()
        expect(auth.login).toHaveBeenCalledWith(true, undefined)
        pending.resolve(session)
        await started
        expect(loadWorkspace).not.toHaveBeenCalled()
    })

    it('keeps signup usable while silent authentication is pending', async () => {
        const {
            startup,
            auth,
            pending,
        } = harness()
        const started = startup.start()
        document.querySelectorAll('button')[1].click()
        expect(auth.login).toHaveBeenCalledWith(true, 'signup')
        pending.resolve(null)
        await started
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
        expect(document.querySelector('h1')?.textContent).toBe('Opening your workspace')
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
        expect(document.querySelector('button')?.textContent).toBe('Sign in')
        expect(loadWorkspace).not.toHaveBeenCalled()
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
