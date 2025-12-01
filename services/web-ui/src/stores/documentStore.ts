'use strict'

import { get } from 'svelte/store'
import { writable } from 'svelte/store'

import {
    LoadingStatus,
} from '@lixpi/constants'

import type { Tag } from '$src/stores/organizationStore.ts'

type Meta = {
    loadingStatus: LoadingStatus
    isInEdit: boolean
    isRendered: boolean
    requiresSave: boolean
}

export type Document = {
    documentId: string
    title: string
    revision?: number
    prevRevision?: number
    content?: Record<string, any>
    tags?: Tag[]
    createdAt: string
    updatedAt: string
}

// Define the document object with the types
type DocumentStore = {
    meta: Meta
    data: Document
}

const document: DocumentStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,

        isInEdit: false,
        isRendered: false,
        requiresSave: false,
    },
    data: {
        documentId: '',
        title: '',
        revision: 0,
        prevRevision: 0,
        content: {},
        createdAt: '',
        updatedAt: '',
    }
}

const store = writable(document)

export const documentStore = {
    ...store,

    // Useful for non-svelte components that need to access the store
    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    // Useful for non-svelte components that need to access the store
    getData: (key: keyof Document | null = null): any => {
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

    setDataValues: (values: Partial<Document> = {}): void => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    resetStore: (): void => store.set(document),
}
