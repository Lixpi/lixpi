import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthClient } from '@lixpi/auth-client'
import { LoadingStatus } from '@lixpi/constants'
import { type LoadingOverlayOptions } from '@lixpi/canvas-components/loading'
import { type WebClientServiceInstance } from '@lixpi/web-client-service-factory'
import { createUserPortal } from './createUserPortal.ts'
import { accountPortalModule } from './account/accountPortalModule.ts'
import { type UserPortalDependencies } from './types.ts'

const overlays = vi.hoisted(() => [] as LoadingOverlayOptions[])
vi.mock('@lixpi/canvas-components/loading/overlay', () => ({
    LoadingOverlay: class {
        constructor(options: LoadingOverlayOptions) { overlays.push(options) }
        setVisible() {}
        setErrorMessage() {}
        destroy() {}
    },
}))

const applications: WebClientServiceInstance[] = []
const settle: Array<() => void> = []

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
    window.history.replaceState({}, '', '/')
})

afterEach(async () => {
    for (const resolve of settle.splice(0)) resolve()

    for (const application of applications.splice(0)) await application.destroy()

    document.body.replaceChildren()
    overlays.length = 0
    vi.restoreAllMocks()
})

const harness = (isRedirecting = () => false) => {
    const auth = createAuthClient({ features: {
        auth: false,
        currentUser: true,
    } })
    const nats = {
        disconnect: vi.fn(),
        request: vi.fn(),
    } as unknown as UserPortalDependencies['nats']
    const dependencies = Promise.withResolvers<UserPortalDependencies>()
    const profile = Promise.withResolvers<void>()
    const loadCurrentUser = vi.spyOn(auth, 'loadCurrentUser').mockImplementation(async () => {
        auth.userStore.setMetaValues({ loadingStatus: LoadingStatus.loading })
        await profile.promise
        auth.userStore.setDataValues({ name: 'Alex Rivera' })
        auth.userStore.setMetaValues({ loadingStatus: LoadingStatus.success })
    })
    const onError = vi.fn()
    const application = createUserPortal({
        modules: [accountPortalModule],
        createDependencies: () => dependencies.promise,
        onError,
        isRedirecting,
    })
    applications.push(application)
    settle.push(() => dependencies.resolve({
        auth,
        nats,
    }), () => profile.resolve())

    return {
        application,
        auth,
        dependencies,
        profile,
        loadCurrentUser,
        nats,
        onError,
    }
}

describe('user portal loading', () => {
    it('keeps the outline visible until an authentication redirect leaves the page', async () => {
        const {
            application,
            dependencies,
        } = harness(() => true)
        const started = application.start()
        dependencies.reject(new Error('Authentication redirect started'))
        await started
        expect(document.querySelector('.canvas-loading-layer')).not.toBeNull()
        await application.destroy()
        expect(document.querySelector('.canvas-loading-layer')).toBeNull()
    })
    it('shows the shared outline before authentication and keeps it until the profile arrives', async () => {
        const {
            application,
            auth,
            dependencies,
            profile,
            loadCurrentUser,
            nats,
        } = harness()
        const started = application.start()
        expect(application.start()).toBe(started)
        const layer = document.querySelector('.canvas-loading-layer')!
        expect(layer?.getAttribute('aria-label')).toBe('Loading profile')
        expect(document.getElementById('app')!.children).toHaveLength(0)
        await vi.waitFor(() => expect(overlays).toHaveLength(1))
        expect(overlays[0].outline.size).toBe(100)
        expect(overlays[0].outline.durationMs).toBe(600)
        dependencies.resolve({
            auth,
            nats,
        })
        await vi.waitFor(() => expect(loadCurrentUser).toHaveBeenCalledOnce())
        expect(document.querySelectorAll('.canvas-loading-layer')).toHaveLength(1)
        expect(layer.isConnected).toBe(true)
        profile.resolve()
        await started
        expect(layer.isConnected).toBe(false)
        expect(document.getElementById('app')!.textContent).toContain('Alex Rivera')
    })

    it('removes the outline when authentication fails so recovery remains usable', async () => {
        const {
            application,
            dependencies,
            onError,
        } = harness()
        const started = application.start()
        dependencies.reject(new Error('Authentication failed'))
        await started
        expect(onError).toHaveBeenCalledOnce()
        expect(document.querySelector('.canvas-loading-layer')).toBeNull()
    })

    it('shares profile reloads and releases the layer on teardown', async () => {
        const {
            application,
            auth,
            dependencies,
            profile,
            nats,
        } = harness()
        dependencies.resolve({
            auth,
            nats,
        })
        profile.resolve()
        await application.start()
        auth.userStore.setMetaValues({ loadingStatus: LoadingStatus.loading })
        expect(document.querySelector('.canvas-loading-layer')).not.toBeNull()
        auth.userStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        expect(document.querySelector('.canvas-loading-layer')).toBeNull()
        expect(document.body.textContent).toContain('User information could not be loaded')
        auth.userStore.setMetaValues({ loadingStatus: LoadingStatus.loading })
        await application.destroy()
        expect(document.querySelector('.canvas-loading-layer')).toBeNull()
        expect(nats.disconnect).toHaveBeenCalledOnce()
    })
})
