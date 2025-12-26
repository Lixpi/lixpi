'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
} from '@lixpi/constants'

import type { Document } from '$src/stores/documentStore.ts'

// Define types for meta and data
type Meta = {
    loadingStatus: LoadingStatus
}

type DocumentStore = {
    meta: Meta
    data: Document[]
}

const documents: DocumentStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: [],
}

const store = writable(documents)

export const documentsStore = {
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

    // TODO may be irrelevant, this store must be revised
    setDataValues: (values: Partial<Document> = {}): void => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    addDocuments: (documents: Document[] = []): void => store.update(state => ({
        ...state,
        data: [
            ...Array.isArray(documents) ? documents : [],
            ...state.data,
        ],
    })),

    setDocuments: (documents: Document[] = []): void => store.update(state => ({
        ...state,
        data: Array.isArray(documents) ? [...documents] : [],
    })),

    deleteDocument: (documentId: string): void => store.update(state => ({
        ...state,
        data: state.data.filter((document: Document) => document.documentId !== documentId),
    })),

    updateDocument: (documentId: string, newValues: Partial<Document>): void => store.update(state => {
        const projectIndex = state.data.findIndex((document: Document) => document.documentId === documentId)
        if (projectIndex !== -1) {
            state.data[projectIndex] = { ...state.data[projectIndex], ...newValues }
        }
        return {
            ...state
        }
    }),

    resetStore: (): void => store.set(documents),
}
