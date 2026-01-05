'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus
} from '@lixpi/constants'

import type { Router } from '$src/services/router-service.ts'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '$src/helpers/deepfreeze.ts'

type Meta = {
    loadingStatus: LoadingStatus
}

type RouterStore = {
    meta: Meta
    data: Router
}

const router: ReadonlyDeep<RouterStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: {
        currentRoute: {
            name: '',
            language: 'en',
            hash: '',
            routeParams: {},
            routeQuery: {},
            isInitializationStep: false
        },
        history: []
    }
})

const store = writable({...router})

export const routerStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (key: keyof Router | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.data[key] : store.data
        })
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): void => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            ...values
        }
    })),

    setDataValues: (values: Partial<Router> = {}): void => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    resetStore: (): void => store.update(state => ({
        ...router
    })),
}
