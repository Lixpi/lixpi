'use strict'

import { writable } from '$src/stores/nanoStore.ts'
import type { AssetDocumentRole } from '@lixpi/constants'

export type AssetDocumentSnapshot = {
    assetId: string
    role: AssetDocumentRole
    version: number
    doc: object
}

const store = writable(new Map<string, AssetDocumentSnapshot>())
const key = (assetId: string, role: AssetDocumentRole): string => `${assetId}#${role}`

export const assetDocumentsStore = {
    ...store,
    set: (snapshot: AssetDocumentSnapshot): void =>
        store.update((items) => {
            const next = new Map(items)
            next.set(key(snapshot.assetId, snapshot.role), snapshot)
            return next
        }),
    setMany: (snapshots: AssetDocumentSnapshot[]): void => {
        if (snapshots.length === 0) return
        store.update((items) => {
            const next = new Map(items)
            for (const snapshot of snapshots) {
                next.set(key(snapshot.assetId, snapshot.role), snapshot)
            }
            return next
        })
    },
    get: (assetId: string, role: AssetDocumentRole): AssetDocumentSnapshot | undefined => {
        let result: AssetDocumentSnapshot | undefined
        const unsubscribe = store.subscribe((items) => {
            result = items.get(key(assetId, role))
        })
        unsubscribe()
        return result
    },
    reset: (): void => store.set(new Map()),
}
