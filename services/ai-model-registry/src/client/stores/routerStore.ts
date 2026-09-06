// The active route. The layout subscribes to it and swaps the mounted view;
// the router service writes it and mirrors it into the address bar.

import { LoadingStatus } from '@lixpi/constants'

import { writable } from '$src/stores/nanoStore.ts'

import {
    type Router,
} from '$src/services/router-service.ts'

type Meta = {
    loadingStatus: LoadingStatus
}

type RouterStore = {
    meta: Meta
    data: Router
}

const router: RouterStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: {
        currentRoute: {
            path: '',
            hash: '',
            routeParams: {},
            routeQuery: {},
            isInitializationStep: false,
        },
        history: [],
    },
}

const store = writable<RouterStore>({ ...router })

export const routerStore = {
    ...store,
    getMeta: (key: keyof Meta | null = null): any => {
        const state = store.get()

        return key ? state.meta[key] : state.meta
    },
    getData: (key: keyof Router | null = null): any => {
        const state = store.get()

        return key ? state.data[key] : state.data
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
    setDataValues: (values: Partial<Router> = {}): void =>
        void store.update(
            state => ({
                ...state,
                data: {
                    ...state.data,
                    ...values,
                },
            }),
        ),
    resetStore: (): void => void store.set({ ...router }),
}
