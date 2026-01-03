'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
} from '@lixpi/constants'

import type {
    User
} from '@lixpi/constants'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '$src/helpers/deepfreeze.ts'

type Meta = {
    loadingStatus: LoadingStatus
}

type UserStore = {
    meta: Meta
    data: User
}

const user: ReadonlyDeep<UserStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: {
        userId: '',
        stripeCustomerId: '',
        email: '',
        name: '',
        givenName: '',
        familyName: '',
        avatar: '',
        hasActiveSubscription: false,
        balance: '0',
        currency: '',
        recentTags: [],
        organizations: [],
        createdAt: 0,
        updatedAt: 0,
    }
})

const store = writable({...user})

export const userStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (key: keyof User | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.data[key] : store.data
        })
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): any => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            ...values
        }
    })),

    setDataValues: (values: Partial<User> = {}): any => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    resetStore: (): any => store.update(state => ({
        ...user
    })),
}
