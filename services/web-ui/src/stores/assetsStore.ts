'use strict'

import { writable } from '$src/stores/nanoStore.ts'
import {
    LoadingStatus,
    type Asset,
} from '@lixpi/constants'

type AssetStoreState = {
    loadingStatus: LoadingStatus
    workspaceId: string | null
    items: Map<string, Asset>
    error?: unknown
}

const initialState: AssetStoreState = {
    loadingStatus: LoadingStatus.idle,
    workspaceId: null,
    items: new Map(),
}

const store = writable(initialState)

export const assetsStore = {
    ...store,
    setLoading: (workspaceId: string): void => store.update((state) => ({ ...state, workspaceId, loadingStatus: LoadingStatus.loading })),
    setAssets: (workspaceId: string, assets: Asset[]): void =>
        store.update((state) => ({
            workspaceId,
            loadingStatus: LoadingStatus.success,
            items: new Map(assets.map((asset) => {
                const existing = state.items.get(asset.assetId)
                return [asset.assetId, existing && existing.revision > asset.revision ? existing : asset]
            })),
        })),
    upsert: (asset: Asset): void =>
        store.update((state) => {
            const existing = state.items.get(asset.assetId)
            if (existing && existing.revision > asset.revision) return state
            const items = new Map(state.items)
            items.set(asset.assetId, asset)
            return { ...state, items }
        }),
    remove: (assetId: string): void =>
        store.update((state) => {
            const items = new Map(state.items)
            items.delete(assetId)
            return { ...state, items }
        }),
    setError: (error: unknown): void => store.update((state) => ({ ...state, error, loadingStatus: LoadingStatus.error })),
    get: (assetId: string): Asset | undefined => {
        let result: Asset | undefined
        const unsubscribe = store.subscribe((state) => {
            result = state.items.get(assetId)
        })
        unsubscribe()
        return result
    },
    getAll: (): Asset[] => {
        let result: Asset[] = []
        const unsubscribe = store.subscribe((state) => {
            result = [...state.items.values()]
        })
        unsubscribe()
        return result
    },
    reset: (): void => store.set(initialState),
}
