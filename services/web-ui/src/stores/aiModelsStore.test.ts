'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { LoadingStatus } from '@lixpi/constants'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

describe('aiModelsStore', () => {
    const defaultMatrix = {
        version: 'media-generation-config-matrix-v1',
        groups: [],
    }

    const catalog = {
        models: [{ provider: 'openai', model: 'gpt-4o' }],
        mediaGenerationConfigMatrix: {
            version: 'media-generation-config-matrix-v1',
            groups: [{ provider: 'openai', imageModels: [] }],
        },
    } as const

    beforeEach(() => {
        vi.clearAllMocks()
        aiModelsStore.resetStore()
    })

    it('starts with idle loading state and empty model data', () => {
        expect(aiModelsStore.getMeta()).toEqual({ loadingStatus: LoadingStatus.idle })
        expect(aiModelsStore.getData()).toEqual([])
        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(defaultMatrix)
    })

    it('updates loading meta and keeps data updates isolated', () => {
        aiModelsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })
        expect(aiModelsStore.getMeta('loadingStatus')).toBe(LoadingStatus.loading)

        aiModelsStore.setAiModels([{ provider: 'openai', model: 'gpt-4o' }])
        expect(aiModelsStore.getData()).toEqual([{ provider: 'openai', model: 'gpt-4o' }])
        expect(aiModelsStore.getData().length).toBe(1)
    })

    it('replaces model data and resets matrix on plain model arrays', () => {
        aiModelsStore.setAiModelsCatalog(catalog as any)
        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(catalog.mediaGenerationConfigMatrix as any)

        aiModelsStore.setAiModels([{ provider: 'google', model: 'gemini' }])

        expect(aiModelsStore.getData()).toEqual([{ provider: 'google', model: 'gemini' }])
        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(defaultMatrix)
    })

    it('stores catalogs and keeps matrix from payload', () => {
        aiModelsStore.setAiModelsCatalog(catalog as any)

        expect(aiModelsStore.getData()).toEqual([{ provider: 'openai', model: 'gpt-4o' }])
        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(catalog.mediaGenerationConfigMatrix as any)
    })

    it('prepends new models when addAiModels is used', () => {
        aiModelsStore.setAiModels([{ provider: 'google', model: 'gemini' }])
        aiModelsStore.addAiModels([{ provider: 'openai', model: 'gpt-4o' }])

        expect(aiModelsStore.getData()).toEqual([
            { provider: 'openai', model: 'gpt-4o' },
            { provider: 'google', model: 'gemini' },
        ])
    })

    it('falls back to default matrix when catalog omits config matrix', () => {
        aiModelsStore.setAiModelsCatalog({ models: [{ provider: 'x', model: 'y' }] } as any)

        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(defaultMatrix)
        expect(aiModelsStore.getData()).toEqual([{ provider: 'x', model: 'y' }])
    })

    it('restores the canonical shape through resetStore', () => {
        aiModelsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        aiModelsStore.setAiModels([{ provider: 'openai', model: 'gpt-4o' }])
        aiModelsStore.resetStore()

        expect(aiModelsStore.getMeta()).toEqual({ loadingStatus: LoadingStatus.idle })
        expect(aiModelsStore.getData()).toEqual([])
        expect(aiModelsStore.getMediaGenerationConfigMatrix()).toEqual(defaultMatrix)
    })
})
