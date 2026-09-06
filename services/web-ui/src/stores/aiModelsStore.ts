import { writable } from '$src/stores/nanoStore.ts'

import {
    LoadingStatus,
    type AiModel,
    type AiModelId,
    type AiModelsCatalogResponse,
    type DefaultAiModelCapability,
    type DefaultAiModelSelection,
    type MediaGenerationConfigMatrix,
} from '@lixpi/constants'

type Meta = {
    loadingStatus: LoadingStatus
}

// Define the aiModels object with the types
type AiModelsStore = {
    meta: Meta
    data: AiModel[]
    mediaGenerationConfigMatrix: MediaGenerationConfigMatrix
    // API-projected default model selection per capability (configured in
    // ai-models-synchronization). Empty ids mean "no configured default".
    defaultModels: DefaultAiModelSelection
}

const emptyDefaultModels: DefaultAiModelSelection = {
    reasoning: '' as AiModelId,
    image: '' as AiModelId,
    video: '' as AiModelId,
}

const aiModels: AiModelsStore = {
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: [],
    mediaGenerationConfigMatrix: {
        version: 'media-generation-config-matrix-v1',
        groups: [],
    },
    defaultModels: { ...emptyDefaultModels },
}

const store = writable(aiModels)

export const aiModelsStore = {
    ...store,

    // Synchronous access for imperative components.
    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => void (returnValue = key ? store.meta[key] : store.meta))
        unsubscribe()

        return returnValue
    },

    // Synchronous access for imperative components.
    getData: (key: keyof AiModel | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => void (returnValue = key ? store.data[key] : store.data))
        unsubscribe()

        return returnValue
    },

    getMediaGenerationConfigMatrix: (): MediaGenerationConfigMatrix => {
        let returnValue: MediaGenerationConfigMatrix = aiModels.mediaGenerationConfigMatrix
        const unsubscribe = store.subscribe(store => void (returnValue = store.mediaGenerationConfigMatrix))
        unsubscribe()

        return returnValue
    },

    // Returns the API-configured default model id for a capability, or '' when
    // none is configured. Used to pre-select model dropdowns.
    getDefaultModelId: (capability: DefaultAiModelCapability): AiModelId => {
        let returnValue: AiModelId = aiModels.defaultModels[capability]
        const unsubscribe = store.subscribe(store => void (returnValue = store.defaultModels[capability]))
        unsubscribe()

        return returnValue
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

    addAiModels: (aiModels: AiModel[] = []): void =>
        void store.update(
            state => ({
                ...state,
                data: [
                    ...aiModels,
                    ...state.data,
                ],
            }),
        ),

    setAiModels: (aiModels: AiModel[] = []): void =>
        void store.update(
            state => ({
                ...state,
                data: [
                    ...aiModels,
                ],
                mediaGenerationConfigMatrix: {
                    version: 'media-generation-config-matrix-v1',
                    groups: [],
                },
                defaultModels: { ...emptyDefaultModels },
            }),
        ),

    setAiModelsCatalog: (catalog: AiModelsCatalogResponse): void =>
        void store.update(
            state => ({
                ...state,
                data: [
                    ...(catalog.models as AiModel[]),
                ],
                mediaGenerationConfigMatrix: catalog.mediaGenerationConfigMatrix ?? aiModels.mediaGenerationConfigMatrix,
                defaultModels: catalog.defaultModels ?? { ...emptyDefaultModels },
            }),
        ),

    resetStore: (): void => void store.set(aiModels),
}
