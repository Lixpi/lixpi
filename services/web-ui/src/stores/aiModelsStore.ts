'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    type AiModel,
} from '@lixpi/constants'

type Meta = {
    loadingStatus: LoadingStatus
}

// Define the aiModels object with the types
type AiModelsStore = {
    meta: Meta;
    data: AiModel[];
}

const aiModels: AiModelsStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: [],
}

const store = writable(aiModels);

export const aiModelsStore = {
    ...store,

    // Useful for non-svelte components that need to access the store
    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any;
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta;
        });
        unsubscribe();

        return returnValue;
    },

    // Useful for non-svelte components that need to access the store
    getData: (key: keyof AiModel | null = null): any => {
        let returnValue: any;
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.data[key] : store.data;
        });
        unsubscribe();

        return returnValue;
    },

    setMetaValues: (values: Partial<Meta> = {}): void => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            ...values
        }
    })),

    addAiModels: (aiModels: AiModel[] = []): void => store.update(state => ({
        ...state,
        data: [
            ...aiModels,
            ...state.data,
        ],
    })),

    setAiModels: (aiModels: AiModel[] = []): void => store.update(state => ({
        ...state,
        data: [
            ...aiModels,
        ],
    })),

    resetStore: (): void => store.set(aiModels),
}
