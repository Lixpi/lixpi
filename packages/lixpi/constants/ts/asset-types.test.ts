import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    ASSET_DOCUMENT_ROLES,
    isAssetDocumentRole,
} from './asset-types.ts'

describe('Asset document roles', () => {
    it('keeps Capability Artifacts in the canonical runtime role list', () => {
        expect(ASSET_DOCUMENT_ROLES).toEqual([
            'content',
            'conversation',
            'provenance',
            'capabilityArtifact',
        ])
        expect(isAssetDocumentRole('capabilityArtifact')).toBe(true)
        expect(isAssetDocumentRole('unknown')).toBe(false)
    })
})
