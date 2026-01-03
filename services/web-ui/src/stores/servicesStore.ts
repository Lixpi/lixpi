'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus
} from '@lixpi/constants'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '$src/helpers/deepfreeze.ts'

type Meta = {
    loadingStatus: LoadingStatus
}

export type Services = {
    nats: any
    userService: any
    subscriptionService: any
    aiModelService: any
    projectService: any
    organizationService: any
    workspaceService: any
    documentService: any
}

type NatsStore = {
    meta: Meta
    data: Services
}

const nats: ReadonlyDeep<NatsStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: {
        nats: null,
        userService: null,
        subscriptionService: null,
        aiModelService: null,
        projectService: null,
        organizationService: null,
        workspaceService: null,
        documentService: null,
    }
})

const store = writable({...nats})

export const servicesStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (key: keyof NATS | null = null): any => {
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

    setDataValues: (values: Partial<NATS> = {}): void => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    resetStore: (): void => store.update(state => ({
        ...nats
    })),
}
