import { createAuthService } from './auth/createAuthService.ts'
import {
    type AuthStateStore,
    type SelectableAuthConfig,
    type WebClientAuthService,
} from './auth/types.ts'
import { createAuthStore } from './stores/authStore.ts'
import {
    consumeSessionHandoff,
    createSessionAccountHint,
    createSessionHandoffUrl,
    matchesSessionAccount,
} from './sessionHandoff.ts'
import {
    createUserStore,
    type UserStateStore,
} from './stores/userStore.ts'
import {
    createUserService,
    type UserRequestClient,
} from './users/userService.ts'
export type LoadCurrentUserConfig = {
    requestClient: UserRequestClient
}

export type AuthClientFeatures = {
    auth?: boolean
    currentUser?: boolean
}

export type AuthClientSession = {
    accessToken: string
    userId: string
    getToken: (forceRefresh?: boolean) => Promise<string | false>
    refreshToken: () => Promise<string | false>
}

type AuthClientBaseConfig = {
    authStore?: AuthStateStore
    userStore?: UserStateStore
}

// This claim selects the client's routing namespace. Servers verify the token
// independently before granting permissions or returning application data.
const getSessionUserId = (accessToken: string): string => {
    const encodedPayload = accessToken.split('.')[1]

    if (!encodedPayload)
        throw new Error('Authentication token has no payload')

    const bytes = Uint8Array.from(
        atob(
            encodedPayload.replaceAll('-', '+').replaceAll('_', '/'),
        ),
        character => character.charCodeAt(0),
    )
    const payload: unknown = JSON.parse(
        new TextDecoder().decode(bytes),
    )

    if (
        !payload
        || typeof payload !== 'object'
        || !('sub' in payload)
        || typeof payload.sub !== 'string'
        || !payload.sub
    )
        throw new Error('Authentication token has no user identity')

    return payload.sub
}

export type AuthClientConfig = AuthClientBaseConfig & (
    | {
        auth: SelectableAuthConfig
        features?: AuthClientFeatures
    }
    | {
        auth?: never
        features: {
            auth: false
            currentUser: false
        }
    }
)

export type AuthClientInstance = WebClientAuthService & {
    readonly authStore: AuthStateStore
    readonly features: Required<AuthClientFeatures>
    readonly userStore: UserStateStore
    initializeSession: () => Promise<AuthClientSession | null>
    createSessionHandoffUrl: (destination: string) => string
    loadCurrentUser: (config: LoadCurrentUserConfig) => Promise<void>
    rejectAccess: (cleanup: () => Promise<void>) => Promise<void>
}

class AuthClient implements AuthClientInstance {
    readonly authStore: AuthStateStore
    readonly features: Required<AuthClientFeatures>
    readonly userStore: UserStateStore

    private readonly authService: WebClientAuthService | null
    private readonly applicationUrl?: string
    private changingOrigin = false
    private rejected = false
    private rejection: Promise<void> | undefined
    private accountHint: string | undefined

    constructor(config: AuthClientConfig) {
        const authEnabled = config.features?.auth ?? true
        this.authStore = config.authStore ?? createAuthStore()
        this.features = {
            auth: authEnabled,
            currentUser: config.features?.currentUser ?? authEnabled,
        }
        this.userStore = config.userStore ?? createUserStore()
        this.applicationUrl = authEnabled ? config.auth?.redirectUri : undefined
        this.authService = authEnabled
            && config.auth
            ? createAuthService(config.auth, this.authStore)
            : null
    }

    private redirectToApplicationOrigin(): boolean {
        if (this.changingOrigin)
            return true

        if (!this.applicationUrl)
            return false

        const destination = new URL(this.applicationUrl)

        if (
            destination.username
            || destination.password
            || !['http:', 'https:'].includes(destination.protocol)
        )
            throw new Error('Invalid authentication callback URL')

        if (destination.origin === window.location.origin)
            return false

        // The SDK transaction and its PKCE verifier belong to one origin.
        // Move to the callback origin before reading sessions or starting auth.
        const current = new URL(window.location.href)
        const isCallback = ['code', 'state', 'error'].some(key => current.searchParams.has(key))
        destination.pathname = current.pathname
        destination.search = isCallback ? '' : current.search
        destination.hash = isCallback ? '' : current.hash
        this.changingOrigin = true
        this.authStore.setMetaValues({
            isLoading: true,
            isRedirecting: true,
        })

        try {
            window.location.replace(destination.href)
        } catch (error) {
            this.changingOrigin = false
            this.authStore.setMetaValues({
                isLoading: false,
                isRedirecting: false,
            })

            throw error
        }

        return true
    }

    init = async (): Promise<void> => {
        if (this.redirectToApplicationOrigin())
            return

        await this.authService?.init()
    }

    login = async (
        forceFresh = false,
        screenHint?: 'signup',
    ): Promise<void> => {
        if (this.redirectToApplicationOrigin())
            return

        await this.authService?.login(forceFresh, screenHint)
    }

    recoverAccess = (): Promise<void> => this.authService?.recoverAccess() ?? Promise.resolve()

    confirmAccess = (): void => void this.authService?.confirmAccess()

    logout = (): Promise<void> => {
        this.accountHint = undefined

        return this.authService?.logout() ?? Promise.resolve()
    }

    createSessionHandoffUrl = (destination: string): string => createSessionHandoffUrl(destination, this.accountHint)

    getTokenSilently = async (forceRefresh = false): Promise<string | false> => {
        if (
            !this.authService
            || this.rejected
            || this.changingOrigin
        )
            return false

        const token = await this.authService.getTokenSilently(forceRefresh)

        return this.rejected ? false : token
    }

    clearSession = async (): Promise<void> => {
        this.accountHint = undefined
        this.authStore.resetStore()
        this.userStore.resetStore()
        await this.authService?.clearSession()
    }

    rejectAccess = (cleanup: () => Promise<void>): Promise<void> => {
        this.rejected = true
        this.accountHint = undefined
        this.authStore.resetStore()
        this.userStore.resetStore()
        this.rejection ??= this.finishRejection(cleanup)

        return this.rejection
    }

    private async finishRejection(cleanup: () => Promise<void>): Promise<void> {
        try {
            await cleanup()
        } finally {
            await this.clearSession()
            await this.recoverAccess()
        }
    }

    initializeSession = async (): Promise<AuthClientSession | null> => {
        if (this.redirectToApplicationOrigin())
            return null

        const handoff = this.features.auth && consumeSessionHandoff()
        await this.init()

        if (!this.features.auth)
            return null

        const accessToken = await this.getTokenSilently()
        const userId = accessToken ? getSessionUserId(accessToken) : undefined

        if (
            handoff
            && !this.authStore.getMeta('isRedirecting')
            && (!userId || !(await matchesSessionAccount(handoff, userId)))
        ) {
            // Each origin has a separate SDK cache. Discard a previous
            // account locally without ending the source account's Auth0 SSO.
            if (accessToken)
                await this.clearSession()

            // Resuming through Auth0 works across origins and does not depend
            // on an SDK cookie or third-party iframe access. Do not force a
            // fresh login when the user just navigated from another app.
            await this.login()

            return null
        }

        if (
            !accessToken
            || !userId
        )
            return null

        this.accountHint = await createSessionAccountHint(userId)

        return {
            accessToken,
            userId,
            getToken: forceRefresh => this.getTokenSilently(forceRefresh),
            refreshToken: () => this.getTokenSilently(true),
        }
    }

    loadCurrentUser = async (config: LoadCurrentUserConfig): Promise<void> => {
        if (this.features.currentUser) {
            await createUserService({
                getToken: this.getTokenSilently,
                requestClient: config.requestClient,
                store: this.userStore,
                isSessionActive: () => !this.rejected,
            }).getUser()

            if (!this.rejected)
                this.confirmAccess()
        }
    }
}

export const createAuthClient = (config: AuthClientConfig): AuthClientInstance => new AuthClient(config)
