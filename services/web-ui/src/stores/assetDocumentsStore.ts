import {
    type AssetDocumentRole,
} from '@lixpi/constants'
import { createStore } from '@lixpi/web-client-service-factory'

export type AssetDocumentSnapshot = {
    assetId: string
    role: AssetDocumentRole
    version: number
    doc: object
}

const snapshotKey = (
    assetId: string,
    role: AssetDocumentRole,
): string => `${assetId}#${role}`

const applySnapshots = (
    items: Map<string, AssetDocumentSnapshot>,
    snapshots: readonly AssetDocumentSnapshot[],
): Map<string, AssetDocumentSnapshot> => {
    let next: Map<string, AssetDocumentSnapshot> | undefined

    for (const snapshot of snapshots) {
        const key = snapshotKey(snapshot.assetId, snapshot.role)
        const existing = (next ?? items).get(key)

        if (
            existing
            && existing.version >= snapshot.version
        )
            continue

        next ??= new Map(items)
        next.set(
            key,
            structuredClone(snapshot),
        )
    }

    return next ?? items
}

export const assetDocumentsStore = createStore({
    initialState: new Map<string, AssetDocumentSnapshot>(),
    createMethods: store => ({
        set: (snapshot: AssetDocumentSnapshot): void => void store.update(items => applySnapshots(items, [snapshot])),
        setMany: (snapshots: AssetDocumentSnapshot[]): void => void store.update(items => applySnapshots(items, snapshots)),
        get: (assetId: string, role: AssetDocumentRole): AssetDocumentSnapshot | undefined =>
            store.get().get(
                snapshotKey(assetId, role),
            ),
        reset: (): void => void store.resetStore(),
    }),
})
