import {
    type AuthStoreData,
    type AuthStoreMeta,
} from '../stores/authStore.ts'
import {
    type BaseStore,
} from '@lixpi/web-client-service-factory'

export type WebClientAuthConfig = {
    audience: string
    clientId: string
    domain: string
    logoutReturnTo: string
    redirectUri: string
}

export type LocalAuthConfig = WebClientAuthConfig & {
    storageKey?: string
}

export type SelectableAuthConfig = WebClientAuthConfig & {
    mock?: {
        clientId?: string
        domain: string
        enabled: boolean
        storageKey?: string
    }
}

export type AuthStateStore = BaseStore<AuthStoreMeta, AuthStoreData>

export type WebClientAuthService = {
    getTokenSilently: (forceRefresh?: boolean) => Promise<string | false>
    init: () => Promise<void>
    login: (
        forceFresh?: boolean,
        screenHint?: 'signup',
    ) => Promise<void>
    logout: () => Promise<void>
    clearSession: () => Promise<void>
    recoverAccess: () => Promise<void>
    confirmAccess: () => void
}

export type AuthTokenProvider = Pick<WebClientAuthService, 'getTokenSilently'>
