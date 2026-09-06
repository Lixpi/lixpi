// The model catalog the page renders, plus the filters applied to it. The view
// is a subscriber: every change to a filter, to the selected model, or to the
// loaded overview comes back through here.

import { LoadingStatus } from '@lixpi/constants'

import { writable } from '$src/stores/nanoStore.ts'

import {
    type CatalogModel,
    type CatalogOverview,
    type ProviderDirectory,
} from '$src/views/modelCatalog/types.ts'

export type StatusFilter =
    | 'all'
    | 'written-to-database'
    | 'missing-required-fields'
    | 'skipped-by-catalog-index'
    | 'drifting'

export type ModelCatalogFilters = {
    query: string
    provider: ProviderDirectory | 'all'
    status: StatusFilter
}

type Meta = {
    loadingStatus: LoadingStatus
    // The last failure, kept so the page can say what went wrong instead of
    // rendering an empty table.
    error: string | null
    // A write in flight, so the detail panel can disable its controls.
    saving: boolean
    lastSaveMessage: string | null
}

type Data = {
    overview: CatalogOverview | null
    filters: ModelCatalogFilters
    // `provider/modelId` of the model open in the detail panel.
    selectedModelKey: string | null
    // Provider directories whose rows are folded away. A per-browser
    // convenience, so it is kept in localStorage rather than on the server.
    collapsedProviders: string[]
}

type ModelCatalogStore = {
    meta: Meta
    data: Data
}

export const modelKey = (model: CatalogModel): string => `${model.provider}/${model.modelId}`

const COLLAPSED_STORAGE_KEY = 'ai-model-registry:collapsed-providers'

const readCollapsedProviders = (): string[] => {
    try {
        const stored = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]')

        return Array.isArray(stored) ? stored.map(String) : []
    } catch {
        return []
    }
}

const writeCollapsedProviders = (providers: string[]): void => {
    try {
        localStorage.setItem(
            COLLAPSED_STORAGE_KEY,
            JSON.stringify(providers),
        )
    } catch {
        // A browser with storage disabled still collapses, it just forgets.
    }
}

const initial: ModelCatalogStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,
        error: null,
        saving: false,
        lastSaveMessage: null,
    },
    data: {
        overview: null,
        filters: {
            query: '',
            provider: 'all',
            status: 'all',
        },
        selectedModelKey: null,
        collapsedProviders: readCollapsedProviders(),
    },
}

const store = writable<ModelCatalogStore>({ ...initial })

export const modelCatalogStore = {
    ...store,
    getMeta: (key: keyof Meta | null = null): any => {
        const state = store.get()

        return key ? state.meta[key] : state.meta
    },
    getData: (key: keyof Data | null = null): any => {
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
    setDataValues: (values: Partial<Data> = {}): void =>
        void store.update(
            state => ({
                ...state,
                data: {
                    ...state.data,
                    ...values,
                },
            }),
        ),
    setFilters: (values: Partial<ModelCatalogFilters> = {}): void =>
        void store.update(
            state => ({
                ...state,
                data: {
                    ...state.data,
                    filters: {
                        ...state.data.filters,
                        ...values,
                    },
                },
            }),
        ),
    toggleProviderCollapsed: (provider: ProviderDirectory): void =>
        void store.update(state => {
            const collapsed = state.data.collapsedProviders.includes(provider)
                ? state.data.collapsedProviders.filter(entry => entry !== provider)
                : [...state.data.collapsedProviders, provider]
            writeCollapsedProviders(collapsed)

            return {
                ...state,
                data: {
                    ...state.data,
                    collapsedProviders: collapsed,
                },
            }
        }),
    resetStore: (): void => void store.set({ ...initial }),
}
