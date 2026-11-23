import {
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest'

import {
    assetDocumentsStore,
    type AssetDocumentSnapshot,
} from './assetDocumentsStore.ts'

describe('assetDocumentsStore', () => {
    beforeEach(() => void assetDocumentsStore.reset())

    it('preserves the newest version when an older hydration reply arrives late', () => {
        const newest: AssetDocumentSnapshot = {
            assetId: 'artifact',
            role: 'capabilityArtifact',
            version: 3,
            doc: { content: [] },
        }
        assetDocumentsStore.set(newest)
        assetDocumentsStore.setMany([{
            ...newest,
            version: 2,
            doc: {},
        }])
        expect(assetDocumentsStore.get(newest.assetId, newest.role)).toEqual(newest)
    })

    it('writes and reads a snapshot through domain methods that reuse base method names', () => {
        const snapshot: AssetDocumentSnapshot = {
            assetId: 'asset-1',
            role: 'conversation',
            version: 1,
            doc: { type: 'doc' },
        }

        assetDocumentsStore.set(snapshot)

        expect(assetDocumentsStore.get(
            snapshot.assetId,
            snapshot.role,
        )).toEqual(snapshot)
    })
})
