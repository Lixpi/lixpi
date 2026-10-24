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
import {
    type LoadingOverlayOptions,
} from '@lixpi/canvas-components/loading'
import { WebUiStartup } from './startup.ts'
import { settings } from './settings.ts'

const overlayOptions = vi.hoisted(() => [] as LoadingOverlayOptions[])

vi.mock('@lixpi/ui-primitives/gradients', () => ({
    createShiftingGradientBackground: () => ({ destroy: vi.fn() }),
}))

vi.mock('@lixpi/canvas-components/loading/overlay', () => ({
    LoadingOverlay: class {
        constructor(options: LoadingOverlayOptions) {
            overlayOptions.push(options)
        }
        setVisible() {}
        setErrorMessage() {}
        destroy() {}
    },
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
    overlayOptions.length = 0
    vi.restoreAllMocks()
})

describe('public web UI startup', () => {
    it('uses application loading settings instead of fresh canvas defaults', async () => {
        const original = settings.workspaceLoadingOutline
        settings.workspaceLoadingOutline = {
            diameter: 144,
            animationDurationMs: 875,
            snakeLengthFraction: 0.55,
        }
        const {
            startup,
            pending,
        } = harness()
        const started = startup.start()

        try {
            await vi.waitFor(() => expect(overlayOptions).toHaveLength(1))
            expect(overlayOptions[0].outline).toMatchObject({
                size: settings.workspaceLoadingOutline.diameter,
                durationMs: settings.workspaceLoadingOutline.animationDurationMs,
                snakeLengthFraction: settings.workspaceLoadingOutline.snakeLengthFraction,
            })
        } finally {
            pending.resolve(null)
            await started
            settings.workspaceLoadingOutline = original
        }
    })

    it('shares one overlay with canvas and document loading outside the application content', async () => {
        const {
            startup,
            pending,
            loadWorkspace,
        } = harness()
        const content = document.createElement('main')
        document.body.append(content)
        const started = startup.start()
        const overlay = document.querySelector('.canvas-loading-layer')!
        expect(content.contains(overlay)).toBe(false)
        pending.resolve(session)
        await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce())
        const {
            loadingLayer,
            onReady,
        } = loadWorkspace.mock.calls[0][0]
        const canvas = loadingLayer.acquire({ visible: true })
        const documentLoad = loadingLayer.acquire({ visible: true })
        await started
        onReady()
        expect(document.querySelectorAll('.canvas-loading-layer')).toHaveLength(1)
        expect(document.querySelector('.canvas-loading-layer')).toBe(overlay)
        canvas.destroy()
        expect(overlay.isConnected).toBe(true)
        documentLoad.destroy()
        expect(overlay.isConnected).toBe(false)
        expect(content.isConnected).toBe(true)
    })
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

    it('offers one hosted sign-in entry only after the session check confirms no session', async () => {
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
        expect(Array.from(buttons, button => button.textContent)).toEqual(['Sign in'])
        buttons[0].click()
        await vi.waitFor(() => expect(buttons[0].disabled).toBe(false))
        expect(auth.login).toHaveBeenCalledWith(true)
        expect(auth.login).toHaveBeenCalledOnce()
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
        pending.reject(new Error('private account verification detail'))
        await started
        expect(document.querySelector('[role="status"]')?.textContent).toBe('Sign-in could not be completed. Please try again.')
        expect(document.body.textContent).not.toContain('private account verification detail')
        expect(document.querySelector('button')?.textContent).toBe('Sign in')
        expect(loadWorkspace).not.toHaveBeenCalled()
    })

    it('keeps the neutral loader while custom-domain hosted login takes over', async () => {
        const showSignIn = vi.spyOn(AuthenticationFailure.prototype, 'show')
        const {
            startup,
            auth,
            pending,
            loadWorkspace,
        } = harness()
        const started = startup.start()
        auth.authStore.setMetaValues({ isRedirecting: true })
        pending.reject(new Error('No auth token'))
        await started
        expect(showSignIn).not.toHaveBeenCalled()
        expect(document.querySelector('[role="status"]')).not.toBeNull()
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
