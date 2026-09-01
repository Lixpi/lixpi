import { writable } from '$src/stores/nanoStore.ts'

import {
    type AiModel,
} from '$src/stores/aiModelsStore.ts'

type Meta = {
    isLoading: boolean
    isLoaded: boolean
    errorLoading: boolean
}

export type Tag = {
    tagId: string
    name: string
    color: string
}

type Organization = {
    organizationId: string
    name: string
    tags: Tag[]
    availableModels: AiModel[]
    createdAt: number
    updatedAt: number
}

type OrganizationStore = {
    meta: Meta
    data: Organization
}

const organization: OrganizationStore = {
    meta: {
        isLoading: false,
        isLoaded: false,
        errorLoading: false,
    },
    data: {
        organizationId: '',
        name: '',
        tags: [],
        availableModels: [],
        createdAt: 0,
        updatedAt: 0,
    },
}

const store = writable(organization)

export const organizationStore = {
    ...store,

    // Synchronous access for imperative components.
    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    // Synchronous access for imperative components.
    getData: (key: keyof Organization | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.data[key] : store.data
        })
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): void =>
        store.update(state => ({
            ...state,
            meta: {
                ...state.meta,
                ...values,
            },
        })),

    setDataValues: (values: Partial<Organization> = {}): void =>
        store.update(state => ({
            ...state,
            data: {
                ...state.data,
                ...values,
            },
        })),

    addTag: (tags: Record<string, Tag>): void =>
        store.update(state => ({
            ...state,
            data: {
                ...state.data,
                tags: { ...state.data.tags, ...tags },
            },
        })),

    updateTag: (updatedTag: Tag): void =>
        store.update(state => ({
            ...state,
            data: {
                ...state.data,
                tags: state.data.tags.map(tag => tag.tagId === updatedTag.tagId ? updatedTag : tag),
            },
        })),

    removeTag: (tagId: string): void =>
        store.update(state => ({
            ...state,
            data: {
                ...state.data,
                tags: state.data.tags.filter(tag => tag.tagId !== tagId),
            },
        })),

    resetStore: (): void => store.set(organization),
}
