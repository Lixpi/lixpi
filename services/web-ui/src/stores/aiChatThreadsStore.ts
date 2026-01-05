'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    type AiChatThread
} from '@lixpi/constants'

type Meta = {
    loadingStatus: LoadingStatus
}

type AiChatThreadsStoreData = {
    meta: Meta
    data: Map<string, AiChatThread>
}

const initialState: AiChatThreadsStoreData = {
    meta: {
        loadingStatus: LoadingStatus.idle
    },
    data: new Map()
}

const store = writable(initialState)

export const aiChatThreadsStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()
        return returnValue
    },

    getData: (): Map<string, AiChatThread> => {
        let returnValue: Map<string, AiChatThread> = new Map()
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

    setThreads: (threads: AiChatThread[] = []): void => store.update(state => {
        const threadMap = new Map<string, AiChatThread>()
        threads.forEach(thread => {
            threadMap.set(thread.threadId, thread)
        })
        return {
            ...state,
            data: threadMap
        }
    }),

    addThread: (thread: AiChatThread): void => store.update(state => {
        const newData = new Map(state.data)
        newData.set(thread.threadId, thread)
        return {
            ...state,
            data: newData
        }
    }),

    updateThread: (threadId: string, updates: Partial<AiChatThread>): void => store.update(state => {
        const existing = state.data.get(threadId)
        if (!existing) return state

        const newData = new Map(state.data)
        newData.set(threadId, { ...existing, ...updates })
        return {
            ...state,
            data: newData
        }
    }),

    removeThread: (threadId: string): void => store.update(state => {
        const newData = new Map(state.data)
        newData.delete(threadId)
        return {
            ...state,
            data: newData
        }
    }),

    getThread: (threadId: string): AiChatThread | undefined => {
        let returnValue: AiChatThread | undefined
        const unsubscribe = store.subscribe(store => {
            returnValue = store.data.get(threadId)
        })
        unsubscribe()
        return returnValue
    },

    reset: (): void => store.set(initialState)
}
