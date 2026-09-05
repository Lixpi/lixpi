import { writable } from '$src/stores/nanoStore.ts'

type Meta = {
    isLoading: boolean
    isAuthenticated: boolean
}

type User = { // TODO use User from @lixpi/constants, but make sure that it's compatible with auth0 user object (if it uses auth0 user object, I don't remember)
    userId: string
    name: string
    email: string
}

type AuthStore = {
    meta: Meta
    data: {
        user: User | null
    }
}

const auth: AuthStore = {
    meta: {
        isLoading: false,
        isAuthenticated: false,
    },
    data: {
        user: null,
    },
}

const store = writable(auth)

export const authStore = {
    ...store,

    // Synchronous access for imperative components.
    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => void (returnValue = key ? store.meta[key] : store.meta))
        unsubscribe()

        return returnValue
    },

    // Synchronous access for imperative components.
    getData: (key: keyof Auth | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => void (returnValue = key ? store.data[key] : store.data))
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): void =>
        void store.update(
            state => ({
                ...state,
                meta: {
                    ...state.meta,
                    ...values,
                },
            }),
        ),

    setDataValues: (values: Partial<Auth> = {}): void =>
        void store.update(
            state => ({
                ...state,
                data: {
                    ...state.data,
                    ...values,
                },
            }),
        ),

    resetStore: (): void => void store.set(auth),
}
