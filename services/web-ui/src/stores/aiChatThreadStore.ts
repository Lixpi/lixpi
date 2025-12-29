'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    type AiChatThread
} from '@lixpi/constants'

type Meta = {
    loadingStatus: LoadingStatus
    requiresSave: boolean
}

type AiChatThreadStoreData = {
    meta: Meta
    data: AiChatThread | null
}

const initialState: AiChatThreadStoreData = {
    meta: {
        loadingStatus: LoadingStatus.idle,
        requiresSave: false
    },
    data: null
}

const store = writable(initialState)

export const aiChatThreadStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()
        return returnValue
    },

    getData: (): AiChatThread | null => {
        let returnValue: AiChatThread | null = null
        const unsubscribe = store.subscribe(store => {
            returnValue = store.data
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

    setDataValues: (values: Partial<AiChatThread> | null = null): void => store.update(state => ({
        ...state,
        data: values === null ? null : {
            ...state.data,
            ...values
        } as AiChatThread
    })),

    setThread: (thread: AiChatThread): void => store.update(state => ({
        ...state,
        data: thread
    })),

    reset: (): void => store.set(initialState)
}
