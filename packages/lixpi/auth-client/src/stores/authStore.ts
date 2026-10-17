import { createStore } from '@lixpi/web-client-service-factory'

export type WebClientAuthUser = Record<string, unknown> & {
    email?: string
    given_name?: string
    name?: string
    picture?: string
    sub?: string
    userId?: string
}

export type AuthStoreMeta = {
    isAuthenticated: boolean
    isLoading: boolean
    isRedirecting: boolean
}

export type AuthStoreData = {
    user: WebClientAuthUser | null
}

const initialState: {
    meta: AuthStoreMeta
    data: AuthStoreData
} = {
    meta: {
        isAuthenticated: false,
        isLoading: false,
        isRedirecting: false,
    },
    data: {
        user: null,
    },
}

export const createAuthStore = () => createStore({ initialState })
